/**
 * Stage 2 of `verify.sh`: the runtime contracts the slice cannot express in
 * types.
 *
 * The systems in `src/systems/` and `src/objects/` deliberately THROW on a
 * missing content param rather than defaulting, and a slice reads dozens of
 * TUNING paths that only exist if the data workstream landed them. Both classes
 * of failure are invisible to `tsc` and fatal at run start. In the words of the
 * game-local ancestor of this file, it catches "the failure class tsc
 * structurally cannot see... which is exactly how this build lost a day".
 *
 * WHY THERE IS NO LIST IN HERE. The ancestor carried a hand-maintained list of
 * 99 TUNING paths. That list asserted `elite.gateGuardAdds` — a key no line of
 * the game ever read — and `elite.atS`, and `economy.scorePerKill`: three
 * fictions, inside the very check whose job is to catch fictions. A transcribed
 * list is content, content rots, and a rotted assertion is worse than no
 * assertion because it reads as proof. So every rule below is derived:
 *
 *   C1  every TUNING path `src/` READS resolves in the shipped TUNING object
 *   C2  every content row carries the params its own code demands
 *   C3  every cross-collection id reference resolves to a real row
 *   C4  every scheduled TUNING time exists as an event in the timeline data
 *   C5  every upgrade modifier points at a stat the run model reads
 *   C6  the game's own numeric invariants (optional sidecar)
 *
 * C5 is a promotion, not a new check. `validateUpgradeStats` ran on EVERY boot
 * of the last build and printed "8 modifier(s) point at unread stats" as a
 * `console.error` the whole way to the review gate. A console.error is not a
 * gate. It is one here.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/w1-contract-check.mjs
 *      [--root <game-dir>]
 */
import {
  ROOT, listSourceFiles, sourceOf, loadDataModules, tuningRoots, readPath,
  scanTuningReads, report,
} from './contract-lib.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const failures = [];
const notes = [];

const files = listSourceFiles();
const { loaded, skipped, failed } = await loadDataModules();
for (const entry of failed) failures.push(`could not load data module ${entry.rel}: ${entry.message}`);
if (skipped.length > 0) notes.push(`data modules skipped (import Phaser at runtime): ${skipped.join(', ')}`);

/* ------------------- C1: every TUNING path the code reads actually exists -- */

const roots = tuningRoots(loaded);
if (roots.length === 0) failures.push('no TUNING root found: src/config.ts must export TUNING');

let pathCount = 0;
for (const root of roots) {
  const { reads } = scanTuningReads(root.name, files.filter((rel) => rel !== root.rel));
  for (const [path, sites] of reads) {
    pathCount += 1;
    if (readPath(root.value, path) !== undefined) continue;
    // A trailing member may be a method or an index on the value
    // (`atS.forEach`, `radius.toFixed`); the tuning key is its parent.
    const parts = path.split('.');
    const parent = parts.slice(0, -1).join('.');
    if (parts.length > 1 && readPath(root.value, parent) !== undefined) continue;
    failures.push(`${root.name}.${path} is missing but read at ${sites.slice(0, 3).join(', ')}`);
  }
}

/* ------------- C2: every content row carries the params its code demands ---- */

/**
 * `requireParam(def, 'windupMs')` is a THROW site. Scanning for those gives the
 * exact set of keys the code demands — no transcription. Two rules follow, and
 * both are decidable from the tree:
 *
 *  a) a demanded key NO row in the collection supplies: the branch that reads it
 *     throws the first time it runs. Certain failure, reported as one.
 *  b) a row missing a key that every sibling sharing its discriminant carries:
 *     the deviant row. This is how a 24-enemy roster is policed without anyone
 *     maintaining a verb->params table, and it is the rule the ancestor's
 *     `VERB_REQUIRED` map approximated by hand.
 */
const demanded = new Map(); // key -> [site]
for (const rel of files) {
  const { code } = sourceOf(rel);
  const re = /requireParam\s*\(\s*[^,)]+,\s*'([^']+)'/g;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    const list = demanded.get(m[1]);
    if (list === undefined) demanded.set(m[1], [rel]);
    else if (!list.includes(rel)) list.push(rel);
  }
}

/** Every exported array-of-rows with string ids, plus where each row's param bag lives. */
const collections = [];
for (const [rel, mod] of loaded) {
  for (const [name, value] of Object.entries(mod)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    if (!value.every((row) => row !== null && typeof row === 'object' && typeof row.id === 'string')) continue;
    collections.push({ rel, name, rows: value });
  }
}

/** `{ params }` may sit on the row or one level down (`zone.hazard.params`). */
function paramBags(row) {
  const bags = [];
  if (row.params !== null && typeof row.params === 'object') bags.push({ path: 'params', bag: row.params, holder: row });
  for (const [key, value] of Object.entries(row)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    if (value.params !== null && typeof value.params === 'object') {
      bags.push({ path: `${key}.params`, bag: value.params, holder: value });
    }
  }
  return bags;
}

