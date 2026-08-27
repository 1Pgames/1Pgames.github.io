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

echo "== balance sim =="
npm run --silent sim -- --runs 20 --lane all

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
