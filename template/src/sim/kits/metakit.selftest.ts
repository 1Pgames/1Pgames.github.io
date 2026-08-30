// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/metakit.selftest.ts
import assert from 'node:assert/strict';
import {
  DEFAULT_META,
  MAX_STARS,
  addToCollection,
  bestStars,
  boosterCount,
  boosterCounts,
  boosterPrice,
  buyBooster,
  grantBooster,
  grantCurrency,
  loadMeta,
  ownedPieces,
  recordStars,
  resetMeta,
  spendBooster,
  totalStars,
  touchDailyStreak,
} from '../../core/progression';
import { collectionProgress, rollMissingPiece } from '../../core/collections';
import { UNLIMITED, metaCatalogFor } from '../../data/metaCatalog';
import { save } from '../../core/storage';
import type { CollectionSetDef } from '../../core/collections';
import { Rng } from '../../core/rng';

/**
 * Meta-kit guards: the star / streak / collection / booster half of
 * `core/progression.ts` plus `core/collections.ts`. Everything here is
 * headless — the saga map and booster picker are presentation and are verified
 * in the browser, not in Node.
 *
 * `core/storage.ts` talks to a bare `localStorage`, which Node does not
 * provide (its wrapper then swallows the ReferenceError and every save becomes
 * a no-op). A minimal in-memory stand-in, installed before the first
 * progression *call* (module bodies never touch storage), gives the real
 * persistence path — including the migration branch, which has to read a stale
 * blob back off "disk".
 */
const store = new Map<string, string>();
Reflect.set(globalThis, 'localStorage', {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, value);
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
  clear: (): void => store.clear(),
});

/**
 * The meta save's real storage slot, PROBED through core/storage.ts instead of
 * hardcoding the namespace: new-game.sh rewrites `NS = 'gt:'` to the game's
 * slug at scaffold time, and a hardcoded 'gt:meta' broke every scaffolded
 * game's verify while passing in the template.
 */
const META_SLOT = ((): string => {
  store.clear();
  save('meta-slot-probe', 1);
  const probed = [...store.keys()].find((k) => k.endsWith('meta-slot-probe'));
  store.clear();
  if (probed === undefined) throw new Error('storage probe failed');
  return probed.slice(0, -'meta-slot-probe'.length) + 'meta';
})();

function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// --- migration: a version-1 save (the shape shipped before the meta kit) loads
// --- with every v1 field preserved and every v2 field defaulted.
{
  store.clear();
  const v1 = {
    version: 1,
    currency: 425,
    unlocks: ['hero-b'],
    upgrades: { 'meta-hp': 3 },
    stats: { runs: 12, wins: 4, bestScore: 9100, bestTimeMs: 305000 },
  };
  store.set(META_SLOT, JSON.stringify(v1));

  const migrated = loadMeta();
  // The invariant is "a v1 save lands on the CURRENT version", never "on version 2".
  // A frozen literal turns the next legitimate schema bump into a red kit-selftest
  // for the wrong reason, and whoever then bumps the literal to match has silently
  // disabled the migration-chain check. Duskhaul hit exactly this on v2 -> v3.
  assert.equal(migrated.version, DEFAULT_META.version, 'v1 save must land on the current version');
  assert.equal(migrated.currency, 425, 'currency survives migration');
  assert.deepEqual(migrated.unlocks, ['hero-b'], 'unlocks survive migration');
  assert.deepEqual(migrated.upgrades, { 'meta-hp': 3 }, 'purchased upgrades survive migration');
  assert.deepEqual(migrated.stats, v1.stats, 'lifetime stats survive migration');
  assert.deepEqual(migrated.stars, {}, 'stars default to empty');
  assert.deepEqual(migrated.streak, { days: 0, lastDayKey: '' }, 'streak defaults to none');
  assert.deepEqual(migrated.collections, {}, 'collections default to empty');
  assert.deepEqual(migrated.boosters, {}, 'boosters default to empty');

  // The migrated save is persisted, so the next boot takes the fast path.
  const persisted: unknown = JSON.parse(store.get(META_SLOT) ?? '{}');
  assert.ok(
    typeof persisted === 'object' && persisted !== null && 'version' in persisted && 'currency' in persisted,
    'the persisted blob is an object carrying the migrated fields',
  );
  assert.equal(persisted.version, DEFAULT_META.version, 'migration is written back to storage');
  assert.equal(persisted.currency, 425, 'the written-back save keeps v1 data');
}

