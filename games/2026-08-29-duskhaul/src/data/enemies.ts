import { PALETTE, TUNING } from '../config';
import { artScale } from './art';
import type { EliteAffixId, ZoneId } from './types-v2';

/**
 * Duskhaul's enemy roster (PRD-V2 §5.4 shared + zone cast, §5.5 elite
 * promotion, §5.6 zone bosses and den mid-bosses). Pure data + pure helpers,
 * no Phaser: the scene (`objects/enemy.ts`, `systems/combat.ts`) and the sim
 * read the SAME numbers through the SAME functions (`scaleEnemy`,
 * `eliteStats`, `bodyRadiusOf`, `contactReachOf`).
 *
 * Shape rules:
 * - `visiblePx` is law (§5.4): the on-screen silhouette height. The sheet
 *   cell size that yields it is DERIVED from the sheet's measured subject
 *   height (`SUBJECT_HEIGHT`, read from each sheet's `sprite-metadata.json`
 *   `outputSubjectHeightMean`), never hand-tuned.
 * - `behaviour` is the only thing AI code switches on; per-row numbers live in
 *   `params`. A verb that needs a param the row lacks throws on spawn.
 * - `zone` absent = shared roster; set = that zone's exclusive.
 * - `rank` separates ambient trash from the den mid-bosses and zone bosses,
 *   which never enter a spawn table (they come from `spawnMidBoss/spawnBoss`).
 * - Elites are NOT rows: any trash archetype is promoted with `eliteStats` +
 *   one affix (`data/eliteAffixes.ts`).
 */

export type EnemyBehaviour =
  | 'chase'
  | 'swarm'
  | 'ranged'
  | 'orbit-charge'
  | 'tank'
  | 'drift'
  | 'burst'
  | 'split'
  | 'aura'
  | 'flee'
  | 'teleport'
  | 'lob'
  | 'shield'
  | 'hook'
  | 'scream'
  | 'trail'
  | 'revive'
  | 'stalk'
  | 'midboss'
  | 'boss';

export type EnemyRank = 'trash' | 'midboss' | 'boss';

export interface EnemyStats {
  maxHp: number;
  damage: number;
  moveSpeed: number;
  /** XP granted to the player on death. */
  xp: number;
  /** Shards dropped on death — carried loot, banked only on extraction. */
  shards: number;
}

export interface EnemyDef {
  id: string;
  /** §5.4 name, shown in kill feeds, name plates, `Slain by <Name>`. */
  name: string;
  desc: string;
  /** Loop sheet (`-move`, or the Warden's `-idle[-zone]`). */
  texture: string;
  /**
   * Existing sheet the body wears when `texture` was not loaded (new §11 art
   * still generating, or its group pruned). Scale is recomputed from the
   * fallback's own subject height, so the silhouette still reads at `visiblePx`.
   */
  fallbackTexture?: string;
  /** Law: on-screen silhouette height in world px (§5.4). */
  visiblePx: number;
  /** DERIVED square display size of `texture`'s cell (see `displaySizeFor`). */
  size: number;
  stats: EnemyStats;
  behaviour: EnemyBehaviour;
  rank: EnemyRank;
  zone?: ZoneId;
  /** Run second this archetype first enters the spawn table. */
  firstSeenS: number;
  /** Particle / telegraph accent colour. Generated art is never tinted. */
  tint: number;
  params?: Record<string, number>;
  /** Mid-bosses: the affix they always carry (§5.6). */
  fixedAffix?: EliteAffixId;
}

/** Grave Husk base HP: every §5.5/§5.6 multiplier is quoted against it. */
const GRUNT_REFERENCE_HP = 18;
/** Elite xp multiplier over the promoted archetype (V1 elites paid ~10 grunts). */
const ELITE_XP_MUL = 5;
/** §5.6: zone boss kill pays 120 ◆, mid-boss 150 ◆. */
const BOSS_SHARDS = 120;
const MIDBOSS_SHARDS = 150;

/**
 * `outputSubjectHeightMean` per sheet (px inside the 256 cell), copied from
 * every actor sheet's `sprite-metadata.json`. `size = visiblePx × 256 / h`
 * for loop sheets; action sheets use `h(loop) / h(action)` as their scale.
 */
