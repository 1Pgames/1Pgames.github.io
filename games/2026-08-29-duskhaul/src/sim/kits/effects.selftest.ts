// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/effects.selftest.ts
//
// Paid-effect wiring guard (user bug: Fore-Rite `b_startlevel` was folded into
// `RunLoadoutV2.startLevel` and read by nothing). Static, source-level checks
// that every producer → consumer hop of a purchasable/earned effect exists in
// the RUN (scene, systems, objects, ui) — a sim/selftest reader does not count:
//   1. every RunLoadoutV2 field (and `hazardExtras` sub-field) is read as
//      `loadout.<field>` / `hazardExtras.<field>` by run code;
//   2. every Sanctum node id is folded by `core/progression.ts`;
//   3. every mutator `loadout` param is folded by `runLoadout`, and every
//      `run` param is read by run code.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SANCTUM } from '../../data/sanctum';
import { MUTATORS } from '../../data/mutators';

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Run code: everything under src/ except the sim, selftests, the type file and the loadout producer. */
function runFiles(dir: string, out: { rel: string; text: string }[] = []): { rel: string; text: string }[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(SRC, path).split('\\').join('/');
    if (statSync(path).isDirectory()) {
      if (rel !== 'sim') runFiles(path, out);
      continue;
    }
    if (!rel.endsWith('.ts') || rel.endsWith('.selftest.ts')) continue;
    if (rel === 'data/types-v2.ts' || rel === 'core/progression.ts') continue;
    out.push({ rel, text: readFileSync(path, 'utf8') });
  }
  return out;
}
const RUN = runFiles(SRC);
const readersOf = (pattern: RegExp, files = RUN): string[] => files.filter((f) => pattern.test(f.text)).map((f) => f.rel);

// ── 1. RunLoadoutV2 fields ──
{
  const types = read('data/types-v2.ts');
  const block = /export interface RunLoadoutV2 \{([\s\S]*?)\n\}/.exec(types)?.[1];
  assert.ok(block !== undefined, 'RunLoadoutV2 declaration found');
  const body = block.replace(/\/\/.*$/gm, '');
  const nestedBody = /hazardExtras:\s*\{([^}]*)\}/.exec(body)?.[1];
  assert.ok(nestedBody !== undefined, 'hazardExtras block found');
  const names = (s: string): string[] => [...s.matchAll(/(\w+)\??:/g)].map((m) => m[1]!);
  // Strip every inline object type so `belt: ({ id; charges } | null)[]` yields `belt` only.
  const top = names(body.replace(/\{[^{}]*\}/g, ''));
  const nested = names(nestedBody);
  assert.ok(top.length >= 40 && top.includes('startLevel') && top.includes('hazardExtras') && top.includes('mercy'), `parsed ${top.length} top-level fields`);
  assert.deepEqual(nested.sort(), ['bossPhaseAt', 'collapseAtS', 'eliteExtraAffix', 'forcedAffix']);

  const dead: string[] = [];
  for (const f of top) {
    if (f === 'hazardExtras') continue;
    if (readersOf(new RegExp(`loadout\\??\\.${f}\\b`)).length === 0) dead.push(f);
  }
  const extrasFiles = RUN.filter((f) => f.text.includes('hazardExtras'));
  for (const f of nested) {
    if (readersOf(new RegExp(`\\.${f}\\b`), extrasFiles).length === 0) dead.push(`hazardExtras.${f}`);
  }
  assert.deepEqual(dead, [], `RunLoadoutV2 fields no run code reads: ${dead.join(', ')}`);
  // The scanner itself must be able to fail.
  assert.deepEqual(readersOf(/loadout\??\.noSuchPaidEffect\b/), []);
}

// ── 2. Sanctum nodes are folded somewhere by the producer ──
{
  const producer = read('core/progression.ts');
  const unfolded = SANCTUM.map((n) => n.id).filter((id) => !new RegExp(`['\\s]${id}['\\s:]`).test(producer));
  assert.deepEqual(unfolded, [], `Sanctum nodes runLoadout/meta never folds: ${unfolded.join(', ')}`);
}

// ── 3. Mutator params ──
{
  const producer = read('core/progression.ts');
  const loadoutKeys = [...new Set(MUTATORS.flatMap((m) => Object.keys(m.loadout)))];
  const runKeys = [...new Set(MUTATORS.flatMap((m) => Object.keys(m.run)))];
  assert.deepEqual(loadoutKeys.filter((k) => !new RegExp(`\\.${k}\\b`).test(producer)), [], 'every mutator loadout param is folded by runLoadout');
  const unread = runKeys.filter((k) => readersOf(new RegExp(`mutRun\\.${k}\\b`)).length === 0);
  assert.deepEqual(unread, [], `mutator run params no run code reads: ${unread.join(', ')}`);
}

console.log('effects selftest OK');
