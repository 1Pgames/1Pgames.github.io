// Node ESM resolve hook: Node 24's built-in TypeScript type-stripping runs a
// `.ts` file directly, but its module resolver still requires an explicit
// extension on relative specifiers. Every file in `src/` follows the
// bundler-style convention of importing without an extension (`./config`,
// not `./config.ts`) — the correct convention for Vite/tsc's
// `moduleResolution: "bundler"`, and not something this pipeline may
// codemod across the whole repo (most of `src/` is other workstreams' owned
// or shared read-only files).
//
// This hook is the bridge: when the default resolver fails to find a
// relative specifier, retry once with each of `.ts`, `.tsx`, `.mts`, `.js`
// and `.mjs` appended before giving up. It changes nothing for specifiers
// that already resolve — bare package imports (`phaser`) and
// already-extensioned specifiers pass straight through to Node's normal
// resolution.
//
// Usage: `node --import ./scripts/ts-resolve.mjs <entry>.ts`. See
// `package.json`'s "sim" script and `scripts/verify.sh`.
//
// `--import` only loads this module in the main thread — it does not, on its
// own, install its exported `resolve`/`load` hooks as loader customizations.
// This module registers itself via `node:module`'s `register()` so a plain
// `--import` is sufficient; no separate `--experimental-loader` flag needed.
import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

register(import.meta.url);

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isModuleNotFound = err !== null && typeof err === 'object' && 'code' in err && err.code === 'ERR_MODULE_NOT_FOUND';
    if (!isModuleNotFound || !specifier.startsWith('.') || context.parentURL === undefined) throw err;

    const basePath = fileURLToPath(new URL(specifier, context.parentURL));
    for (const ext of CANDIDATE_EXTENSIONS) {
      if (existsSync(basePath + ext)) return nextResolve(specifier + ext, context);
    }
    throw err;
  }
}