export const SUBJECT_HEIGHT: Readonly<Record<string, number>> = {
  'hero-idle': 177.5, 'hero-run': 158.33, 'hero-hurt': 160, 'hero-channel': 189.5, 'hero-death': 154.33, 'hero-extract': 153.83,
  'enemy-husk-move': 157, 'enemy-husk-death': 92,
  'enemy-wretch-move': 112.75, 'enemy-wretch-death': 59.5,
  'enemy-ratking-move': 81.5, 'enemy-ratking-death': 74.75,
  'enemy-bonecaster-move': 181, 'enemy-bonecaster-attack': 168.25, 'enemy-bonecaster-death': 141,
  'enemy-thornhound-move': 106.5, 'enemy-thornhound-attack': 74.75, 'enemy-thornhound-death': 83.25,
  'enemy-shroudmoth-move': 100.75, 'enemy-shroudmoth-death': 111.75,
  'enemy-pyreling-move': 90.5, 'enemy-pyreling-death': 82,
  'enemy-ashwraith-move': 137.5, 'enemy-ashwraith-death': 114,
  'enemy-paleknight-move': 149.5, 'enemy-paleknight-death': 147.75,
  'enemy-marrowworm-move': 67.25, 'enemy-marrowworm-death': 104.25,
  'enemy-dirgebell-move': 126.75, 'enemy-dirgebell-death': 109,
  'enemy-gildedghoul-move': 104.25, 'enemy-gildedghoul-death': 102.25,
  'enemy-chapelghast-move': 165.75, 'enemy-chapelghast-death': 169,
  'enemy-gargoyle-move': 115.5, 'enemy-gargoyle-attack': 116, 'enemy-gargoyle-death': 103,
  'enemy-kite-move': 118, 'enemy-kite-death': 114.25,
  'enemy-giant-move': 186, 'enemy-giant-attack': 172.5, 'enemy-giant-death': 132.5,
  'enemy-leech-move': 68.75, 'enemy-leech-attack': 60.25, 'enemy-leech-death': 129,
  'enemy-scarab-move': 84, 'enemy-scarab-death': 133.25,
  'enemy-widow-move': 116.5, 'enemy-widow-attack': 127.75, 'enemy-widow-death': 129.75,
  'enemy-yeti-move': 175.5, 'enemy-yeti-attack': 152.25, 'enemy-yeti-death': 129.5,
  'enemy-cryptcrawler-move': 73.25, 'enemy-cryptcrawler-death': 101,
  'enemy-gibbet-move': 155, 'enemy-gibbet-attack': 159.25, 'enemy-gibbet-death': 90.75,
  'enemy-choirwraith-move': 135, 'enemy-choirwraith-attack': 141.25, 'enemy-choirwraith-death': 125.25,
  'enemy-mirehag-move': 158.25, 'enemy-mirehag-death': 132.75,
  'enemy-sandrevenant-move': 158.5, 'enemy-sandrevenant-death': 129, 'enemy-sandrevenant-revive': 156.75,
  'enemy-rimestalker-move': 126.75, 'enemy-rimestalker-death': 114.5,
  'enemy-lanternmonk-move': 98, 'enemy-lanternmonk-attack': 116.75, 'enemy-lanternmonk-death': 88.75,
  'enemy-bulwark-move': 156.25, 'enemy-bulwark-death': 111.5,
  'elite-reaper-move': 181.5, 'elite-reaper-attack': 177.75, 'elite-reaper-death': 140.75,
  'elite-matron-move': 92, 'elite-matron-attack': 71.5, 'elite-matron-death': 88.5,
  'elite-herald-move': 164.75, 'elite-herald-attack': 163.5, 'elite-herald-death': 139,
  'boss-warden-idle': 165, 'boss-warden-idle-outlands': 165.5, 'boss-warden-idle-desert': 169.75, 'boss-warden-idle-winter': 167.5,
  'boss-warden-sweep': 135.67, 'boss-warden-summon': 163.5, 'boss-warden-enrage': 169.25, 'boss-warden-death': 105.25,
};

/** Fallback when a sheet was never measured: the pipeline's `fit 0.86` × body share ≈ 0.62 of the cell. */
const DEFAULT_SUBJECT_HEIGHT = 160;

/**
 * The generated action-key contract: `<actor>-move` (or the Warden's
 * `<actor>-idle[-zone]`) plus optional `-attack`, `-death`, `-revive` and —
 * Warden only — `-sweep`/`-summon`/`-enrage`. Action keys are DERIVED from
 * the sheet a body actually wears: `boss-warden-idle-desert` → `boss-warden`.
 */
export function actorBaseKey(loopKey: string): string {
  const move = loopKey.indexOf('-move');
  if (move > 0) return loopKey.slice(0, move);
  const idle = loopKey.indexOf('-idle');
  return idle > 0 ? loopKey.slice(0, idle) : loopKey;
}

/** Every action suffix an actor sheet family may ship. */
export const ACTION_SUFFIXES = ['attack', 'death', 'revive', 'sweep', 'summon', 'enrage'] as const;

/** Measured subject height of a sheet, or the pipeline default. */
function subjectHeightOf(key: string): number {
  return SUBJECT_HEIGHT[key] ?? DEFAULT_SUBJECT_HEIGHT;
}