// --- a partial / garbage blob still yields a usable save (defensive coercion) ---
{
  store.clear();
  store.set(META_SLOT, JSON.stringify({ version: 2, currency: 10, stars: null, boosters: 'nope' }));
  const meta = loadMeta();
  assert.equal(meta.currency, 10);
  assert.deepEqual(meta.stars, {}, 'null record coerces to empty');
  assert.deepEqual(meta.collections, {}, 'missing record coerces to empty');
  assert.equal(boosterCount('bomb'), 0, 'non-object boosters blob reads as zero counts');
}

// --- DEFAULT_META must never be mutated by a write against a fresh save ---
{
  store.clear();
  grantCurrency(50);
  grantBooster('bomb', 2);
  recordStars('l-1', 3);
  addToCollection('set-a', 'p1');
  assert.equal(DEFAULT_META.currency, 0, 'DEFAULT_META.currency stays pristine');
  assert.deepEqual(DEFAULT_META.stars, {}, 'DEFAULT_META.stars stays pristine');
  assert.deepEqual(DEFAULT_META.boosters, {}, 'DEFAULT_META.boosters stays pristine');
  assert.deepEqual(DEFAULT_META.collections, {}, 'DEFAULT_META.collections stays pristine');
  assert.deepEqual(DEFAULT_META.unlocks, [], 'DEFAULT_META.unlocks stays pristine');
}

// --- stars keep the best result, clamp to 0..MAX_STARS, and total up ---
{
  resetMeta();
  assert.equal(bestStars('l-1'), 0, 'unplayed level has no stars');

  recordStars('l-1', 2);
  assert.equal(bestStars('l-1'), 2);
  recordStars('l-1', 1);
  assert.equal(bestStars('l-1'), 2, 'a worse replay must not take stars away');
  recordStars('l-1', 3);
  assert.equal(bestStars('l-1'), 3, 'a better replay upgrades the rating');

  recordStars('l-2', 99);
  assert.equal(bestStars('l-2'), MAX_STARS, 'ratings clamp to MAX_STARS');
  recordStars('l-3', -4);
  assert.equal(bestStars('l-3'), 0, 'negative ratings clamp to zero');
  recordStars('l-4', 2.9);
  assert.equal(bestStars('l-4'), 2, 'fractional ratings floor');

  assert.equal(totalStars(), 3 + 3 + 0 + 2, 'totalStars sums every level');
  assert.equal(loadMeta().stars['l-1'], 3, 'stars persist through storage');
}

// --- daily streak: idempotent same-day, +1 on yesterday, reset after a gap ---
{
  resetMeta();
  const day1 = new Date(2026, 2, 10, 9, 0, 0); // local time on purpose
  const day1Late = new Date(2026, 2, 10, 23, 59, 0);
  const day2 = new Date(2026, 2, 11, 8, 0, 0);
  const day3 = new Date(2026, 2, 12, 8, 0, 0);
  const day6 = new Date(2026, 2, 15, 8, 0, 0);

  assert.deepEqual(touchDailyStreak(day1), { days: 1, extended: false }, 'first ever touch starts at 1');
  assert.equal(loadMeta().streak.lastDayKey, dayKey(day1), 'last day is stored as a local YYYY-MM-DD key');

  assert.deepEqual(
    touchDailyStreak(day1Late),
    { days: 1, extended: false },
    'a second touch on the same local day changes nothing',
  );

  assert.deepEqual(touchDailyStreak(day2), { days: 2, extended: true }, 'yesterday extends the streak');
  assert.deepEqual(touchDailyStreak(day3), { days: 3, extended: true }, 'and again the next day');
  assert.deepEqual(touchDailyStreak(day3), { days: 3, extended: false }, 'still idempotent at 3 days');
  assert.deepEqual(touchDailyStreak(day6), { days: 1, extended: false }, 'a three-day gap resets to 1');

  // Month and year rollovers must use local dates, not string arithmetic.
  resetMeta();
  touchDailyStreak(new Date(2026, 1, 28, 12, 0, 0));
  assert.deepEqual(
    touchDailyStreak(new Date(2026, 2, 1, 12, 0, 0)),
    { days: 2, extended: true },
    'Feb 28 -> Mar 1 (2026 is not a leap year) is consecutive',
  );
  resetMeta();
  touchDailyStreak(new Date(2025, 11, 31, 12, 0, 0));
  assert.deepEqual(
    touchDailyStreak(new Date(2026, 0, 1, 12, 0, 0)),
    { days: 2, extended: true },
    'Dec 31 -> Jan 1 is consecutive',
  );
}

