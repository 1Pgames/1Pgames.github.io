import { TUNING } from '../config';
import type { Rng } from '../core/rng';
import { ZONES } from './zones';

/**
 * Relic table (PRD §5.5) — Duskhaul's loot atoms. A relic is simultaneously
 * carried value (salvage shards) and permanent gear: banked relics equip into
 * one of three slots (§10 `gear`) and fold their `gear` entries into the
 * player's `StatBlock` as `Modifier`s at run start.
 *
 * Frozen §16.1 contract implemented verbatim: `RelicTier`, `RelicDef`,
 * `rollRelic(rng, zoneId, tierBias)`. `effect` is the one ADDITIVE field —
 * three §5.5 riders (i-frames, contact-damage reduction, gate windows) are not
 * `StatKey`s, and the frozen `StatKey` union may not be forked, so they ride
 * here exactly the way `UpgradeDef.effect` carries non-stat card behaviour.
 *
 * Pure data + one seeded roll. ZERO Phaser imports, ZERO `Math.random` — the
 * headless sim rolls loot through the same `Rng` the scene uses, so a seed
 * reproduces a run's whole haul.
 */

/**
 * The stat keys content is allowed to touch (frozen §16.1 drift surface).
 * `core/stats.ts` types `StatKey` as `string` (it is a generic engine module
 * shared by every family), so the NARROW union lives here, in the content
 * layer the contract actually freezes. W6 mirrors this list into
 * `PLAYER_BASE_STATS` during integration — until it does, `validateUpgradeStats`
 * reports these keys as unread, which is the intended signal, not a bug.
 */
export type StatKey =
  | 'maxHp'
  | 'moveSpeed'
  | 'damageMul'
  | 'cooldownMul'
  | 'area'
  | 'critChance'
  | 'critMul'
  | 'pickupRadius'
  | 'shardsMul'
  | 'channelMs'
  | 'bagSlots';

export type RelicTier = 1 | 2 | 3 | 4;

/** Equip slots (§5.5): one relic each, so gear power is capped by slot count. */
export type RelicSlot = 'blade' | 'shroud' | 'trinket';

/** A single stat change a relic grants while equipped. `mul` is a +fraction. */
export interface RelicGearMod {
  stat: StatKey;
  add?: number;
  mul?: number;
}

/**
 * Non-stat gear rider. Three §5.5 relics modify systems rather than stats:
 * `iframesMs` extends `Health`'s contact invulnerability, `contactDamageMul`
 * scales incoming contact damage (negative = reduction), `gateWindowS`
 * lengthens every gate's open window (the same valve as §10 `m_ward`).
 *
 * These are MAGNITUDES, not application points. The equipped relic's value is
 * written into the single slot the systems read — `gateWindowS` into
 * `TUNING.extract.gateWindowBonusS`, and Gravekey's `channelMs` gear entry into
 * `TUNING.extract.channelMsDelta` (effective channel = `max(channelMsFloor,
 * channelMs + delta)`) — so scene and sim agree by construction and neither
 * reimplements the rule. Those TUNING keys default to 0: they are where the
 * relic's number LANDS, which is why the number itself lives here.
 */
export interface RelicEffect {
  kind: 'iframesMs' | 'contactDamageMul' | 'gateWindowS';
  value: number;
}

export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  tier: RelicTier;
  salvage: number;
  slot: RelicSlot;
  gear: RelicGearMod[];
  effect?: RelicEffect;
}

/**
 * Tier display names (§5.5). Index by tier - 1, and fall back to `''` rather
 * than throwing: every consumer is a repaint (`scenes/menu`, `scenes/meta`,
 * `scenes/gameover`), and a HUD that crashes on a malformed tier is worse than
 * one that shows a blank chip.
 */
export const TIER_NAMES: readonly string[] = ['Tarnished', 'Burnished', 'Gilded', 'Dread'];

/** Tier ladder, for the code that has to walk all four. Internal: see `rollRelic`. */
const RELIC_TIERS: readonly RelicTier[] = [1, 2, 3, 4];

/**
 * Salvage value per tier — read from `TUNING.loot.salvage` rather than written
 * per row, so the 10/30/80/200 ladder exists in exactly one place (§7).
 */
export function salvageFor(tier: RelicTier): number {
  const value = TUNING.loot.salvage[tier - 1];
  if (value === undefined) throw new Error(`TUNING.loot.salvage has no entry for tier ${tier}`);
  return value;
}