/** §5.4: `round(visiblePx × 256 / subjectHeightMean)` — the square cell display size. */
export function displaySizeFor(loopKey: string, visiblePx: number): number {
  return Math.round((visiblePx * 256) / subjectHeightOf(loopKey));
}

/**
 * Per-action display factor relative to the loop sheet: the registry's
 * manifest scale when it has one, else the measured height ratio (new §11
 * sheets not yet in the registry). Death sheets keep 1 when unregistered —
 * a collapse is SUPPOSED to read shorter.
 */
export function actionScale(loopKey: string, actionKey: string): number {
  if (actionKey === loopKey) return 1;
  const registered = artScale(actionKey);
  if (registered !== 1) return registered;
  if (actionKey.endsWith('-death')) return 1;
  const loop = SUBJECT_HEIGHT[loopKey];
  const action = SUBJECT_HEIGHT[actionKey];
  return loop !== undefined && action !== undefined ? loop / action : 1;
}

type Row = Omit<EnemyDef, 'size' | 'rank'> & { rank?: EnemyRank };

function row(r: Row): EnemyDef {
  return { ...r, rank: r.rank ?? 'trash', size: displaySizeFor(r.texture, r.visiblePx) };
}

/** §5.4 shared archetypes (present in every zone). Speeds already ×1.1. */
const SHARED: readonly EnemyDef[] = [
  row({ id: 'husk', name: 'Grave Husk', desc: 'A dried corpse that shuffles toward warm blood', texture: 'enemy-husk-move', visiblePx: 76,
    stats: { maxHp: GRUNT_REFERENCE_HP, damage: 6, moveSpeed: 88, xp: 4, shards: 1 }, behaviour: 'chase', firstSeenS: 0, tint: PALETTE.inkSoft }),
  row({ id: 'wretch', name: 'Gloam Wretch', desc: 'A hunched scavenger that sprints in ragged bursts', texture: 'enemy-wretch-move', visiblePx: 70,
    stats: { maxHp: 12, damage: 5, moveSpeed: 165, xp: 4, shards: 1 }, behaviour: 'chase', firstSeenS: 30, tint: PALETTE.inkSoft }),
  row({ id: 'ratking', name: 'Rot Ratking', desc: 'A knot of graveyard rats moving as one', texture: 'enemy-ratking-move', visiblePx: 64,
    stats: { maxHp: 8, damage: 4, moveSpeed: 132, xp: 3, shards: 1 }, behaviour: 'swarm', firstSeenS: 45, tint: PALETTE.bad,
    params: { packSize: 6 } }),
  row({ id: 'cryptcrawler', name: 'Crypt Crawler', desc: 'A spider-rat that pours out of cracked vaults in dozens', texture: 'enemy-cryptcrawler-move',
    fallbackTexture: 'enemy-ratking-move', visiblePx: 60,
    stats: { maxHp: 6, damage: 3, moveSpeed: 190, xp: 2, shards: 1 }, behaviour: 'swarm', firstSeenS: 20, tint: PALETTE.bad,
    params: { packSize: 8 } }),
  row({ id: 'bonecaster', name: 'Bonecaster', desc: 'A robed skeleton lobbing marrow darts', texture: 'enemy-bonecaster-move', visiblePx: 80,
    stats: { maxHp: 24, damage: 8, moveSpeed: 66, xp: 6, shards: 3 }, behaviour: 'ranged', firstSeenS: 90, tint: PALETTE.ink,
    params: { rangePx: 320, fireEveryMs: 1500, shotPx: 18, shotSpeed: 420 } }),
  row({ id: 'thornhound', name: 'Thornhound', desc: 'A briar-wrapped hound that circles before lunging', texture: 'enemy-thornhound-move', visiblePx: 84,
    stats: { maxHp: 30, damage: 10, moveSpeed: 143, xp: 6, shards: 3 }, behaviour: 'orbit-charge', firstSeenS: 120, tint: PALETTE.bad,
    params: { orbitRadiusPx: 220, windupMs: 500 } }),
  row({ id: 'paleknight', name: 'Pale Knight', desc: 'Rusted plate animated by spite; slow, wide blade', texture: 'enemy-paleknight-move', visiblePx: 110,
    stats: { maxHp: 90, damage: 14, moveSpeed: 60, xp: 12, shards: 5 }, behaviour: 'tank', firstSeenS: 150, tint: PALETTE.inkSoft }),
  row({ id: 'lanternmonk', name: 'Lantern Monk', desc: 'A hooded monk who lobs his burning lantern where you stand', texture: 'enemy-lanternmonk-move',
    fallbackTexture: 'enemy-bonecaster-move', visiblePx: 84,
    stats: { maxHp: 30, damage: 10, moveSpeed: 60, xp: 7, shards: 3 }, behaviour: 'lob', firstSeenS: 150, tint: PALETTE.accent,
    params: { lobRadiusPx: 90, telegraphMs: 900, cdMs: 3500, rangePx: 380 } }),
  row({ id: 'shroudmoth', name: 'Shroudmoth', desc: 'A moth of grave-silk that drifts through walls', texture: 'enemy-shroudmoth-move', visiblePx: 72,
    stats: { maxHp: 16, damage: 7, moveSpeed: 110, xp: 5, shards: 2 }, behaviour: 'drift', firstSeenS: 180, tint: PALETTE.secondary }),
  row({ id: 'bulwark', name: 'Bone Bulwark', desc: 'A skeleton behind a door-sized bone shield', texture: 'enemy-bulwark-move',
    fallbackTexture: 'enemy-paleknight-move', visiblePx: 112,
    stats: { maxHp: 120, damage: 12, moveSpeed: 55, xp: 14, shards: 6 }, behaviour: 'shield', firstSeenS: 200, tint: PALETTE.ink,
    params: { frontalDamageMul: 0.3, frontalArcDeg: 180 } }),
  row({ id: 'gildedghoul', name: 'Gilded Ghoul', desc: 'A ghoul crusted in stolen gold; flees when hurt', texture: 'enemy-gildedghoul-move', visiblePx: 84,
    stats: { maxHp: 50, damage: 6, moveSpeed: 176, xp: 10, shards: 15 }, behaviour: 'flee', firstSeenS: 200, tint: PALETTE.accent,
    params: { valuableRolls: 1 } }),
  row({ id: 'pyreling', name: 'Pyreling', desc: 'A candle-flame spirit that bursts on death', texture: 'enemy-pyreling-move', visiblePx: 64,
    stats: { maxHp: 14, damage: 12, moveSpeed: 121, xp: 5, shards: 2 }, behaviour: 'burst', firstSeenS: 210, tint: PALETTE.accent,
    params: { burstDamage: 12, burstRadiusPx: 80, burstFlashMs: 500 } }),
  row({ id: 'marrowworm', name: 'Marrowworm', desc: 'A segmented burrower that splits when cut', texture: 'enemy-marrowworm-move', visiblePx: 100,
    stats: { maxHp: 40, damage: 9, moveSpeed: 77, xp: 8, shards: 4 }, behaviour: 'split', firstSeenS: 240, tint: PALETTE.bad,
    params: { splitCount: 2, splitHpRatio: 0.5, splitGenerations: 1 } }),
  row({ id: 'gibbet', name: 'Gibbet Wight', desc: 'A hanged wight that hooks the living in on its chain', texture: 'enemy-gibbet-move',
    fallbackTexture: 'enemy-chapelghast-move', visiblePx: 96,
    stats: { maxHp: 45, damage: 14, moveSpeed: 99, xp: 9, shards: 4 }, behaviour: 'hook', firstSeenS: 250, tint: PALETTE.bad,
    params: { telegraphMs: 1400, lengthPx: 420, pullPx: 160, cdMs: 6000 } }),
  row({ id: 'dirgebell', name: 'Dirgebell', desc: 'A floating bell that hastens nearby dead', texture: 'enemy-dirgebell-move', visiblePx: 90,
    stats: { maxHp: 35, damage: 0, moveSpeed: 77, xp: 10, shards: 5 }, behaviour: 'aura', firstSeenS: 270, tint: PALETTE.primary,
    params: { auraRadiusPx: 200, auraSpeedMul: 0.25 } }),
  row({ id: 'ashwraith', name: 'Ashwraith', desc: 'A cinder ghost that blinks 200px every 3s', texture: 'enemy-ashwraith-move', visiblePx: 78,
    stats: { maxHp: 22, damage: 9, moveSpeed: 99, xp: 6, shards: 3 }, behaviour: 'teleport', firstSeenS: 300, tint: PALETTE.secondary,
    params: { blinkPx: 200, blinkEveryS: 3 } }),
];

