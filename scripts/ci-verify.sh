#!/usr/bin/env bash
# CI driver for the per-workspace `scripts/verify.sh` gate. Used by
# `.github/workflows/pages.yml` (push: changed games, quick profile) and
# `.github/workflows/nightly-verify.yml` (all games, full profile).
#
#   scripts/ci-verify.sh run all             verify template + every game
#   scripts/ci-verify.sh run changed         verify what BEFORE..AFTER touched
#   scripts/ci-verify.sh mapgen-cache-key    print one key over every game's
#                                            mapgen source hash (actions/cache)
#
# `changed` falls back to ALL when the range cannot be trusted or the change is
# global:
#   - BEFORE is empty, all zeros (first push of a branch) or not fetchable
#     (force-push dropped it) — nothing to diff against;
#   - anything under template/ or scripts/, the root package.json /
#     package-lock.json, or a workflow file changed — every game's gate runs
#     through those.
# Otherwise it verifies each `games/<slug>/` with a changed file (a deleted
# game has nothing left to verify). The profile is the caller's: export
# VERIFY_QUICK=1 for the push profile; each game's verify.sh reads it.
#
# Frozen variants (`variantOf` in game.json) are skipped: family gates measure
# whether a game is TUNED WELL, and a variant is a historical build that is
# deliberately never improved. The workflow's typecheck step still compiles
# them and build-site.mjs still builds them.
#
# Every selected workspace runs even after one fails; the exit is aggregated.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

is_variant() {
  [ -f "$1/game.json" ] && node -e "process.exit(JSON.parse(require('fs').readFileSync('$1/game.json','utf8')).variantOf?0:1)"
}

# Prints the workspaces to verify, one dir per line.
select_workspaces() {
  local scope="$1"
  local all=0
  if [ "$scope" = "all" ]; then
    all=1
  else
    local before="${BEFORE:-}" after="${AFTER:-HEAD}"
    if [ -z "$before" ] || [ -z "${before//0/}" ]; then
      echo "ci-verify: no BEFORE commit (first push?) — verifying ALL" >&2
      all=1
    elif ! git cat-file -e "$before^{commit}" 2>/dev/null && ! git fetch --quiet --no-tags --depth=1 origin "$before" 2>/dev/null; then
      echo "ci-verify: BEFORE $before is not fetchable (force-push?) — verifying ALL" >&2
      all=1
    else
      local changed
      if ! changed="$(git diff --name-only "$before" "$after")"; then
        echo "ci-verify: git diff $before $after failed — verifying ALL" >&2
        all=1
      elif printf '%s\n' "$changed" | grep -qE '^(template/|scripts/|package\.json$|package-lock\.json$|\.github/workflows/)'; then
        echo "ci-verify: template/, scripts/, root package files or a workflow changed — verifying ALL" >&2
        all=1
      else
        printf '%s\n' "$changed" | sed -n 's#^\(games/[^/]*\)/.*#\1#p' | sort -u | while read -r dir; do
          [ -f "$dir/package.json" ] && echo "$dir"
        done
      fi
    fi
  fi
  if [ "$all" -eq 1 ]; then
    echo template
    for dir in games/*/; do
      [ -f "$dir/package.json" ] && echo "${dir%/}"
    done
  fi
}

run() {
  local scope="${1:-}"
  if [ "$scope" != "all" ] && [ "$scope" != "changed" ]; then
    echo "usage: $0 run all|changed" >&2
    return 2
  fi
  local dirs
  dirs="$(select_workspaces "$scope")"
  if [ -z "$dirs" ]; then
    echo "ci-verify: no game changed — nothing to verify"
    return 0
  fi
  echo "ci-verify: profile $([ "${VERIFY_QUICK:-0}" = "1" ] && echo QUICK || echo FULL); workspaces:"
  printf '  %s\n' $dirs
  local failed=0 dir summary=""
  for dir in $dirs; do
    if is_variant "$dir"; then
      echo "== skip $dir (frozen variant — gates are a record, not a bar)"
      summary+="$(printf '%-40s %s' "$dir" skipped)"$'\n'
      continue
    fi
    echo "== verify $dir"
    local t0=$SECONDS
    if (cd "$dir" && bash scripts/verify.sh); then
      summary+="$(printf '%-40s pass (%d s)' "$dir" $((SECONDS - t0)))"$'\n'
    else
      summary+="$(printf '%-40s FAIL (%d s)' "$dir" $((SECONDS - t0)))"$'\n'
      failed=1
    fi
  done
  echo
  echo "== ci-verify summary =="
  printf '%s' "$summary"
  return $failed
}

mapgen_cache_key() {
  local parts="" dir
  for dir in games/*/; do
    dir="${dir%/}"
    [ -f "$dir/src/sim/mapgen-cache.ts" ] || continue
    is_variant "$dir" && continue
    parts+="$dir=$(cd "$dir" && npm run --silent sim -- --mapgen-cache-key)"$'\n'
  done
  printf '%s' "$parts" | node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(0)).digest('hex'))"
  echo
}

case "${1:-}" in
  run) shift; run "$@" ;;
  mapgen-cache-key) mapgen_cache_key ;;
  *)
    echo "usage: $0 run all|changed | mapgen-cache-key" >&2
    exit 2
    ;;
esac
