/**
 * Ground pickups (PRD-V2 §5.13), breakable drop table, and belt consumables
 * (§5.27: `data/pickups.ts` defines, WS-Meta buys, WS-Loot uses). Pure TS —
 * the sim and selftests import it headless.
 */
import { TUNING } from '../config';
import type { Rng } from '../core/rng';
import type { ConsumableId, PickupDrop, PickupId } from './types-v2';

export interface PickupDef { id: PickupId; name: string; effect: string; art: string }
export interface ConsumableDef { id: ConsumableId; name: string; price: number; effect: string; icon: string }

const PICKUPS: readonly PickupDef[] = [
  { id: 'pk_bread', name: 'Grave Bread', effect: `Heal ${TUNING.pickups.bread.heal} hp`, art: 'pk-bread' },
  { id: 'pk_bell', name: 'Dirge Bell', effect: 'Vacuum every XP orb on the map', art: 'pk-bell' },
  {
    id: 'pk_flask',
    name: 'Pyre Flask',
    effect: `${TUNING.pickups.flask.damage} damage to all enemies within ${TUNING.pickups.flask.radius} px`,
    art: 'pk-flask',
  },
  {
    id: 'pk_salt',
    name: 'Frost Salt',
    effect: `Freeze enemies within ${TUNING.pickups.salt.radius} px for ${TUNING.pickups.salt.freezeMs / 1000} s`,
    art: 'pk-salt',
  },
];

/** Art ids for the two non-`PickupId` ground atoms (§11 pickups group). */
export const PICKUP_ART = { xpCluster: 'pk-xpcluster', key: 'pk-key' } as const;

export const CONSUMABLES: readonly ConsumableDef[] = [
  { id: 'cb_bread', name: 'Grave Bread', price: 40, effect: 'Heal 40% max HP', icon: 'icon-cb-cb_bread' },
  { id: 'cb_flask', name: 'Pyre Flask', price: 60, effect: '120 damage within 600 px', icon: 'icon-cb-cb_flask' },
  { id: 'cb_salt', name: 'Frost Salt', price: 50, effect: 'Freeze enemies within 700 px for 3 s', icon: 'icon-cb-cb_salt' },
  { id: 'cb_candle', name: 'Ward Candle', price: 120, effect: '+1 casket slot this run (use before your first pickup)', icon: 'icon-cb-cb_candle' },
  { id: 'cb_oil', name: 'Lantern Oil', price: 45, effect: 'Reveal all POIs on the minimap for 60 s', icon: 'icon-cb-cb_oil' },
];

const PICKUP_BY_ID: Record<string, PickupDef> = Object.fromEntries(PICKUPS.map((p) => [p.id, p]));

export function pickupDef(id: PickupId): PickupDef {
  const def = PICKUP_BY_ID[id];
  if (def === undefined) throw new Error(`Unknown pickup id "${id}"`);
  return def;
}

/**
 * §16.1 E21: one breakable's drop. Non-shard chances are multiplied by `mul`
 * (`breakable.dropBonus` / `loadout.breakableDropMul`) and rolled first; shards
 * fill the rest of the unit interval (so every breakable drops something while
 * the non-shard chances sum below 1). `lowHp` (hero below
 * `drops.pk_bread.lowHpRatio`) raises Grave Bread to `lowHpChance` — the
 * reliable in-run heal (critic v2c M1).
 */