/** §5.4 zone exclusives (3 per zone). */
const EXCLUSIVE: readonly EnemyDef[] = [
  // castle
  row({ id: 'chapelghast', name: 'Chapel Ghast', desc: 'Lunges from prop shadows', texture: 'enemy-chapelghast-move', visiblePx: 80,
    stats: { maxHp: 28, damage: 9, moveSpeed: 105, xp: 6, shards: 3 }, behaviour: 'orbit-charge', zone: 'castle', firstSeenS: 60, tint: PALETTE.primary,
    params: { orbitRadiusPx: 180, windupMs: 400 } }),
  row({ id: 'gargoyle', name: 'Rust Gargoyle', desc: 'Perches then dives every 6s', texture: 'enemy-gargoyle-move', visiblePx: 110,
    stats: { maxHp: 60, damage: 12, moveSpeed: 110, xp: 10, shards: 5 }, behaviour: 'orbit-charge', zone: 'castle', firstSeenS: 240, tint: PALETTE.inkSoft,
    params: { orbitRadiusPx: 260, windupMs: 600, diveEveryS: 6 } }),
  row({ id: 'choirwraith', name: 'Choir Wraith', desc: 'An open-mouthed choir ghost whose scream drags your feet', texture: 'enemy-choirwraith-move',
    fallbackTexture: 'enemy-shroudmoth-move', visiblePx: 84,
    stats: { maxHp: 34, damage: 8, moveSpeed: 94, xp: 7, shards: 3 }, behaviour: 'scream', zone: 'castle', firstSeenS: 90, tint: PALETTE.secondary,
    params: { radiusPx: 160, slowPct: 25, slowMs: 2000, cdMs: 5000, telegraphMs: 600 } }),
  // outlands
  row({ id: 'kite', name: 'Carrion Kite', desc: 'Swoops', texture: 'enemy-kite-move', visiblePx: 76,
    stats: { maxHp: 20, damage: 8, moveSpeed: 187, xp: 5, shards: 2 }, behaviour: 'orbit-charge', zone: 'outlands', firstSeenS: 60, tint: PALETTE.inkSoft,
    params: { orbitRadiusPx: 300, windupMs: 350 } }),
  row({ id: 'giant', name: 'Sloughed Giant', desc: 'Ground-slam r=130', texture: 'enemy-giant-move', visiblePx: 150,
    stats: { maxHp: 140, damage: 16, moveSpeed: 50, xp: 14, shards: 6 }, behaviour: 'tank', zone: 'outlands', firstSeenS: 240, tint: PALETTE.bad,
    params: { slamRadiusPx: 130, slamEveryS: 5, slamTelegraphMs: 800 } }),
  row({ id: 'mirehag', name: 'Mire Hag', desc: 'A mud-dripping crone whose trail swallows your boots', texture: 'enemy-mirehag-move',
    fallbackTexture: 'enemy-husk-move', visiblePx: 96,
    stats: { maxHp: 60, damage: 10, moveSpeed: 66, xp: 8, shards: 4 }, behaviour: 'trail', zone: 'outlands', firstSeenS: 120, tint: PALETTE.inkSoft,
    params: { slowPct: 30, radiusPx: 60, lifeMs: 4000, dropEveryMs: 600 } }),
  // desert
  row({ id: 'leech', name: 'Dune Leech', desc: 'Burrows, surfaces at player every 7s', texture: 'enemy-leech-move', visiblePx: 84,
    stats: { maxHp: 26, damage: 10, moveSpeed: 99, xp: 6, shards: 3 }, behaviour: 'teleport', zone: 'desert', firstSeenS: 60, tint: PALETTE.bad,
    params: { blinkPx: 0, blinkEveryS: 7 } }),
  row({ id: 'scarab', name: 'Gilt Scarab', desc: 'Drops 3 shards per hit taken', texture: 'enemy-scarab-move', visiblePx: 70,
    stats: { maxHp: 45, damage: 6, moveSpeed: 154, xp: 8, shards: 4 }, behaviour: 'chase', zone: 'desert', firstSeenS: 240, tint: PALETTE.accent,
    params: { shardsPerHitTaken: 3 } }),
  row({ id: 'sandrevenant', name: 'Sand Revenant', desc: 'A sand-bound mummy that rises once more', texture: 'enemy-sandrevenant-move',
    fallbackTexture: 'enemy-husk-move', visiblePx: 88,
    stats: { maxHp: 50, damage: 12, moveSpeed: 110, xp: 8, shards: 4 }, behaviour: 'revive', zone: 'desert', firstSeenS: 120, tint: PALETTE.accent,
    params: { collapseMs: 2000, reviveHpRatio: 0.5 } }),
  // winter
  row({ id: 'widow', name: 'Frost Widow', desc: 'Lays slowing web r=120', texture: 'enemy-widow-move', visiblePx: 120,
    stats: { maxHp: 70, damage: 14, moveSpeed: 94, xp: 10, shards: 5 }, behaviour: 'chase', zone: 'winter', firstSeenS: 60, tint: PALETTE.primary,
    params: { webRadiusPx: 120, webSlowPct: 40, webEveryS: 6 } }),
  row({ id: 'yeti', name: 'Hollow Yeti', desc: 'Enrages below 30% hp', texture: 'enemy-yeti-move', visiblePx: 160,
    stats: { maxHp: 180, damage: 20, moveSpeed: 66, xp: 16, shards: 7 }, behaviour: 'tank', zone: 'winter', firstSeenS: 240, tint: PALETTE.ink,
    params: { enrageBelowPct: 30, enragedMoveSpeed: 121 } }),
  row({ id: 'rimestalker', name: 'Rime Stalker', desc: 'A gaunt ice-stalker you only see up close', texture: 'enemy-rimestalker-move',
    fallbackTexture: 'enemy-wretch-move', visiblePx: 92,
    stats: { maxHp: 55, damage: 13, moveSpeed: 154, xp: 8, shards: 4 }, behaviour: 'stalk', zone: 'winter', firstSeenS: 120, tint: PALETTE.primary,
    params: { hiddenAlpha: 0.25, revealPx: 260 } }),
];

