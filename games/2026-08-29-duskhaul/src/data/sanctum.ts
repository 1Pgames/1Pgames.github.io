/**
 * Sanctum nodes (PRD-V2 §5.18) and the account ladder (§5.20). V1 ids are
 * retained so saved levels carry over. Pure data; purchase rules and the
 * loadout fold live in `core/progression.ts`.
 */

export type SanctumBranch = 'ROOT' | 'BODY' | 'GREED' | 'ESCAPE';
export interface SanctumNodeDef {
  id: string; branch: SanctumBranch; row: 0 | 1 | 2 | 3 | 4;
  /** Effect-first title (UI row heading). */
  title: string; flavor: string; max: number;
  /** Keystones cost sigils (flat); every other node costs `base × growth^level` shards. */
  currency: 'shards' | 'sigils'; base: number; growth: number;
  /** Node that must own ≥ 1 level first (only `b_undying`). */
  requires?: string;
}
export interface AccountLadderRow { level: number; unlocks: string[]; text: string }

/**
 * Economy retune: the §5.18 `base` column is multiplied per row (root, rows
 * 1-3) so the tree lands at ~84k ◆ (~50% in 25-35 runs, 100% in 80-120 runs
 * at the ~660 ◆/run Balance measured after the income cuts: banked shards +
 * valuables × sellMul; gear is salvage-only); keystones keep their flat ✦ price.
 */
const ROW_PRICE_MUL: readonly number[] = [1.5, 4.5, 3.5, 3];

const n = (
  id: string, branch: SanctumBranch, row: SanctumNodeDef['row'], title: string, flavor: string,
  max: number, base: number, growth: number, requires?: string,
): SanctumNodeDef => {
  const def: SanctumNodeDef = { id, branch, row, title, flavor, max, currency: row === 4 ? 'sigils' : 'shards', base: row === 4 ? base : Math.round(base * ROW_PRICE_MUL[row]!), growth };
  if (requires !== undefined) def.requires = requires;
  return def;
};