export function rollBreakableDrop(rng: Rng, mul: number, lowHp = false): PickupDrop | null {
  const d = TUNING.breakable.drops;
  const m = Math.max(0, mul);
  let roll = rng.next();
  const bread = lowHp ? d.pk_bread.lowHpChance : d.pk_bread.chance;
  const nonShard: [number, () => PickupDrop][] = [
    [d.xp.chance * m, () => ({ kind: 'xp', orbs: d.xp.orbs, value: d.xp.value })],
    [bread * m, () => ({ kind: 'pickup', id: 'pk_bread' })],
    [d.pk_bell.chance * m, () => ({ kind: 'pickup', id: 'pk_bell' })],
    [d.pk_flask.chance * m, () => ({ kind: 'pickup', id: 'pk_flask' })],
    [d.pk_salt.chance * m, () => ({ kind: 'pickup', id: 'pk_salt' })],
    [d.item.chance * m, () => ({ kind: 'item', tierBias: d.item.tierBias })],
  ];
  for (const [chance, make] of nonShard) {
    if (roll < chance) return make();
    roll -= chance;
  }
  return { kind: 'shards', coins: rng.int(d.shards.coins[0], d.shards.coins[1]) };
}

/** What a used belt charge does; `game.ts` applies it (§5.27 numbers). */
export type ConsumableEffect =
  | { kind: 'heal'; hp: number }
  | { kind: 'damage'; amount: number; radius: number }
  | { kind: 'freeze'; ms: number; radius: number }
  | { kind: 'casket'; slots: number }
  | { kind: 'reveal'; ms: number };

function consumableEffect(id: ConsumableId, maxHp: number): ConsumableEffect {
  switch (id) {
    case 'cb_bread':
      return { kind: 'heal', hp: Math.round(maxHp * 0.4) };
    case 'cb_flask':
      return { kind: 'damage', amount: 120, radius: 600 };
    case 'cb_salt':
      return { kind: 'freeze', ms: 3000, radius: 700 };
    case 'cb_candle':
      return { kind: 'casket', slots: 1 };
    case 'cb_oil':
      return { kind: 'reveal', ms: 60000 };
  }
}

/** Double-tap guard between two charges of one slot (HUD `coolingMs`). */
const BELT_LOCKOUT_MS = 600;

/**
 * In-run belt (§5.27 use side). Built from `loadout.belt`; charges consumed here
 * are reported by `used()` (→ `RunReport.beltUsed`) so WS-Meta decrements only
 * what was actually spent — unused charges persist in the save.
 */
export class Belt {
  private readonly slots: ({ id: ConsumableId; charges: number } | null)[];
  private readonly cooling: number[];
  private readonly spent: ConsumableId[] = [];

  constructor(loadoutBelt: readonly ({ id: ConsumableId; charges: number } | null)[]) {
    this.slots = loadoutBelt.map((s) => (s === null || s.charges <= 0 ? null : { id: s.id, charges: s.charges }));
    this.cooling = this.slots.map(() => 0);
  }

  update(deltaMs: number): void {
    for (let i = 0; i < this.cooling.length; i += 1) this.cooling[i] = Math.max(0, (this.cooling[i] ?? 0) - deltaMs);
  }

  /**
   * Spends one charge of slot `index` and returns its effect, or null (nothing
   * consumed) when the slot is empty/cooling or the Ward Candle is pressed after
   * the bag already took an item (`itemsPickedUp > 0`, §5.27 "use before first pickup").
   */
  use(index: number, ctx: { maxHp: number; itemsPickedUp: number }): ConsumableEffect | null {
    const slot = this.slots[index];
    if (slot === undefined || slot === null || slot.charges <= 0) return null;
    if ((this.cooling[index] ?? 0) > 0) return null;
    if (slot.id === 'cb_candle' && ctx.itemsPickedUp > 0) return null;
    slot.charges -= 1;
    this.cooling[index] = BELT_LOCKOUT_MS;
    this.spent.push(slot.id);
    const effect = consumableEffect(slot.id, ctx.maxHp);
    if (slot.charges <= 0) this.slots[index] = null;
    return effect;
  }

  /** `HudModelV2.belt`. */
  view(): ({ id: ConsumableId; charges: number; coolingMs: number } | null)[] {
    return this.slots.map((s, i) => (s === null ? null : { id: s.id, charges: s.charges, coolingMs: this.cooling[i] ?? 0 }));
  }

  /** One entry per charge spent this run (`RunReport.beltUsed`). */
  used(): ConsumableId[] {
    return [...this.spent];
  }
}