/**
 * §5.6 den mid-bosses: elite art at visiblePx 200, hp = grunt × midboss.hpMul,
 * a fixed affix and two attacks each. Attack numbers are the §5.6 table.
 */
const MIDBOSSES: readonly EnemyDef[] = [
  row({ id: 'mb_castle', name: 'Sexton of Bleakspire', desc: 'The keep’s gravedigger, reaping in threes', texture: 'elite-reaper-move', rank: 'midboss',
    visiblePx: TUNING.midboss.visiblePx, zone: 'castle', fixedAffix: 'shielded', firstSeenS: TUNING.midboss.opensS, tint: PALETTE.bad, behaviour: 'midboss',
    stats: { maxHp: GRUNT_REFERENCE_HP * TUNING.midboss.hpMul, damage: 18, moveSpeed: 132, xp: 60, shards: MIDBOSS_SHARDS },
    params: { reapCount: 3, reapArcDeg: 140, reapRadiusPx: 220, reapWindup1Ms: 700, reapWindupNMs: 500, reapDamage: 22, reapCdMs: 6000,
      summonCount: 5, summonCdMs: 12000 } }),
  row({ id: 'mb_outlands', name: 'Gibbet Herald', desc: 'A banner-bearer who rallies the dead and charges', texture: 'elite-herald-move', rank: 'midboss',
    visiblePx: TUNING.midboss.visiblePx, zone: 'outlands', fixedAffix: 'splitter', firstSeenS: TUNING.midboss.opensS, tint: PALETTE.bad, behaviour: 'midboss',
    stats: { maxHp: GRUNT_REFERENCE_HP * TUNING.midboss.hpMul, damage: 12, moveSpeed: 110, xp: 60, shards: MIDBOSS_SHARDS },
    params: { bannerMs: 8000, bannerRadiusPx: 600, bannerSpawnMul: 0.5, bannerCdMs: 14000,
      spearLengthPx: 520, spearTelegraphMs: 800, spearDamage: 28, spearCdMs: 5000 } }),
  row({ id: 'mb_desert', name: 'Sand Matron', desc: 'A bloated brood-queen laying slicks and eggs', texture: 'elite-matron-move', rank: 'midboss',
    visiblePx: TUNING.midboss.visiblePx, zone: 'desert', fixedAffix: 'plagued', firstSeenS: TUNING.midboss.opensS, tint: PALETTE.primary, behaviour: 'midboss',
    stats: { maxHp: GRUNT_REFERENCE_HP * TUNING.midboss.hpMul, damage: 14, moveSpeed: 99, xp: 60, shards: MIDBOSS_SHARDS },
    params: { slickCount: 3, slickRadiusPx: 140, slickSlowPct: 40, slickMs: 6000, slickCdMs: 7000,
      eggCount: 4, eggHatch: 3, eggMs: 2000, eggCdMs: 10000 } }),
  row({ id: 'mb_winter', name: 'Rime Reaper', desc: 'A frost-rimed reaper that blinks in to cut', texture: 'elite-reaper-move', rank: 'midboss',
    visiblePx: TUNING.midboss.visiblePx, zone: 'winter', fixedAffix: 'hasted', firstSeenS: TUNING.midboss.opensS, tint: PALETTE.primary, behaviour: 'midboss',
    stats: { maxHp: GRUNT_REFERENCE_HP * TUNING.midboss.hpMul, damage: 18, moveSpeed: 132, xp: 60, shards: MIDBOSS_SHARDS },
    params: { blinkTelegraphMs: 600, sweepRadiusPx: 200, sweepDamage: 24, blinkCdMs: 5000,
      trailSlowPct: 30, trailRadiusPx: 60, trailLifeMs: 4000, trailDropEveryMs: 500 } }),
];

