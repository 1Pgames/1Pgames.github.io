#!/usr/bin/env bash
# One-shot pipeline gate. Six stages, in this order:
#
#   1  typecheck
#   2  content contract check   (scripts/w1-contract-check.mjs)
#   3  consumer-edge check      (scripts/consumer-edge-check.mjs)
#   4  art registry freshness   (scripts/gen-art-registry.mjs --check)
#   5  genre-kit selftests      (src/sim/kits/*.timing.selftest.ts alone,
#                                then the other *.selftest.ts in parallel)
#   6  balance sims, strict     (npm run sim -- --strict)
#
# EVERY STAGE RUNS. The exit code is aggregated at the end and a per-stage
# verdict table is printed. This is not a style preference — the previous
# revision ran under `set -e` with the sim gates FIRST, and because those two
# gates are permanently flagged on a mid-tune build, their failure skipped the
# art-registry check and all nine kit selftests for the entire build. A gate you
# never reach is not a gate. So: no `set -e` around the stages, sims LAST
# (they are the stage that legitimately ships flagged), and nothing a stage does
# can prevent a later stage from reporting.
#
# Node 24's native TypeScript type-stripping executes a `.ts` file directly
# but its ESM resolver still requires an explicit extension on relative
# specifiers, while every file under `src/` (correctly, for
# `moduleResolution: "bundler"`) imports without one. `scripts/ts-resolve.mjs`
# is a `node:module` resolve hook that retries a failed relative-specifier
# resolution with `.ts`/`.tsx`/`.js`/`.mjs` appended; every `node` invocation
# below that touches `src/` loads it via `--import` so the same source tree
# runs unmodified in Node as it does in Vite/tsc.
#
# Stage 5 runs the kit selftests concurrently (`VERIFY_JOBS=N` caps them;
# default: CPU count). A kit whose gate is a wall-clock budget is named
# `src/sim/kits/*.timing.selftest.ts` instead: those run first, alone, and
# scale their budgets with `src/sim/calibrate.ts`.
#
# WALL-TIME BUDGET: a push-profile run (`VERIFY_QUICK=1`, what CI runs per push)
# must finish within VERIFY_BUDGET_S (default 300 s) × this runner's measured
# speed (`calibrateRunner()`), or the run FAILS after every stage has reported.
# The full profile (nightly) reports the same line without failing. Every stage
# prints its seconds in the summary, so the stage that blew it is named.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

declare -a STAGE_NAMES=()
declare -a STAGE_STATUS=()
declare -a STAGE_SECS=()
FAILED=0
VERIFY_T0=$SECONDS

# stage <name> <command...> — run it, remember the verdict and its seconds, keep going.
stage() {
  local name="$1"
  shift
  echo
  echo "== $name =="
  local t0=$SECONDS
  if "$@"; then
    STAGE_NAMES+=("$name")
    STAGE_STATUS+=("pass")
  else
    local code=$?
    STAGE_NAMES+=("$name")
    STAGE_STATUS+=("FAIL(exit $code)")
    FAILED=1
    echo "-- $name FAILED (exit $code) — continuing so every other stage still reports"
  fi
  STAGE_SECS+=("$((SECONDS - t0))")
}

# ---------------------------------------------------------------- 1. types --
stage typecheck npm run --silent typecheck

# ------------------------------------------------------- 2. content contract --
# The runtime contracts `tsc` structurally cannot see: a TUNING path a system
# reads but the config never defines, a content row missing the param its own
# code calls `requireParam` for, a wave spawning an unknown id, and every
# upgrade modifier pointing at a stat the run model actually reads. That last
# one ran as a `console.error` on every boot of a whole build without ever
# failing anything; it is a gate here.
run_contract_check() {
  if [ -f scripts/w1-contract-check.mjs ]; then
    node --import ./scripts/ts-resolve.mjs scripts/w1-contract-check.mjs
  else
    echo "SKIP: scripts/w1-contract-check.mjs not present"
  fi
}
stage "content contract" run_contract_check

# --------------------------------------------------------- 3. consumer edges --
# Frozen contracts froze types, not producer->consumer edges. Every review
# blocker of the last build was one shape: a workstream built its half against
# the contract and the seam was never connected. An unimported module typechecks
# perfectly; a selftest-only consumer makes dead code look covered.
run_consumer_edge_check() {
  if [ -f scripts/consumer-edge-check.mjs ]; then
    node --import ./scripts/ts-resolve.mjs scripts/consumer-edge-check.mjs
  else
    echo "SKIP: scripts/consumer-edge-check.mjs not present"
  fi
}
stage "consumer edges" run_consumer_edge_check

