#!/usr/bin/env bash
# One-shot pipeline gate: typecheck, headless balance sim, art-registry
# freshness, and every genre-kit selftest. Run via `npm run verify`.
#
# Node 24's native TypeScript type-stripping executes a `.ts` file directly
# but its ESM resolver still requires an explicit extension on relative
# specifiers, while every file under `src/` (correctly, for
# `moduleResolution: "bundler"`) imports without one. `scripts/ts-resolve.mjs`
# is a `node:module` resolve hook that retries a failed relative-specifier
# resolution with `.ts`/`.tsx`/`.js`/`.mjs` appended; every `node` invocation
# below that touches `src/` loads it via `--import` so the same source tree
# runs unmodified in Node as it does in Vite/tsc.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "== typecheck =="
npm run --silent typecheck

echo "== balance sims (strict) =="
# STRICT is the shipping gate: `--strict` promotes every soft gate to hard, so
# a WARN fails the pipeline. The soft/hard split exists for interactive tuning
# runs (`npm run sim`), where a warning is a hint about the number you are
# currently moving; by the time a change is being verified, a gate worth
# printing is a gate worth failing on.
#
# The family list is the filesystem, not a literal — `new-game.sh` prunes the
# families a scaffold does not ship, and a game may author its own (see
# `availableFamilies` in src/sim/cli.ts). The arena lane pipeline lives in
# `cli.ts` itself rather than in `src/sim/families/`, and it gates the
# reference 480s timeline in `data/waves.ts`, which only an A game plays — so
# it runs while `src/sim/family.ts` still says `arena`.
shopt -s nullglob
if grep -q "SIM_FAMILY = 'arena'" src/sim/family.ts; then
  echo "-- arena --"
  npm run --silent sim -- --family arena --runs 20 --lane all --strict
fi
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
  npm run --silent sim -- --family "$family_code" --runs "$family_runs" --strict
done

echo "== art registry =="
if [ -f scripts/gen-art-registry.mjs ]; then
  node scripts/gen-art-registry.mjs --check
else
  echo "SKIP: scripts/gen-art-registry.mjs not present yet"
fi

echo "== genre-kit selftests =="
shopt -s nullglob
selftests=(src/sim/kits/*.selftest.ts)
if [ ${#selftests[@]} -eq 0 ]; then
  echo "SKIP: no src/sim/kits/*.selftest.ts files present yet"
else
  for f in "${selftests[@]}"; do
    echo "-- $f --"
    node --import ./scripts/ts-resolve.mjs "$f"
  done
fi

echo "== verify passed =="