/** 16 relics, 4 per tier. Names and descriptions are §5.5 copy, verbatim. */
export const RELICS: readonly RelicDef[] = [
  // --- Tier 1 Tarnished ----------------------------------------------------
  {
    id: 'r_toothcharm',
    name: 'Rat-Tooth Charm',
    desc: "A pauper's luck, strung on gut",
    tier: 1,
    salvage: salvageFor(1),
    slot: 'trinket',
    gear: [{ stat: 'shardsMul', mul: 0.05 }],
  },
  {
    id: 'r_rustbuckle',
    name: 'Rust Buckle',
    desc: "A soldier's belt, long outlived",
    tier: 1,
    salvage: salvageFor(1),
    slot: 'shroud',
    gear: [{ stat: 'maxHp', add: 5 }],
  },
  {
    id: 'r_waxseal',
    name: 'Grave Waxseal',
    desc: 'A parish seal pressed in black wax',
    tier: 1,
    salvage: salvageFor(1),
    slot: 'blade',
    gear: [{ stat: 'damageMul', mul: 0.03 }],
  },
  {
    id: 'r_bonedice',
    name: 'Bone Dice',
    desc: "Carved from a cheater's knuckles",
    tier: 1,
    salvage: salvageFor(1),
    slot: 'trinket',
    gear: [{ stat: 'critChance', add: 0.02 }],
  },

  // --- Tier 2 Burnished ----------------------------------------------------
  {
    id: 'r_thornring',
    name: 'Thornband',
    desc: 'An iron ring that bites its wearer',
    tier: 2,
    salvage: salvageFor(2),
    slot: 'blade',
    gear: [{ stat: 'damageMul', mul: 0.06 }],
  },
  {
    id: 'r_ashlocket',
    name: 'Ash Locket',
    desc: 'Holds a pinch of someone loved',
    tier: 2,
    salvage: salvageFor(2),
    slot: 'shroud',
    gear: [{ stat: 'maxHp', add: 12 }],
  },
  {
    id: 'r_gloamboot',
    name: 'Gloam Spur',
    desc: "A rider's spur that hums at dusk",
    tier: 2,
    salvage: salvageFor(2),
    slot: 'trinket',
    gear: [{ stat: 'moveSpeed', mul: 0.05 }],
  },
  {
    id: 'r_dirgepipe',
    name: 'Dirge Pipe',
    desc: 'Plays itself when the dead draw near',
    tier: 2,
    salvage: salvageFor(2),
    slot: 'trinket',
    gear: [{ stat: 'pickupRadius', add: 25 }],
  },

  // --- Tier 3 Gilded -------------------------------------------------------
  {
    id: 'r_marrowidol',
    name: 'Marrow Idol',
    desc: 'A fetish of boiled bone and wire',
    tier: 3,
    salvage: salvageFor(3),
    slot: 'blade',
    gear: [{ stat: 'cooldownMul', mul: -0.06 }],
  },
  {
    id: 'r_widowveil',
    name: "Widow's Veil",
    desc: 'Grief woven fine enough to stop teeth',
    tier: 3,
    salvage: salvageFor(3),
    slot: 'shroud',
    gear: [{ stat: 'maxHp', add: 20 }],
    effect: { kind: 'iframesMs', value: 100 },
  },
  {
    id: 'r_giltskull',
    name: 'Gilt Skull',
    desc: 'A tax collector, repurposed',
    tier: 3,
    salvage: salvageFor(3),
    slot: 'trinket',
    gear: [{ stat: 'shardsMul', mul: 0.15 }],
  },
  {
    id: 'r_pyreheart',
    name: 'Pyreheart',
    desc: 'Still warm; nobody asks whose',
    tier: 3,
    salvage: salvageFor(3),
    slot: 'blade',
    gear: [{ stat: 'area', mul: 0.1 }],
  },

  // --- Tier 4 Dread --------------------------------------------------------
  {
    id: 'r_dreadcrown',
    name: 'Dread Crown',
    desc: "The Warden's circlet of black iron",
    tier: 4,
    salvage: salvageFor(4),
    slot: 'blade',
    gear: [
      { stat: 'damageMul', mul: 0.12 },
      { stat: 'critMul', add: 0.3 },
    ],
  },
  {
    id: 'r_sorrowplate',
    name: 'Sorrowplate',
    desc: "Armor quenched in a widow's well",
    tier: 4,
    salvage: salvageFor(4),
    slot: 'shroud',
    gear: [{ stat: 'maxHp', add: 30 }],
    effect: { kind: 'contactDamageMul', value: -0.2 },
  },
  {
    id: 'r_gravekey',
    name: 'Gravekey',
    desc: 'Opens doors the living never should',
    tier: 4,
    salvage: salvageFor(4),
    slot: 'trinket',
    gear: [{ stat: 'channelMs', add: -800 }],
  },
  {
    id: 'r_duskmirror',
    name: 'Duskmirror',
    desc: 'Shows the arena; the arena looks back',
    tier: 4,
    salvage: salvageFor(4),
    slot: 'trinket',
    gear: [],
    effect: { kind: 'gateWindowS', value: 20 },
  },
];