/** §5.6 zone bosses: four Warden skins with distinct attack sets (`TUNING.boss.<zone>`). */
function boss(id: string, zone: ZoneId, name: string, texture: string): EnemyDef {
  return row({ id, name, desc: `The warden of the ${zone} gate`, texture, fallbackTexture: 'boss-warden-idle', rank: 'boss', visiblePx: TUNING.boss.visiblePx,
    zone, firstSeenS: 420, tint: PALETTE.bad, behaviour: 'boss',
    stats: { maxHp: GRUNT_REFERENCE_HP * TUNING.boss.hpMul, damage: TUNING.boss.contactDamage, moveSpeed: 77, xp: 300, shards: BOSS_SHARDS },
    params: { standoffPx: 380 } });
}
const BOSSES: readonly EnemyDef[] = [
  boss('boss_castle', 'castle', 'Bell Warden of Bleakspire', 'boss-warden-idle'),
  boss('boss_outlands', 'outlands', 'Ashen Warden', 'boss-warden-idle-outlands'),
  boss('boss_desert', 'desert', 'Sun-Eaten Warden', 'boss-warden-idle-desert'),
  boss('boss_winter', 'winter', 'Rime Warden', 'boss-warden-idle-winter'),
];

/** The whole cast: 16 shared + 12 zone exclusives + 4 mid-bosses + 4 zone bosses. */
export const ENEMIES: readonly EnemyDef[] = [...SHARED, ...EXCLUSIVE, ...MIDBOSSES, ...BOSSES];