// --- boosters: grant stacks, spend decrements, and the count floors at zero ---
{
  resetMeta();
  assert.equal(boosterCount('bomb'), 0);
  assert.equal(spendBooster('bomb'), false, 'spending what you do not own fails');
  assert.equal(boosterCount('bomb'), 0, 'a failed spend writes nothing');

  grantBooster('bomb', 2);
  grantBooster('bomb', 1);
  assert.equal(boosterCount('bomb'), 3, 'grants stack');

  assert.equal(spendBooster('bomb'), true);
  assert.equal(spendBooster('bomb'), true);
  assert.equal(spendBooster('bomb'), true);
  assert.equal(boosterCount('bomb'), 0);
  assert.equal(spendBooster('bomb'), false, 'the fourth spend of three boosters fails');
  assert.equal(boosterCount('bomb'), 0, 'counts never go negative');

  grantBooster('swap', 1);
  grantBooster('swap', -5);
  assert.equal(boosterCount('swap'), 0, 'a negative grant floors at zero instead of wrapping');
  assert.equal(boosterCount('bomb'), 0, 'booster ids are independent');
}

// --- buyBooster: unlimited, priced off the STOCKPILE, and it grants itself ---
{
  resetMeta();
  const ladle = { id: 'meta_ladle', boosterId: 'ladle', baseCost: 70, costGrowth: 1.35, boosterPerLevel: 1 };
  assert.equal(boosterPrice(ladle), 70, 'the first one costs base');

  assert.equal(buyBooster(ladle).ok, false, 'a broke player buys nothing');
  assert.equal(boosterCount('ladle'), 0, 'and nothing is written');

  grantCurrency(1000);
  const first = buyBooster(ladle);
  assert.equal(first.ok, true);
  assert.equal(first.cost, 70);
  assert.equal(boosterCount('ladle'), 1, 'buyBooster grants the consumable itself');
  assert.equal(first.meta.upgrades.meta_ladle, 1, 'and keeps the lifetime purchase counter');
  assert.equal(first.meta.currency, 930);

  assert.equal(boosterPrice(ladle), 95, 'the second costs 70 * 1.35');
  assert.equal(buyBooster(ladle).cost, 95);
  assert.equal(boosterCount('ladle'), 2);

  // Spending brings the price back down: the curve prices HOARDING, not history.
  assert.equal(spendBooster('ladle'), true);
  assert.equal(spendBooster('ladle'), true);
  assert.equal(boosterPrice(ladle), 70, 'an empty bag is cheap again');
  assert.equal(loadMeta().upgrades.meta_ladle, 2, 'while lifetime purchases only ever grow');

  // No cap: enough coins is the ONLY gate, however many have been bought.
  resetMeta();
  grantCurrency(100000);
  for (let i = 0; i < 12; i += 1) {
    assert.equal(buyBooster(ladle).ok, true, `purchase ${i + 1} must not hit a cap`);
    assert.equal(spendBooster('ladle'), true);
  }
  assert.equal(loadMeta().upgrades.meta_ladle, 12, 'twelve bought, no ceiling');

  grantBooster('broom', 3);
  assert.deepEqual(
    boosterCounts(['ladle', 'broom', 'extra-moves']),
    { ladle: 0, broom: 3, 'extra-moves': 0 },
    'a batched read defaults every unknown id to zero',
  );
}

// --- the shipped board catalog really is uncapped, and every id is unique ---
{
  const board = metaCatalogFor('board');
  const boosters = board.filter((entry) => entry.kind === 'booster');
  assert.equal(boosters.length, 7, 'three pre-level and four in-level consumables');
  for (const entry of boosters) {
    assert.equal(entry.maxLevel, UNLIMITED, `${entry.id} must be uncapped`);
    assert.notEqual(entry.boosterId, undefined, `${entry.id} must name an inventory id`);
  }
  for (const id of ['ladle', 'broom', 'pestle', 'whisk']) {
    assert.ok(
      boosters.some((entry) => entry.boosterId === id),
      `the board shop must sell '${id}'`,
    );
  }
  const ids = new Set(board.map((entry) => entry.id));
  assert.equal(ids.size, board.length, 'catalog ids are save keys and must be unique');

  // Every family's consumables, not just the board's: a capped shelf goes empty.
  for (const family of ['arena', 'side', 'word', 'hyper', 'idle', 'table', 'track']) {
    for (const entry of metaCatalogFor(family)) {
      if (entry.kind !== 'booster') continue;
      assert.equal(entry.maxLevel, UNLIMITED, `${family}/${entry.id} must be uncapped`);
    }
  }
}