export const SANCTUM: readonly SanctumNodeDef[] = [
  n('n_oath', 'ROOT', 0, 'Max Health +10 · Pickup +10', "Hauler's Oath", 1, 30, 1),
  n('m_vitality', 'BODY', 1, 'Max Health +10', 'Husk Vigor', 5, 50, 1.35),
  n('m_might', 'BODY', 1, 'Damage +6%', 'Marrow Might', 5, 70, 1.4),
  n('m_haste', 'BODY', 1, 'Move Speed +4%', 'Gloam Pace', 5, 60, 1.4),
  // Flat 150 ◆ after the row-1 multiplier (the constructor multiplies `base`).
  n('b_armsmaster', 'BODY', 1, 'Choose your starting weapon', "Armsmaster's Leave", 1, 150 / 4.5, 1, 'n_oath'),
  n('b_regen', 'BODY', 2, 'Regen +0.2/s', 'Slow Marrow', 3, 150, 1.5),
  n('b_armor', 'BODY', 2, 'Contact Damage −4%', 'Leathered Soul', 5, 120, 1.45),
  n('b_crit', 'BODY', 2, 'Crit Chance +2%', "Hate's Memory", 3, 180, 1.5),
  n('b_area', 'BODY', 2, 'Area +5%', 'Widening Dark', 3, 160, 1.5),
  n('b_cool', 'BODY', 3, 'Cooldown −3%', 'Quick Dirge', 3, 400, 1.6),
  n('b_iframes', 'BODY', 3, 'I-frames +80 ms', 'Numb Flesh', 2, 450, 1.7),
  n('m_revive', 'BODY', 3, 'Revive once per run at 30% health', 'Last Rite', 1, 900, 1),
  n('b_startlevel', 'BODY', 3, 'Start every run at level 2', 'Fore-Rite', 1, 700, 1),
  n('b_proj', 'BODY', 4, 'Projectiles +1 for every weapon', 'Nail Legion', 1, 3, 1),
  n('b_undying', 'BODY', 4, 'Last Rite revives at 50% and grants 3 s immunity', 'Undying Husk', 1, 3, 1, 'm_revive'),
  n('m_greed', 'GREED', 1, 'Shards +8%', 'Gilt Sense', 5, 55, 1.35),
  n('m_magnet', 'GREED', 1, 'Pickup Range +20', 'Grave Pull', 4, 40, 1.3),
  n('m_bag', 'GREED', 1, 'Bag +2 cells', 'Marrow Sack', 2, 150, 1.8),
  n('m_tithe', 'GREED', 2, 'Keep 40% / 55% of shards on death (base 25%)', 'Rot Tithe', 2, 300, 1.8),
  n('g_luck', 'GREED', 2, 'Luck +1 (rarer items)', 'Gloam Fortune', 3, 250, 1.6),
  n('g_dust', 'GREED', 2, 'Bone Dust from salvage +15%', 'Ossuary Tax', 3, 200, 1.5),
  n('g_sell', 'GREED', 2, 'Valuables sell for +10%', "Fence's Friend", 3, 220, 1.5),
  n('g_vein', 'GREED', 3, 'Veins +25% shards and mine in 2 s', 'Deep Pick', 2, 450, 1.6),
  n('g_breakable', 'GREED', 3, 'Breakables drop items +10% more often', 'Urn Breaker', 2, 400, 1.6),
  n('g_fence', 'GREED', 3, 'Fence offers one extra trade; appears 100% of runs', 'Known Face', 1, 600, 1),
  n('g_startkey', 'GREED', 3, 'Start every run with 1 Dread Key', "Sexton's Key", 1, 800, 1),
  n('g_greedcap', 'GREED', 4, 'Greed meter max ×1.25 → ×1.4', 'Bottomless Hunger', 1, 3, 1),
  n('g_midas', 'GREED', 4, 'Elites drop +1 valuable', 'Gilded Touch', 1, 3, 1),
  n('m_extract', 'ESCAPE', 1, 'Extract 0.5 s faster', 'Bleak Haste', 3, 65, 1.35),
  n('m_ward', 'ESCAPE', 1, 'Gates stay open +15 s', 'Gate Ward', 2, 90, 1.45),
  n('m_reroll', 'ESCAPE', 1, '+1 reroll per run', 'Second Dirge', 2, 80, 1.5),
  n('m_casket', 'ESCAPE', 2, '+1 casket slot', "Widow's Casket", 1, 400, 1),
  n('e_banish', 'ESCAPE', 2, '+1 banish per run', 'Unmaking', 2, 250, 1.6),
  n('e_compass', 'ESCAPE', 2, 'Minimap reveal radius +300', 'Dead Reckoning', 2, 200, 1.5),
  n('e_toll', 'ESCAPE', 2, 'Toll Gates cost 15% instead of 25%', "Ferryman's Discount", 1, 350, 1),
  n('e_speedgate', 'ESCAPE', 3, 'Move Speed +20% within 600 px of an open gate', 'Homeward', 1, 600, 1),
  n('e_contest', 'ESCAPE', 3, 'Contested channel rate 0.70 → 0.80', 'Steady Hands', 1, 700, 1),
  n('e_belt', 'ESCAPE', 3, 'Consumables carry +1 charge', 'Deep Pockets', 1, 650, 1),
  n('e_beacon', 'ESCAPE', 3, 'Gate compass previews 120 s ahead', 'Far Bell', 1, 500, 1),
  n('e_gravepact', 'ESCAPE', 4, 'On death keep 1 random non-casket item', 'Grave Pact', 1, 3, 1),
  n('e_gloamwalk', 'ESCAPE', 4, '1.5 s invulnerability when a channel starts (once per gate)', 'Gloamwalk', 1, 3, 1),
];

/** Branch shard spend required to open row 1..4 (row 4 keystones also cost ✦). */
export const ROW_SPEND: readonly [number, number, number, number] = [0, 1000, 3500, 9000];

const NODE_BY_ID: Record<string, SanctumNodeDef> = Object.fromEntries(SANCTUM.map((d) => [d.id, d]));

export function sanctumNode(id: string): SanctumNodeDef | undefined {
  return NODE_BY_ID[id];
}