const BY_ID: Record<string, EnemyDef> = {};
for (const def of ENEMIES) BY_ID[def.id] = def;

export function enemyDef(id: string): EnemyDef {
  const def = BY_ID[id];
  if (def === undefined) throw new Error(`Unknown enemy id "${id}"`);
  return def;
}

/** Ambient spawn table for one zone: shared trash + that zone's exclusives. */
export function enemiesForZone(zoneId: string): readonly EnemyDef[] {
  return ENEMIES.filter((def) => def.rank === 'trash' && (def.zone === undefined || def.zone === zoneId));
}

/** The zone's exclusive trash, entry order. */
export function exclusiveEnemies(zoneId: string): readonly EnemyDef[] {
  return EXCLUSIVE.filter((def) => def.zone === zoneId);
}

export function zoneBossDef(zone: ZoneId): EnemyDef {
  return enemyDef(`boss_${zone}`);
}

export function midBossDef(zone: ZoneId): EnemyDef {
  return enemyDef(`mb_${zone}`);
}

/**
 * Trash HP multiplier at run second `elapsedS`: ×1 up to `enemy.hpMulRampS[0]`,
 * linear to ×`enemy.hpMul` at `hpMulRampS[1]`, flat after. Shared by the
 * scene (`scaleEnemy`) and the sim.
 */
function trashHpMul(elapsedS: number): number {
  const [from, to] = TUNING.enemy.hpMulRampS;
  const t = Math.min(1, Math.max(0, (elapsedS - from) / (to - from)));
  return 1 + (TUNING.enemy.hpMul - 1) * t;
}

/**
 * Threat scaling (§6.2): HP linear with the multiplier, DAMAGE at half rate,
 * speed and rewards never scale. Trash rows (rank 'trash', not promoted)
 * also take `trashHpMul(elapsedS)`; mid-bosses and bosses carry their own
 * hpMul in their row stats.
 */
export function scaleEnemy(def: EnemyDef, difficultyMul: number, elapsedS: number): EnemyStats {
  const trash = def.rank === 'trash';
  return {
    maxHp: Math.round(def.stats.maxHp * difficultyMul * (trash ? trashHpMul(elapsedS) : 1)),
    damage: Math.round(halfRateDamage(def, difficultyMul) * (trash ? TUNING.enemy.dmgMul : 1)),
    moveSpeed: def.stats.moveSpeed,
    xp: def.stats.xp,
    shards: def.stats.shards,
  };
}

/** §6.2 damage curve: base × (1 + (mul − 1) / 2), before any rank multiplier. */
function halfRateDamage(def: EnemyDef, difficultyMul: number): number {
  return def.stats.damage * (1 + (difficultyMul - 1) / 2);
}

/**
 * §5.5 elite promotion, built from the RAW row so the trash-only
 * `enemy.hpMul` ramp and `enemy.dmgMul` do not compound: hp × elite.hpMul,
 * dmg × elite.dmgMul, xp × 5, shards = elite.shards.
 */
export function eliteStats(def: EnemyDef, difficultyMul: number): EnemyStats {
  return {
    maxHp: Math.round(def.stats.maxHp * difficultyMul * TUNING.elite.hpMul),
    damage: Math.round(Math.round(halfRateDamage(def, difficultyMul)) * TUNING.elite.dmgMul),
    moveSpeed: def.stats.moveSpeed,
    xp: def.stats.xp * ELITE_XP_MUL,
    shards: TUNING.elite.shards,
  };
}

/** On-screen silhouette height; elites ×1.6 capped at 170 (§5.5). */
export function visiblePxOf(def: EnemyDef, elite = false): number {
  if (!elite || def.rank !== 'trash') return def.visiblePx;
  return Math.min(TUNING.elite.sizeCap, Math.round(def.visiblePx * TUNING.elite.sizeMul));
}