const BY_ID: Record<string, RelicDef> = {};
const BY_TIER: Record<RelicTier, RelicDef[]> = { 1: [], 2: [], 3: [], 4: [] };
for (const relic of RELICS) {
  BY_ID[relic.id] = relic;
  BY_TIER[relic.tier].push(relic);
}

export function relicDef(id: string): RelicDef {
  const def = BY_ID[id];
  if (def === undefined) throw new Error(`Unknown relic id "${id}"`);
  return def;
}

/**
 * Tier draw weights for one roll (§5.5 drop rule), in tier order t1..t4.
 *
 * Three inputs compose, and the ORDER matters:
 *  1. `TUNING.loot.tierWeights` — the 60/27/10/3 base ladder.
 *  2. The zone's `lootBias` — additive percentage points on that ladder
 *     (§5.7), clamped at 0 so a bias can never make a weight negative. The
 *     zone reshapes the LADDER.
 *  3. `tierBias` — the SOURCE shift (+1 chest/elite, +2 Shrine/Warden), applied
 *     LAST. Each weight MOVES UP that many tiers and overflow past t4
 *     accumulates there, so the distribution's mass is conserved.
 *
 * Shifting last is what makes the advertised guarantees exact rather than
 * approximate: at +2 every t1/t2 weight has vacated, so the Shrine's
 * "guaranteed Gilded-or-Dread" holds in EVERY zone. Applying the zone bias
 * after the shift instead would leave castle's +5 t2 sitting under a +2 roll
 * and give the Shrine a ~5% chance of a Burnished trinket.
 *
 * Exported because the §19 loot gate in `sim/families/arena.ts` asserts the
 * ladder ANALYTICALLY instead of sampling it: "a +2 source roll never produces
 * below Gilded" is a promise §5.5 makes to the player in every zone, and a
 * sampled proof of a never-claim is not a proof.
 */
export function relicTierWeights(zoneId: string, tierBias: number): number[] {
  const ladder = [0, 0, 0, 0];
  const base = TUNING.loot.tierWeights;
  for (let i = 0; i < ladder.length; i += 1) ladder[i] = base[i] ?? 0;

  const zone = ZONES.find((z) => z.id === zoneId);
  if (zone !== undefined) {
    for (const tier of RELIC_TIERS) {
      const bias = zone.lootBias[tier];
      if (bias === undefined) continue;
      const index = tier - 1;
      ladder[index] = Math.max(0, (ladder[index] ?? 0) + bias);
    }
  }

  const shift = Math.max(0, Math.round(tierBias));
  if (shift === 0) return ladder;

  const weights = [0, 0, 0, 0];
  for (let i = 0; i < ladder.length; i += 1) {
    const target = Math.min(weights.length - 1, i + shift);
    weights[target] = (weights[target] ?? 0) + (ladder[i] ?? 0);
  }
  return weights;
}

/**
 * Rolls one relic (§16.1). `zoneId` selects the zone loot bias (an unknown id
 * simply contributes no bias); `tierBias` is the source shift documented on
 * `relicTierWeights`. Tier is drawn weighted, then the relic uniformly from
 * that tier — every draw goes through the seeded `Rng`.
 */
export function rollRelic(rng: Rng, zoneId: string, tierBias: number): RelicDef {
  const weights = relicTierWeights(zoneId, tierBias);

  // Zero-weight tiers are dropped BEFORE the draw. `Rng.pickWeighted` walks the
  // list subtracting weights and returns the first entry where the running roll
  // reaches 0, so a leading zero-weight tier is reachable on a roll of exactly
  // 0. That is a 1-in-2^32 event, but it is the difference between the §5.5
  // Shrine/Warden guarantee being exact and being merely near-certain.
  const tiers: RelicTier[] = [];
  const live: number[] = [];
  for (const tier of RELIC_TIERS) {
    const weight = weights[tier - 1] ?? 0;
    if (weight <= 0) continue;
    tiers.push(tier);
    live.push(weight);
  }
  if (tiers.length === 0) throw new Error(`No relic tier has any weight in zone "${zoneId}"`);

  const tier = rng.pickWeighted(tiers, live);
  return rng.pick(BY_TIER[tier]);
}
