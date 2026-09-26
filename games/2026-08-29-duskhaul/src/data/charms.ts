/**
 * Charms (PRD-V2 §5.9): 13 passive trinkets, `TUNING.charms.maxSlots` slots,
 * ranks 1..`TUNING.charms.maxRank`. Twelve are stat charms that double as an
 * evolution partner (§5.8); `c_step` Gloam Step is behavioural and runs in
 * `systems/weapons.ts onPlayerContact`.
 *
 * `charmRankMods` is THE rule for what one rank grants — the scene
 * (`WeaponSystem.equipCharm/rankCharm`) and the headless sim both apply it.
 */
import { TUNING } from '../config';
import type { CharmId, PlayerStatKey, WeaponId } from './types-v2';

export interface CharmMod {
  stat: PlayerStatKey;
  add?: number;
  mul?: number;
}

export interface CharmDef {
  id: CharmId;
  name: string;
  /** Card/codex copy for one rank. */
  description: string;
  /** Per-rank stat modifier; null for charms whose ranks are not uniform (c_pouch) or behavioural (c_step). */
  perRank: CharmMod | null;
  /** Rank-by-rank override (index = rank − 1) for non-uniform charms. */
  rankTable?: readonly CharmMod[];
  /** Weapon this charm evolves (§5.8 partner); null for c_step. */
  evolves: WeaponId | null;
}

export const CHARMS: readonly CharmDef[] = [
  { id: 'c_oath', name: 'Grave Oath', description: 'Damage +8% per rank', perRank: { stat: 'damageMul', mul: 0.08 }, evolves: 'bolt' },
  { id: 'c_bell', name: 'Ossuary Bell', description: 'Area +10% per rank', perRank: { stat: 'area', mul: 0.1 }, evolves: 'orbit' },
  { id: 'c_drum', name: 'Dirge Drum', description: 'Cooldowns −6% per rank', perRank: { stat: 'cooldownMul', mul: -0.06 }, evolves: 'nova' },
  { id: 'c_heart', name: 'Husk Heart', description: 'Max health +15 per rank', perRank: { stat: 'maxHp', add: 15 }, evolves: 'scythe' },
  { id: 'c_eye', name: "Widow's Eye", description: 'Crit chance +4% per rank', perRank: { stat: 'critChance', add: 0.04 }, evolves: 'rail' },
  { id: 'c_tongue', name: 'Gilt Tongue', description: 'Shards +8% per rank', perRank: { stat: 'shardsMul', mul: 0.08 }, evolves: 'hex' },
  { id: 'c_lodestone', name: 'Grave Lodestone', description: 'Pickup radius +25 per rank', perRank: { stat: 'pickupRadius', add: 25 }, evolves: 'skull' },
  { id: 'c_candle', name: 'Candle of Hours', description: 'Effect duration +12% per rank', perRank: { stat: 'durationMul', mul: 0.12 }, evolves: 'censer' },
  { id: 'c_spur', name: 'Gloam Spur', description: 'Move speed +6% per rank', perRank: { stat: 'moveSpeed', mul: 0.06 }, evolves: 'sickle' },
  { id: 'c_mail', name: 'Rust Mail', description: 'Contact damage taken −5% per rank', perRank: { stat: 'contactDamageMul', mul: -0.05 }, evolves: 'lash' },
  { id: 'c_salve', name: 'Marrow Salve', description: 'Regen +0.3 hp/s per rank', perRank: { stat: 'regenPerS', add: 0.3 }, evolves: 'breath' },
  {
    id: 'c_pouch',
    name: 'Nail Pouch',
    description: '+1 projectile at ranks 2 and 4; damage +5% at ranks 1, 3, 5',
    perRank: null,
    rankTable: [
      { stat: 'damageMul', mul: 0.05 },
      { stat: 'projectileBonus', add: 1 },
      { stat: 'damageMul', mul: 0.05 },
      { stat: 'projectileBonus', add: 1 },
      { stat: 'damageMul', mul: 0.05 },
    ],
    evolves: 'spears',
  },
  { id: 'c_pin', name: "Widow's Pin", description: 'Contact damage taken −4% per rank', perRank: { stat: 'contactDamageMul', mul: -0.04 }, evolves: 'aura' },
  { id: 'c_knuckle', name: "Cheater's Knucklebone", description: 'Crit damage +0.08 per rank', perRank: { stat: 'critMul', add: 0.08 }, evolves: 'chakram' },
  { id: 'c_sole', name: "Pilgrim's Sole", description: 'Move speed +4% per rank', perRank: { stat: 'moveSpeed', mul: 0.04 }, evolves: 'wake' },
  { id: 'c_fuse', name: "Sexton's Fuse", description: 'Area +8% per rank', perRank: { stat: 'area', mul: 0.08 }, evolves: 'snares' },
  { id: 'c_vial', name: 'Marrow Vial', description: 'Regen +0.2 hp/s per rank', perRank: { stat: 'regenPerS', add: 0.2 }, evolves: 'siphon' },
  { id: 'c_powder', name: 'Ossuary Powder', description: 'Damage +6% per rank', perRank: { stat: 'damageMul', mul: 0.06 }, evolves: 'bombs' },
  { id: 'c_hymnal', name: 'Dirge Hymnal', description: 'Cooldowns −5% per rank', perRank: { stat: 'cooldownMul', mul: -0.05 }, evolves: 'totem' },
  { id: 'c_collar', name: 'Bone Collar', description: 'Effect duration +10% per rank', perRank: { stat: 'durationMul', mul: 0.1 }, evolves: 'thralls' },
  {
    id: 'c_step',
    name: 'Gloam Step',
    description: 'When hit with the step ready, dash 180 px away with 300 ms of grace',
    perRank: null,
    evolves: null,
  },
];

const BY_ID: Record<string, CharmDef> = {};
for (const charm of CHARMS) BY_ID[charm.id] = charm;

/** §16.1 E14. */
export function charmDef(id: CharmId): CharmDef {
  const def = BY_ID[id];
  if (def === undefined) throw new Error(`Unknown charm id "${id}"`);
  return def;
}

/** Stat modifiers granted ON REACHING `rank` (1-based). Empty for behavioural charms. */
export function charmRankMods(id: CharmId, rank: number): CharmMod[] {
  const def = charmDef(id);
  if (def.rankTable !== undefined) {
    const mod = def.rankTable[rank - 1];
    return mod === undefined ? [] : [mod];
  }
  return def.perRank === null ? [] : [def.perRank];
}

/** Gloam Step cooldown at `rank` (§5.9: 6.0/5.0/4.2/3.6/3.0 s, `TUNING.charms.gloamStep.cdMs`). */
export function gloamStepCooldownMs(rank: number): number {
  const cd = TUNING.charms.gloamStep.cdMs;
  return cd[Math.max(0, Math.min(cd.length - 1, rank - 1))] ?? cd[0] ?? 0;
}