/** The discriminant is the row's least-varied non-id string field — `behaviour`, `kind`. */
function discriminantOf(holders) {
  const counts = new Map();
  for (const holder of holders) {
    for (const [key, value] of Object.entries(holder)) {
      if (key === 'id' || typeof value !== 'string') continue;
      const seen = counts.get(key) ?? { values: new Set(), rows: 0 };
      seen.values.add(value);
      seen.rows += 1;
      counts.set(key, seen);
    }
  }
  let best = null;
  for (const [key, seen] of counts) {
    if (seen.rows !== holders.length) continue; // not present on every row
    if (seen.values.size >= holders.length) continue; // an identifier, not a class
    if (best === null || seen.values.size < best.size) best = { key, size: seen.values.size };
  }
  return best?.key ?? null;
}

let paramRows = 0;
for (const collection of collections) {
  const entries = [];
  for (const row of collection.rows) {
    for (const found of paramBags(row)) entries.push({ row, ...found });
  }
  if (entries.length === 0) continue;
  paramRows += entries.length;
  const supplied = new Set(entries.flatMap((e) => Object.keys(e.bag)));

  // (a) demanded-but-never-supplied, scoped to the collection the demanding
  // module actually consumes: only report when the collection supplies SOME of
  // the demanding module's keys, which is what proves it is that consumer's data.
  for (const [key, sites] of demanded) {
    if (supplied.has(key)) continue;
    const siblingKeys = [...demanded.keys()].filter((k) => supplied.has(k));
    if (siblingKeys.length === 0) continue; // not this collection's consumer
    if (!sites.some((site) => demanded.get(siblingKeys[0]).includes(site))) continue;
    failures.push(
      `${collection.name}: no row supplies "${key}", which ${sites.join(', ')} calls requireParam for `
      + '— that branch throws the first time it runs',
    );
  }

  // (b) the deviant row inside a discriminant group.
  const discriminant = discriminantOf(entries.map((e) => e.holder));
  if (discriminant === null) continue;
  const groups = new Map();
  for (const entry of entries) {
    const verb = entry.holder[discriminant];
    const group = groups.get(verb);
    if (group === undefined) groups.set(verb, [entry]);
    else group.push(entry);
  }
  for (const [verb, group] of groups) {
    if (group.length < 2) continue; // a group of one teaches nothing
    const groupKeys = new Set(group.flatMap((e) => Object.keys(e.bag)).filter((k) => demanded.has(k)));
    for (const key of groupKeys) {
      const missing = group.filter((e) => e.bag[key] === undefined);
      if (missing.length === 0 || missing.length === group.length) continue;
      // Only a MINORITY deviating is evidence of a mistake; a even split is a
      // genuinely optional param.
      if (missing.length * 2 >= group.length) continue;
      for (const entry of missing) {
        failures.push(
          `${collection.name} ${entry.row.id} (${discriminant}=${verb}): missing required param "${key}" `
          + `that ${group.length - missing.length}/${group.length} of its group carries and `
          + `${demanded.get(key).join(', ')} throws without`,
        );
      }
    }
  }
}

/* --------------- C3: cross-collection id references must resolve ------------ */

/**
 * `waves.ts spawns unknown enemy id "husk2"`. Generalised by namespace: a nested
 * `id` field is only checked when some of that field's values already match a
 * real collection — so `zone.gates[].id` ('a','b','c'), which is a local
 * namespace, is left alone, while `wave.spawns[].id` is policed against the
 * roster. No collection pairs are configured anywhere.
 */
const idSets = new Map(collections.map((c) => [c.name, new Set(c.rows.map((r) => r.id))]));
const nestedIds = new Map(); // dotted access path -> [{ value, rel, owner }]
function walkNested(rel, node, path, depth, owner) {
  if (depth > 5 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkNested(rel, item, `${path}[]`, depth + 1, owner);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' && typeof value === 'string' && depth > 0) {
      const list = nestedIds.get(`${path}.id`);
      const record = { value, rel, owner };
      if (list === undefined) nestedIds.set(`${path}.id`, [record]);
      else list.push(record);
    } else if (value !== null && typeof value === 'object') {
      walkNested(rel, value, `${path}.${key}`, depth + 1, owner);
    }
  }
}
// Every exported array of rows is walked, not only the id-bearing collections:
// `WAVES` rows have no `id` of their own, so scoping the walk to collections
// made `wave.spawns[].id` — the reference this check exists for — invisible.
for (const [rel, mod] of loaded) {
  for (const [name, value] of Object.entries(mod)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (row === null || typeof row !== 'object') continue;
      walkNested(rel, row, name, 0, typeof row.id === 'string' ? row.id : name);
    }
  }
}