# ---------------------------------------------------------- 4. art registry --
# Two failure modes, both hard:
#   - `src/data/art.ts` is stale against `art/manifest.json`;
#   - the manifest dropped a TEXTURE/ANIM/ICON alias that `src/` still reads.
# The second is finding #9: a registry regeneration deleted `coin`, `xpOrb`,
# `bullet`, `hitSpark`, `heart` and `backdrop`, and the 8 resulting TS2339s
# surfaced only after twelve art agents had finished. A referenced-but-PRUNED
# alias (cross-family dead code) warns and passes; referenced-but-REMOVED
# throws and names every alias with its readers.
run_art_registry_check() {
  if [ -f scripts/gen-art-registry.mjs ]; then
    node scripts/gen-art-registry.mjs --check
  else
    echo "SKIP: scripts/gen-art-registry.mjs not present yet"
  fi
}
stage "art registry" run_art_registry_check

# ------------------------------------------------------- 5. genre-kit tests --
# `*.timing.selftest.ts` kits hold wall-clock budgets: they run FIRST and
# ALONE, because a budget measured while the selftest pool shares the CPU fails
# on load, not on code. Then every other `*.selftest.ts` runs concurrently, at
# most VERIFY_JOBS (default: CPU count) at a time. Each one's output is buffered and printed
# whole when it finishes, under its own header, so the log stays readable; the
# exit codes are aggregated — one broken kit never hides the others, for the
# same reason the stages never short-circuit. Written for bash 3.2 (macOS
# /bin/bash has no `wait -n`): the parent polls its children and is the only
# writer to the log.
cpu_count() {
  nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2
}