// --- collections: progress, no duplicate grants, completion needs the set size ---
const SET: CollectionSetDef = {
  id: 'relics',
  name: 'Relics',
  pieces: [
    { id: 'crown', name: 'Crown' },
    { id: 'orb', name: 'Orb' },
    { id: 'rod', name: 'Rod' },
    { id: 'seal', name: 'Seal' },
    { id: 'shard', name: 'Shard' },
  ],
};

{
  const empty = collectionProgress(SET, []);
  assert.equal(empty.owned, 0);
  assert.equal(empty.total, 5);
  assert.equal(empty.ratio, 0);
  assert.equal(empty.complete, false);
  assert.deepEqual(empty.missing, ['crown', 'orb', 'rod', 'seal', 'shard']);

  const partial = collectionProgress(SET, ['orb', 'orb', 'ghost-piece']);
  assert.equal(partial.owned, 1, 'duplicates and unknown ids do not inflate the count');
  assert.equal(partial.ratio, 0.2);
  assert.deepEqual(partial.missing, ['crown', 'rod', 'seal', 'shard']);

  const full = collectionProgress(SET, ['shard', 'seal', 'rod', 'orb', 'crown']);
  assert.equal(full.complete, true);
  assert.equal(full.ratio, 1);
  assert.deepEqual(full.missing, []);
}

{
  resetMeta();
  assert.deepEqual(addToCollection(SET.id, 'crown', SET.pieces.length), { added: true, completed: false });
  assert.deepEqual(
    addToCollection(SET.id, 'crown', SET.pieces.length),
    { added: false, completed: false },
    'a duplicate grant is reported, not stored twice',
  );
  assert.deepEqual(ownedPieces(SET.id), ['crown'], 'the owned list holds one entry');

  for (const piece of ['orb', 'rod', 'seal']) addToCollection(SET.id, piece, SET.pieces.length);
  assert.deepEqual(addToCollection(SET.id, 'shard', SET.pieces.length), { added: true, completed: true });
  assert.equal(
    addToCollection(SET.id, 'shard').completed,
    false,
    'without a set size, completion is unknowable and reported false',
  );
  assert.deepEqual(ownedPieces(SET.id).slice().sort(), ['crown', 'orb', 'rod', 'seal', 'shard']);
  assert.deepEqual(ownedPieces('unknown-set'), [], 'an untouched set owns nothing');
}

// --- rollMissingPiece: never a duplicate, always completes, null when done ---
{
  const limit = SET.pieces.length * 3;
  for (let seed = 0; seed < 100; seed += 1) {
    resetMeta();
    const rng = new Rng(seed);
    const seen = new Set<string>();
    let rolls = 0;

    while (rolls < limit) {
      const piece = rollMissingPiece(SET, ownedPieces(SET.id), rng);
      if (piece === null) break;
      rolls += 1;
      assert.equal(seen.has(piece), false, `seed ${seed}: rolled a piece it already owned (${piece})`);
      seen.add(piece);
      const result = addToCollection(SET.id, piece, SET.pieces.length);
      assert.equal(result.added, true, `seed ${seed}: a rolled piece must always be new`);
    }

    const progress = collectionProgress(SET, ownedPieces(SET.id));
    assert.equal(progress.complete, true, `seed ${seed}: set must complete within ${limit} rolls`);
    assert.ok(rolls <= limit, `seed ${seed}: took ${rolls} rolls`);
    assert.equal(
      rollMissingPiece(SET, ownedPieces(SET.id), rng),
      null,
      `seed ${seed}: a complete set rolls null`,
    );
  }
}

// --- resetMeta clears the meta-kit slots too ---
{
  recordStars('l-9', 3);
  grantBooster('bomb', 4);
  addToCollection('relics', 'crown');
  touchDailyStreak(new Date(2026, 4, 4, 12, 0, 0));
  const fresh = resetMeta();
  assert.deepEqual(fresh.stars, {});
  assert.deepEqual(fresh.boosters, {});
  assert.deepEqual(fresh.collections, {});
  assert.deepEqual(fresh.streak, { days: 0, lastDayKey: '' });
  assert.equal(totalStars(), 0, 'a reset save has no stars on disk either');
}

console.log('metakit selftest: OK');