/** §16.1 E33: price of buying level `level + 1` (current level `level`). Keystones: flat sigils. */
export function nodeCost(node: SanctumNodeDef, level: number): { shards: number; sigils: number } {
  if (node.currency === 'sigils') return { shards: 0, sigils: node.base };
  return { shards: Math.round(node.base * node.growth ** level), sigils: 0 };
}

/** XP needed to go from `level` to `level + 1` (§5.20: `200 + 75 × (L−1)`). */
export const ACCOUNT_MAX_LEVEL = 40;

/**
 * §5.20 ladder. `unlocks` are the keys `featureUnlocked` answers; `zonelevel:*`
 * and `hazard:*` are only the LEVEL half of their rule (`zoneStatus` /
 * `hazardStatus` add the extraction/sigil half).
 */
export const ACCOUNT_LADDER: readonly AccountLadderRow[] = [
  { level: 1, unlocks: ['zonelevel:castle', 'hazard:1', 'class:duskhauler', 'slot:shroud', 'slot:grips', 'slot:ring', 'weapon:bolt', 'charm:c_oath', 'weapon:orbit', 'charm:c_bell', 'weapon:nova', 'charm:c_drum', 'weapon:scythe', 'charm:c_heart', 'weapon:aura', 'charm:c_pin', 'weapon:rail', 'charm:c_eye'], text: "Bleakspire Keep H1; Duskhauler; shroud, grips, ring slots; Rustspike + Grave Oath; Bone Halo + Ossuary Bell; Ash Ring + Dirge Drum; Gloam Scythe + Husk Heart; Mourning Pall + Widow's Pin; Widow's Lance + Widow's Eye" },
  { level: 2, unlocks: ['feature:contracts', 'slot:hood', 'weapon:skull', 'charm:c_lodestone'], text: 'Contracts board (3 active); hood slot; Wailing Skull + Grave Lodestone' },
  { level: 3, unlocks: ['feature:sell', 'weapon:chakram', 'charm:c_knuckle'], text: "Vault SELL; Ossuary Disc + Cheater's Knucklebone" },
  { level: 4, unlocks: ['feature:merge', 'slot:boots', 'weapon:hex', 'charm:c_tongue'], text: 'Vault MERGE; boots slot; Thorn Hex + Gilt Tongue' },
  { level: 5, unlocks: ['zonelevel:outlands', 'hazard:2', 'weapon:wake', 'charm:c_sole'], text: "Ashen Outlands (needs 1 Keep extraction); Hazard H2; Gloam Wake + Pilgrim's Sole" },
  { level: 6, unlocks: ['draft:reroll1', 'slot:amulet', 'charm:c_step'], text: '+1 draft reroll per run; amulet slot; Charm: Gloam Step' },
  { level: 7, unlocks: ['belt:1', 'weapon:sickle', 'charm:c_spur'], text: 'Consumable belt slot 1; Grave Sickle + Gloam Spur' },
  { level: 8, unlocks: ['draft:banish1', 'feature:daily'], text: '+1 draft banish per run; Daily Rite' },
  { level: 9, unlocks: ['codex:lore2', 'weapon:censer', 'charm:c_candle'], text: 'Codex tier-2 lore; Plague Censer + Candle of Hours' },
  { level: 10, unlocks: ['class:gravewarden'], text: 'Gravewarden class' },
  { level: 11, unlocks: ['weapon:snares', 'charm:c_fuse'], text: "Grave Snares + Sexton's Fuse" },
  { level: 12, unlocks: ['zonelevel:desert'], text: 'Sorrow Dunes (needs 1 Outlands extraction)' },
  { level: 13, unlocks: ['dust:150', 'weapon:siphon', 'charm:c_vial'], text: '+150 Bone Dust; Marrow Siphon + Marrow Vial' },
  { level: 14, unlocks: ['sigils:1'], text: '+1 Dread Sigil' },
  { level: 15, unlocks: ['feature:weekly', 'weapon:lash', 'charm:c_mail'], text: 'Weekly Rift; Thorn Lash + Rust Mail' },
  { level: 16, unlocks: ['class:ashwitch'], text: 'Ashwitch class' },
  { level: 17, unlocks: ['hazard:3'], text: 'Hazard H3' },
  { level: 18, unlocks: ['hazard:4', 'weapon:bombs', 'charm:c_powder'], text: 'Hazard H4 (needs H3 extraction in that zone); Rattle Urns + Ossuary Powder' },
  { level: 19, unlocks: ['merge:5'], text: 'Merge to Dread' },
  { level: 20, unlocks: ['zonelevel:winter', 'draft:reroll2'], text: "Widow's Crown (needs 1 Dunes extraction); +1 draft reroll per run" },
  { level: 21, unlocks: ['dust:300', 'weapon:totem', 'charm:c_hymnal'], text: '+300 Bone Dust; Dirge Totem + Dirge Hymnal' },
  { level: 22, unlocks: ['belt:2'], text: 'Consumable belt slot 2' },
  { level: 23, unlocks: ['codex:lore3'], text: 'Codex tier-3 lore' },
  { level: 24, unlocks: ['contracts:4', 'weapon:breath', 'charm:c_salve'], text: 'Contracts: 4 active; Pyre Breath + Marrow Salve' },
  { level: 25, unlocks: ['class:widowblade'], text: 'Widowblade class' },
  { level: 26, unlocks: ['merge:6'], text: 'Merge to Hallowed' },
  { level: 27, unlocks: ['hazard:5', 'weapon:thralls', 'charm:c_collar'], text: 'Hazard H5 (needs 3 ✦ + H4 extraction); Husk Thralls + Bone Collar' },
  { level: 28, unlocks: ['sigils:2'], text: '+2 Dread Sigils' },
  { level: 29, unlocks: ['dust:500', 'sigils:1'], text: '+500 Bone Dust; +1 Dread Sigil' },
  { level: 30, unlocks: ['title:Grave Robber', 'weapon:spears', 'charm:c_pouch'], text: 'Title "Grave Robber"; Gallows Spears + Nail Pouch' },
  { level: 31, unlocks: ['contracts:reroll2'], text: 'Contracts reroll +1/day' },
  { level: 32, unlocks: ['draft:banish2'], text: '+1 draft banish per run' },
  { level: 33, unlocks: ['title:Duskhauler of Note'], text: 'Title "Duskhauler of Note"' },
  { level: 34, unlocks: ['weekly:attempt'], text: '+1 Weekly Rift attempt reward' },
  { level: 35, unlocks: ['title:Wardenbane'], text: 'Title "Wardenbane"' },
  { level: 36, unlocks: ['casket:1'], text: '+1 casket slot' },
  { level: 37, unlocks: ['feature:capstone'], text: 'Hallowed capstone reroll (Vault)' },
  { level: 38, unlocks: ['title:Hollow King'], text: 'Title "Hollow King"' },
  { level: 39, unlocks: ['codex:border'], text: 'Codex complete border' },
  { level: 40, unlocks: ['title:The Dark Remembers', 'sigils:5'], text: 'Title "The Dark Remembers" + 5 ✦' },
];