run_kit_selftests() {
  shopt -s nullglob
  local f
  local timings=(src/sim/kits/*.timing.selftest.ts)
  local selftests=()
  for f in src/sim/kits/*.selftest.ts; do
    case "$f" in *.timing.selftest.ts) ;; *) selftests+=("$f") ;; esac
  done
  if [ $((${#timings[@]} + ${#selftests[@]})) -eq 0 ]; then
    echo "SKIP: no src/sim/kits/*.selftest.ts files present yet"
    return 0
  fi
  local rc=0
  for f in ${timings[@]+"${timings[@]}"}; do
    echo "-- $f (alone) --"
    if ! node --import ./scripts/ts-resolve.mjs "$f"; then
      echo "-- $f FAILED"
      rc=1
    fi
  done

  local max_jobs="${VERIFY_JOBS:-$(cpu_count)}"
  local logdir
  logdir="$(mktemp -d "${TMPDIR:-/tmp}/verify-kits.XXXXXX")"
  local -a pids=() files=() starts=()
  local next=0 i pid code
  echo "-- ${#selftests[@]} selftests, up to $max_jobs at a time --"
  while [ "$next" -lt "${#selftests[@]}" ] || [ "${#pids[@]}" -gt 0 ]; do
    while [ "$next" -lt "${#selftests[@]}" ] && [ "${#pids[@]}" -lt "$max_jobs" ]; do
      f="${selftests[$next]}"
      node --import ./scripts/ts-resolve.mjs "$f" >"$logdir/$next.log" 2>&1 &
      pids+=("$!")
      files+=("$next")
      starts+=("$SECONDS")
      next=$((next + 1))
    done
    sleep 0.2
    local -a still_pids=() still_files=() still_starts=()
    for i in "${!pids[@]}"; do
      pid="${pids[$i]}"
      if kill -0 "$pid" 2>/dev/null; then
        still_pids+=("$pid")
        still_files+=("${files[$i]}")
        still_starts+=("${starts[$i]}")
        continue
      fi
      wait "$pid"
      code=$?
      f="${selftests[${files[$i]}]}"
      echo "-- $f ($((SECONDS - ${starts[$i]})) s) --"
      cat "$logdir/${files[$i]}.log"
      if [ "$code" -ne 0 ]; then
        echo "-- $f FAILED (exit $code)"
        rc=1
      fi
    done
    pids=(${still_pids[@]+"${still_pids[@]}"})
    files=(${still_files[@]+"${still_files[@]}"})
    starts=(${still_starts[@]+"${still_starts[@]}"})
    unset still_pids still_files still_starts
  done
  rm -rf "$logdir"
  return $rc
}
stage "kit selftests" run_kit_selftests

# ------------------------------------------------------------- 6. sim gates --
# LAST, deliberately. STRICT is the shipping gate: `--strict` promotes every
# soft gate to hard, so a WARN fails the pipeline. The soft/hard split exists
# for interactive tuning runs (`npm run sim`), where a warning is a hint about
# the number you are currently moving; by the time a change is being verified, a
# gate worth printing is a gate worth failing on. These gates are also the ones
# a mid-balance build legitimately ships flagged, which is exactly why they must
# not run before anything else.
#
# The family list is the filesystem, not a literal — `new-game.sh` prunes the
# families a scaffold does not ship, and a game may author its own (see
# `availableFamilies` in src/sim/cli.ts). The arena lane pipeline lives in
# `cli.ts` itself rather than in `src/sim/families/`, and it gates the
# reference 480s timeline in `data/waves.ts`, which only an A game plays — so
# it runs while `src/sim/family.ts` still says `arena`.
run_sim_gates() {
  shopt -s nullglob
  local rc=0
  if grep -q "SIM_FAMILY = 'arena'" src/sim/family.ts; then
    # Labelled distinctly from the `-- arena --` the family loop prints below:
    # an A game runs both, and two identical headers over two different gate
    # sets is a log nobody can read.
    echo "-- arena lanes --"
    npm run --silent sim -- --family arena --runs 20 --lane all --strict || rc=1
  fi
  local family_module family_code family_runs
  for family_module in src/sim/families/*.ts; do
    family_code="$(basename "$family_module" .ts)"
    if [ "$family_code" = "types" ]; then continue; fi
    echo "-- $family_code --"
    case "$family_code" in
      # 20 runs per level is a +-10 point win-rate estimate, too coarse for the
      # [30%, 90%] ladder band the board gate reads off its hardest level.
      board) family_runs=60 ;;
      *) family_runs=20 ;;
    esac
    npm run --silent sim -- --family "$family_code" --runs "$family_runs" --strict || rc=1
  done
  return $rc
}
stage "sim gates (strict)" run_sim_gates

# ---------------------------------------------------------- wall-time budget --
# Runner speed only matters once the raw budget is exceeded (the scale floor is
# 1), so the ~1 s calibration runs only then. No calibrate.ts → scale 1.
runner_scale() {
  if [ ! -f src/sim/calibrate.ts ]; then
    echo 1
    return
  fi
  node --import ./scripts/ts-resolve.mjs --input-type=module \
    -e "const { calibrateRunner } = await import('./src/sim/calibrate.ts'); console.log(calibrateRunner().scale.toFixed(2));" \
    2>/dev/null || echo 1
}

VERIFY_ELAPSED=$((SECONDS - VERIFY_T0))
VERIFY_BUDGET="${VERIFY_BUDGET_S:-300}"
BUDGET_LINE="wall time ${VERIFY_ELAPSED}s (push budget ${VERIFY_BUDGET}s)"
if [ "$VERIFY_ELAPSED" -gt "$VERIFY_BUDGET" ]; then
  scale="$(runner_scale)"
  allowed="$(awk -v b="$VERIFY_BUDGET" -v s="$scale" 'BEGIN { printf "%d", b * s }')"
  BUDGET_LINE="wall time ${VERIFY_ELAPSED}s (push budget ${VERIFY_BUDGET}s × runner ${scale} = ${allowed}s)"
  if [ "$VERIFY_ELAPSED" -gt "$allowed" ]; then
    if [ "${VERIFY_QUICK:-0}" = "1" ]; then
      BUDGET_LINE="$BUDGET_LINE — OVER BUDGET: shrink the slowest stage (quick-profile samples, cache, parallelism)"
      FAILED=1
    else
      BUDGET_LINE="$BUDGET_LINE — over the push budget (full profile: reported, not failed)"
    fi
  fi
fi

# ------------------------------------------------------------------ verdict --
echo
echo "== verify summary =="
for i in "${!STAGE_NAMES[@]}"; do
  printf '%-22s %-16s %5ss\n' "${STAGE_NAMES[$i]}" "${STAGE_STATUS[$i]}" "${STAGE_SECS[$i]}"
done
echo "$BUDGET_LINE"

if [ "$FAILED" -ne 0 ]; then
  echo
  echo "== verify FAILED =="
  exit 1
fi
echo
echo "== verify passed =="