/** §16.1 E15 / §5.4: `round(enemy.bodyRadiusRatio × visiblePx)`. */
export function bodyRadiusOf(def: EnemyDef, elite = false): number {
  return Math.round(TUNING.enemy.bodyRadiusRatio * visiblePxOf(def, elite));
}

/** §5.4: contact reach = enemy bodyRadius + hero bodyRadius, in scene AND sim. */
export function contactReachOf(def: EnemyDef, elite = false): number {
  return bodyRadiusOf(def, elite) + TUNING.player.bodyRadius;
}

/**
 * Frontal damage reduction (bulwark behaviour, `shielded` affix): hits whose
 * source lies inside the `arcDeg` cone the body faces take `mul`. `facing` is
 * the body's heading in radians; (sx, sy) is the damage source.
 */
export function frontalMul(x: number, y: number, facing: number, sx: number, sy: number, arcDeg: number, mul: number): number {
  const toSource = Math.atan2(sy - y, sx - x);
  let diff = Math.abs(toSource - facing) % (Math.PI * 2);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  return diff <= (arcDeg * Math.PI) / 360 ? mul : 1;
}

/** Ring-angle re-rolls before a spawn is abandoned for this tick. */
export const SPAWN_RING_TRIES = 8;

/**
 * §3.9 spawn ring, shared by the scene and the sim: an ellipse
 * `viewW/2 + enemy.spawnMargin` × `viewH/2 + enemy.spawnMargin` around the
 * hero; each try draws `angle()` and keeps the first point `legal` accepts
 * (inside the arena, not nav-blocked, not in an open gate's suppress radius).
 * Writes the point into `out` and returns the rejected-try count, or -1 when
 * every try was rejected.
 */
export function spawnRingPoint(
  heroX: number,
  heroY: number,
  viewW: number,
  viewH: number,
  angle: () => number,
  legal: (x: number, y: number) => boolean,
  out: { x: number; y: number },
): number {
  const rx = viewW / 2 + TUNING.enemy.spawnMargin;
  const ry = viewH / 2 + TUNING.enemy.spawnMargin;
  for (let attempt = 0; attempt < SPAWN_RING_TRIES; attempt += 1) {
    const a = angle();
    const x = heroX + Math.cos(a) * rx;
    const y = heroY + Math.sin(a) * ry;
    if (!legal(x, y)) continue;
    out.x = x;
    out.y = y;
    return attempt;
  }
  return -1;
}

/**
 * English plural of a roster display name: the LAST word is pluralised
 * (`Gloam Wretch` → `Gloam Wretches`, `Dune Leech` → `Dune Leeches`,
 * `Hollow Yeti` → `Hollow Yetis`). Sibilant endings take `es`; a name that
 * already ends in `s` is left as is.
 */
function pluralName(name: string): string {
  if (/(ch|sh|x|z)$/i.test(name)) return `${name}es`;
  if (/s$/i.test(name)) return name;
  return `${name}s`;
}

/** One blow the hero took, for death credit (`deathCredit`). */
export interface HitRecord { t: number; amount: number; name: string; contact: boolean }

/** Window the killer is judged over, and the crowd that turns contact deaths into "a swarm". */
export const DEATH_CREDIT_WINDOW_MS = 5000;
const SWARM_MIN = 5;

/**
 * Critic F5 death credit, shared by scene and sim. The killer is the source
 * with the most damage in the last `DEATH_CREDIT_WINDOW_MS`, not the last
 * hit. If contact damage is at least half of that window and ≥ 5 bodies press
 * the hero (`crowd` = names of contact bodies within reach), the credit is the
 * swarm: `a swarm of 14 Grave Husks`, or `a mixed swarm of 14` when no
 * archetype holds a majority. Reads after "Slain by …".
 */
export function deathCredit(hits: readonly HitRecord[], now: number, crowd: readonly string[], fallback: string): string {
  const byName: Record<string, number> = {};
  let total = 0;
  let contact = 0;
  for (const h of hits) {
    if (now - h.t > DEATH_CREDIT_WINDOW_MS) continue;
    byName[h.name] = (byName[h.name] ?? 0) + h.amount;
    total += h.amount;
    if (h.contact) contact += h.amount;
  }
  if (total <= 0) return fallback;
  if (contact * 2 >= total && crowd.length >= SWARM_MIN) {
    const counts: Record<string, number> = {};
    for (const n of crowd) counts[n] = (counts[n] ?? 0) + 1;
    let top = '';
    let topN = 0;
    for (const [n, c] of Object.entries(counts)) if (c > topN) [top, topN] = [n, c];
    return topN * 2 > crowd.length ? `a swarm of ${crowd.length} ${pluralName(top)}` : `a mixed swarm of ${crowd.length}`;
  }
  let best = fallback;
  let bestDmg = 0;
  for (const [n, d] of Object.entries(byName)) if (d > bestDmg) [best, bestDmg] = [n, d];
  return best;
}