const UNLOCK_COPY: Record<string, string> = {
  'zonelevel:castle': 'Bleakspire Keep', 'zonelevel:outlands': 'Ashen Outlands', 'zonelevel:desert': 'Sorrow Dunes', 'zonelevel:winter': "Widow's Crown",
  'zone:castle': 'Bleakspire Keep', 'zone:outlands': 'Ashen Outlands', 'zone:desert': 'Sorrow Dunes', 'zone:winter': "Widow's Crown",
  'class:duskhauler': 'Duskhauler', 'class:gravewarden': 'Gravewarden class', 'class:ashwitch': 'Ashwitch class', 'class:widowblade': 'Widowblade class',
  'weapon:bolt': 'Rustspike', 'weapon:orbit': 'Bone Halo', 'weapon:nova': 'Ash Ring', 'weapon:scythe': 'Gloam Scythe', 'weapon:aura': 'Mourning Pall', 'weapon:rail': "Widow's Lance", 'weapon:skull': 'Wailing Skull', 'weapon:chakram': 'Ossuary Disc', 'weapon:hex': 'Thorn Hex', 'weapon:wake': 'Gloam Wake', 'weapon:sickle': 'Grave Sickle', 'weapon:censer': 'Plague Censer', 'weapon:snares': 'Grave Snares', 'weapon:siphon': 'Marrow Siphon', 'weapon:lash': 'Thorn Lash', 'weapon:bombs': 'Rattle Urns', 'weapon:totem': 'Dirge Totem', 'weapon:breath': 'Pyre Breath', 'weapon:thralls': 'Husk Thralls', 'weapon:spears': 'Gallows Spears',
  'charm:c_oath': 'Grave Oath', 'charm:c_bell': 'Ossuary Bell', 'charm:c_drum': 'Dirge Drum', 'charm:c_heart': 'Husk Heart', 'charm:c_pin': "Widow's Pin", 'charm:c_eye': "Widow's Eye", 'charm:c_lodestone': 'Grave Lodestone', 'charm:c_knuckle': "Cheater's Knucklebone", 'charm:c_tongue': 'Gilt Tongue', 'charm:c_sole': "Pilgrim's Sole", 'charm:c_spur': 'Gloam Spur', 'charm:c_candle': 'Candle of Hours', 'charm:c_fuse': "Sexton's Fuse", 'charm:c_vial': 'Marrow Vial', 'charm:c_mail': 'Rust Mail', 'charm:c_powder': 'Ossuary Powder', 'charm:c_hymnal': 'Dirge Hymnal', 'charm:c_salve': 'Marrow Salve', 'charm:c_collar': 'Bone Collar', 'charm:c_pouch': 'Nail Pouch', 'charm:c_step': 'Gloam Step',
  'slot:hood': 'Hood slot', 'slot:shroud': 'Shroud slot', 'slot:grips': 'Grips slot', 'slot:boots': 'Boots slot', 'slot:ring': 'Ring slot', 'slot:amulet': 'Amulet slot',
  'belt:1': 'Consumable belt slot 1', 'belt:2': 'Consumable belt slot 2',
  'feature:contracts': 'Contracts board', 'feature:sell': 'Vault SELL', 'feature:merge': 'Vault MERGE', 'feature:daily': 'Daily Rite', 'feature:weekly': 'Weekly Rift', 'feature:capstone': 'Hallowed capstone reroll',
  'contracts:4': '4 active contracts', 'contracts:reroll2': '+1 contract reroll per day', 'merge:5': 'Merge to Dread', 'merge:6': 'Merge to Hallowed',
  'dust:150': '+150 Bone Dust', 'dust:300': '+300 Bone Dust', 'dust:500': '+500 Bone Dust',
  'codex:lore2': 'Codex tier-2 lore', 'codex:lore3': 'Codex tier-3 lore', 'codex:border': 'Codex complete border',
  'weekly:attempt': '+1 Weekly Rift attempt reward', 'sigils:1': '+1 Dread Sigil', 'sigils:2': '+2 Dread Sigils', 'sigils:5': '+5 Dread Sigils',
  'draft:reroll1': '+1 draft reroll per run', 'draft:reroll2': '+1 draft reroll per run', 'draft:banish1': '+1 draft banish per run', 'draft:banish2': '+1 draft banish per run', 'casket:1': '+1 casket slot',
  'hazard:1': 'Hazard H1', 'hazard:2': 'Hazard H2', 'hazard:3': 'Hazard H3', 'hazard:4': 'Hazard H4', 'hazard:5': 'Hazard H5',
};

/** Display copy for any unlock key in `ACCOUNT_LADDER` / `SettlementReport.unlocks` (incl. `hazard:<zone>:<h>`). */
export function unlockLabel(key: string): string {
  const copy = UNLOCK_COPY[key];
  if (copy !== undefined) return copy;
  if (key.startsWith('title:')) return `Title "${key.slice(6)}"`;
  const hz = /^hazard:([a-z]+):(\d)$/.exec(key);
  if (hz) return `${UNLOCK_COPY[`zone:${hz[1]}`] ?? hz[1]} H${hz[2]}`;
  return key;
}
