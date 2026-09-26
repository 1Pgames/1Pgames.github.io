/**
 * Elite affixes (PRD-V2 §5.5). Rows carry copy and art ids; every number
 * lives in `TUNING.elite.affixes` and is read by `objects/enemy.ts` /
 * `systems/combat.ts`. `icon` is the §11 `icon-affix-<id>` key (28 px over
 * the elite's head; a procedural glyph in `ring` colour replaces it when the
 * texture is missing). `ring` is the affix's telegraph colour.
 */
import type { EliteAffixId } from './types-v2';

export interface EliteAffixDef { id: EliteAffixId; name: string; effect: string; telegraph: string; icon: string; ring: number }

export const ELITE_AFFIXES: readonly EliteAffixDef[] = [
  { id: 'vampiric', name: 'Vampiric', effect: 'Heals 20% of damage dealt (max 5% max HP per second)', telegraph: 'red mist trail', icon: 'icon-affix-vampiric', ring: 0xb3122e },
  { id: 'hasted', name: 'Hasted', effect: 'Moves 40% faster, attacks 30% more often', telegraph: 'speed streaks', icon: 'icon-affix-hasted', ring: 0xe8c547 },
  { id: 'shielded', name: 'Shielded', effect: 'Takes 70% less damage from the front', telegraph: 'bone shield', icon: 'icon-affix-shielded', ring: 0xeae1bf },
  { id: 'splitter', name: 'Splitter', effect: 'Bursts into 4 minions on death', telegraph: 'crack glow', icon: 'icon-affix-splitter', ring: 0xff7a3d },
  { id: 'frenzied', name: 'Frenzied', effect: 'Below half HP: 50% faster, 30% more damage', telegraph: 'red rim', icon: 'icon-affix-frenzied', ring: 0xff2d2d },
  { id: 'warded', name: 'Warded', effect: 'Immune for 1 s every 4 s', telegraph: 'violet ring while immune', icon: 'icon-affix-warded', ring: 0xad6eef },
  { id: 'plagued', name: 'Plagued', effect: 'Leaves 3 dps plague pools while walking and on death', telegraph: 'amber ground ring', icon: 'icon-affix-plagued', ring: 0xe8c547 },
  { id: 'magnetic', name: 'Magnetic', effect: 'Pulls you in at 60 px/s within 250 px', telegraph: 'swirl ring', icon: 'icon-affix-magnetic', ring: 0x6fd6ff },
];

const BY_ID = Object.fromEntries(ELITE_AFFIXES.map((a) => [a.id, a])) as Record<EliteAffixId, EliteAffixDef>;

/** §16.1 E16. */
export function affixDef(id: EliteAffixId): EliteAffixDef {
  return BY_ID[id];
}