for (const [path, records] of nestedIds) {
  for (const [owner, ids] of idSets) {
    const hits = records.filter((r) => ids.has(r.value));
    if (hits.length === 0) continue;
    const misses = records.filter((r) => !ids.has(r.value));
    if (misses.length === 0 || misses.length > hits.length) continue; // a shared namespace, not a reference
    for (const miss of misses) {
      failures.push(
        `${path} = "${miss.value}" (in ${miss.owner}) is not an id in ${owner}, `
        + `though ${hits.length}/${records.length} of its siblings are`,
      );
    }
  }
}

/* -------------- C4: scheduled TUNING times must exist in the timeline ------- */

/**
 * `TUNING.chest.atS = [165, 345]` promises two chests; the timeline data has to
 * contain them. Matched by shape, not by name: any array of `{ kind, at }` rows
 * is a timeline, and a `<kind>.atS` tuning array is its schedule.
 */
const timelines = [];
for (const [rel, mod] of loaded) {
  for (const [name, value] of Object.entries(mod)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    if (value.every((e) => e !== null && typeof e === 'object' && typeof e.kind === 'string' && typeof e.at === 'number')) {
      timelines.push({ rel, name, events: value });
    }
  }
}
let scheduleChecks = 0;
for (const root of roots) {
  for (const [kind, block] of Object.entries(root.value)) {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const field of ['atS', 'atMs', 'times']) {
      const schedule = block[field];
      if (!Array.isArray(schedule) || !schedule.every((n) => typeof n === 'number')) continue;
      for (const timeline of timelines) {
        const at = new Set(timeline.events.filter((e) => e.kind === kind).map((e) => e.at));
        if (at.size === 0) continue;
        scheduleChecks += 1;
        const scale = field === 'atMs' ? 1000 : 1;
        for (const value of schedule) {
          if (at.has(value / scale) || at.has(value)) continue;
          failures.push(
            `${root.name}.${kind}.${field} promises ${value} but ${timeline.name} has no "${kind}" event there `
            + `(it has ${[...at].join(', ')})`,
          );
        }
      }
    }
  }
}

/* ----------- C5: every upgrade modifier targets a stat the model reads ------ */

const statOwners = [];
for (const [, mod] of loaded) {
  for (const [name, value] of Object.entries(mod)) {
    if (/_BASE_STATS$/.test(name) && value !== null && typeof value === 'object') statOwners.push({ name, value });
  }
}
let validators = 0;
for (const [rel, mod] of loaded) {
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== 'function' || !/^validate.*Stats$/.test(name)) continue;
    if (statOwners.length === 0) {
      failures.push(`${rel} exports ${name} but no *_BASE_STATS object exists to validate against`);
      continue;
    }
    for (const owner of statOwners) {
      validators += 1;
      const problems = fn(Object.keys(owner.value));
      if (!Array.isArray(problems)) continue;
      for (const problem of problems) {
        failures.push(`${name}(${owner.name}): ${problem} — a card that costs a level-up and does nothing`);
      }
    }
  }
}
if (validators === 0 && statOwners.length > 0) {
  notes.push('no validate*Stats export found: upgrade modifiers are not checked against the stat surface');
}

/* --------------------- C6: the game's own numeric invariants ---------------- */

/**
 * The one thing that cannot be derived: a RELATION between two numbers that
 * only the design knows, e.g. "the collapse ring must stay wider than the
 * extraction gate or the finale is unreachable". Games author these in an
 * optional sidecar; there is no path list, no key list, only predicates.
 *
 *   // scripts/contract-invariants.mjs
 *   export function invariants({ tuning, data }) {
 *     const fail = [];
 *     if (tuning.TUNING.collapse.minRadius <= tuning.TUNING.gate.radius) {
 *       fail.push(`collapse.minRadius ${…} <= gate.radius ${…}: the ring closes over the gate`);
 *     }
 *     return { failures: fail, notes: [] };
 *   }
 */
const SIDECAR = join(ROOT, 'scripts/contract-invariants.mjs');
if (existsSync(SIDECAR)) {
  const sidecar = await import(pathToFileURL(SIDECAR).href);
  if (typeof sidecar.invariants !== 'function') {
    failures.push('scripts/contract-invariants.mjs exists but exports no `invariants` function');
  } else {
    const tuning = Object.fromEntries(roots.map((r) => [r.name, r.value]));
    const result = sidecar.invariants({ tuning, data: loaded, collections }) ?? {};
    for (const failure of result.failures ?? []) failures.push(`invariant: ${failure}`);
    for (const note of result.notes ?? []) notes.push(`invariant: ${note}`);
  }
} else {
  notes.push('no scripts/contract-invariants.mjs: no game-specific numeric invariants are being checked');
}

/* ---------------------------------------------------------------- output --- */

report('content contract check', {
  failures,
  notes,
  summary: `checked ${pathCount} read TUNING paths, ${collections.length} content collections, `
    + `${paramRows} param bags, ${nestedIds.size} nested id namespace(s), ${scheduleChecks} schedule(s), `
    + `${validators} stat validator run(s)`,
});
