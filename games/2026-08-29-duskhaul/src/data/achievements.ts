/**
 * Achievements (PRD-V2 §5.23): 60 rows. `rule` is the machine form of
 * `condition`; `core/collections.ts evaluateAchievements` is its only reader.
 * `run:*` rules are judged on one settled RunReport; `meta:*` rules on the
 * save after any settlement or Vault/Sanctum/contract mutation.
 */
import type { ClassId, GateKind, HazardLevel, WeaponId, ZoneId } from './types-v2';

export type AchievementRule =
  | { kind: 'run:extract' }
  | { kind: 'run:ftueExtract' }
  | { kind: 'run:extractItems'; n: number }
  | { kind: 'run:extractGreed'; n: number }
  | { kind: 'run:extractAfter'; s: number }
  | { kind: 'run:extractGateC' }
  | { kind: 'run:extractKind'; gateKind: Exclude<GateKind, 'timed'> }
  | { kind: 'run:extractHazard'; h: HazardLevel }
  | { kind: 'run:bossKill'; zone: ZoneId }
  | { kind: 'run:midKill'; zone: ZoneId }
  | { kind: 'run:evolve'; weapon: WeaponId }
  | { kind: 'run:evolutions'; n: number }
  | { kind: 'run:maxRankWeapons'; n: number }
  | { kind: 'run:extractWeekly' }
  | { kind: 'meta:allGates' }
  | { kind: 'meta:mastery'; zone: ZoneId; stars: number }
  | { kind: 'meta:kills'; n: number }
  | { kind: 'meta:eliteKills'; n: number }
  | { kind: 'meta:allAffixes' }
  | { kind: 'meta:class'; id: ClassId }
  | { kind: 'meta:everyClassExtract' }
  | { kind: 'meta:ownRarity'; r: 4 | 5 }
  | { kind: 'meta:mergedHallowed' }
  | { kind: 'meta:uniques'; n: number }
  | { kind: 'meta:valuables'; n: number }
  | { kind: 'meta:lore'; n: number }
  | { kind: 'meta:sanctumLevels'; n: number }
  | { kind: 'meta:keystone' }
  | { kind: 'meta:contracts'; n: number }
  | { kind: 'meta:dailyStreak'; n: number };

export interface AchievementDef { id: string; name: string; condition: string; reward: { shards?: number; sigils?: number }; rule: AchievementRule }

const s = (shards: number): { shards: number } => ({ shards });
const SIGIL = { sigils: 1 };

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'a01', name: 'First Light', condition: 'Extract once', reward: s(100), rule: { kind: 'run:extract' } },
  { id: 'a02', name: 'Wicket Walker', condition: 'Finish the Wicket tutorial', reward: s(50), rule: { kind: 'run:ftueExtract' } },
  { id: 'a03', name: 'Deep Pockets', condition: 'Extract with 10 items', reward: s(200), rule: { kind: 'run:extractItems', n: 10 } },
  { id: 'a04', name: 'Greedy', condition: 'Extract with Greed ×1.25', reward: s(300), rule: { kind: 'run:extractGreed', n: 1.25 } },
  { id: 'a05', name: 'Late Leaver', condition: 'Extract after 480 s', reward: s(400), rule: { kind: 'run:extractAfter', s: 480 } },
  { id: 'a06', name: 'Toll Payer', condition: 'Extract through a Toll Gate', reward: s(100), rule: { kind: 'run:extractKind', gateKind: 'toll' } },
  { id: 'a07', name: 'Offering Made', condition: 'Extract through an Offering Altar', reward: s(100), rule: { kind: 'run:extractKind', gateKind: 'offering' } },
  { id: 'a08', name: 'Bell Ringer', condition: 'Extract through a Bell Gate', reward: s(150), rule: { kind: 'run:extractKind', gateKind: 'bell' } },
  { id: 'a09', name: 'Arch Walker', condition: 'Extract through Gate C', reward: s(200), rule: { kind: 'run:extractGateC' } },
  { id: 'a10', name: 'Every Door', condition: 'Use all 6 gate kinds (A, B, C, Toll, Offering, Bell)', reward: SIGIL, rule: { kind: 'meta:allGates' } },
  { id: 'a11', name: 'Keep Master', condition: '3 mastery stars in Bleakspire Keep', reward: s(300), rule: { kind: 'meta:mastery', zone: 'castle', stars: 3 } },
  { id: 'a12', name: 'Outlands Master', condition: '3 stars in Ashen Outlands', reward: s(400), rule: { kind: 'meta:mastery', zone: 'outlands', stars: 3 } },
  { id: 'a13', name: 'Dunes Master', condition: '3 stars in Sorrow Dunes', reward: s(500), rule: { kind: 'meta:mastery', zone: 'desert', stars: 3 } },
  { id: 'a14', name: 'Crown Master', condition: "3 stars in Widow's Crown", reward: s(600), rule: { kind: 'meta:mastery', zone: 'winter', stars: 3 } },
  { id: 'a15', name: 'Bellbreaker', condition: 'Kill the Bell Warden', reward: s(200), rule: { kind: 'run:bossKill', zone: 'castle' } },
  { id: 'a16', name: 'Ashfall', condition: 'Kill the Ashen Warden', reward: s(250), rule: { kind: 'run:bossKill', zone: 'outlands' } },
  { id: 'a17', name: 'Eclipse', condition: 'Kill the Sun-Eaten Warden', reward: s(300), rule: { kind: 'run:bossKill', zone: 'desert' } },
  { id: 'a18', name: 'Thaw', condition: 'Kill the Rime Warden', reward: s(350), rule: { kind: 'run:bossKill', zone: 'winter' } },
  { id: 'a19', name: "Sexton's End", condition: 'Kill the Sexton', reward: s(150), rule: { kind: 'run:midKill', zone: 'castle' } },
  { id: 'a20', name: 'Banner Torn', condition: 'Kill the Gibbet Herald', reward: s(150), rule: { kind: 'run:midKill', zone: 'outlands' } },
  { id: 'a21', name: 'Web Cutter', condition: 'Kill the Sand Matron', reward: s(150), rule: { kind: 'run:midKill', zone: 'desert' } },
  { id: 'a22', name: 'Cold Reaping', condition: 'Kill the Rime Reaper', reward: s(150), rule: { kind: 'run:midKill', zone: 'winter' } },
  { id: 'a23', name: 'Hazard II', condition: 'Extract at H2', reward: s(150), rule: { kind: 'run:extractHazard', h: 2 } },
  { id: 'a24', name: 'Hazard III', condition: 'Extract at H3', reward: s(250), rule: { kind: 'run:extractHazard', h: 3 } },
  { id: 'a25', name: 'Hazard IV', condition: 'Extract at H4', reward: s(400), rule: { kind: 'run:extractHazard', h: 4 } },
  { id: 'a26', name: 'Hazard V', condition: 'Extract at H5', reward: { sigils: 2 }, rule: { kind: 'run:extractHazard', h: 5 } },
  { id: 'a27', name: 'Thousand Dead', condition: '1,000 kills lifetime', reward: s(100), rule: { kind: 'meta:kills', n: 1000 } },
  { id: 'a28', name: 'Ten Thousand', condition: '10,000 kills', reward: s(300), rule: { kind: 'meta:kills', n: 10000 } },
  { id: 'a29', name: 'Hundred Thousand', condition: '100,000 kills', reward: SIGIL, rule: { kind: 'meta:kills', n: 100000 } },
  { id: 'a30', name: 'Elite Hunter', condition: '50 elite kills', reward: s(200), rule: { kind: 'meta:eliteKills', n: 50 } },
  { id: 'a31', name: 'Affix Collector', condition: 'Kill one elite of each affix', reward: s(250), rule: { kind: 'meta:allAffixes' } },
  { id: 'a32', name: 'Coffin Nail', condition: 'Evolve Rustspike', reward: s(100), rule: { kind: 'run:evolve', weapon: 'bolt' } },
  { id: 'a33', name: 'Marrow Wheel', condition: 'Evolve Bone Halo', reward: s(100), rule: { kind: 'run:evolve', weapon: 'orbit' } },
  { id: 'a34', name: 'Pyre Shroud', condition: 'Evolve Ash Ring', reward: s(100), rule: { kind: 'run:evolve', weapon: 'nova' } },
  { id: 'a35', name: 'Dirge Reaper', condition: 'Evolve Gloam Scythe', reward: s(100), rule: { kind: 'run:evolve', weapon: 'scythe' } },
  { id: 'a36', name: 'Sorrow Piercer', condition: "Evolve Widow's Lance", reward: s(100), rule: { kind: 'run:evolve', weapon: 'rail' } },
  { id: 'a37', name: 'Rot Chorus', condition: 'Evolve Thorn Hex', reward: s(100), rule: { kind: 'run:evolve', weapon: 'hex' } },
  { id: 'a38', name: 'Choir of Skulls', condition: 'Evolve Wailing Skull', reward: s(100), rule: { kind: 'run:evolve', weapon: 'skull' } },
  { id: 'a39', name: 'Pestilent Thurible', condition: 'Evolve Plague Censer', reward: s(100), rule: { kind: 'run:evolve', weapon: 'censer' } },
  { id: 'a40', name: 'Moon Harvester', condition: 'Evolve Grave Sickle', reward: s(100), rule: { kind: 'run:evolve', weapon: 'sickle' } },
  { id: 'a41', name: 'Briar Scourge', condition: 'Evolve Thorn Lash', reward: s(100), rule: { kind: 'run:evolve', weapon: 'lash' } },
  { id: 'a42', name: 'Cinder Maw', condition: 'Evolve Pyre Breath', reward: s(100), rule: { kind: 'run:evolve', weapon: 'breath' } },
  { id: 'a43', name: 'Gallows Forest', condition: 'Evolve Gallows Spears', reward: s(100), rule: { kind: 'run:evolve', weapon: 'spears' } },
  { id: 'a44', name: 'Double Evolution', condition: '2 evolutions in one run', reward: s(250), rule: { kind: 'run:evolutions', n: 2 } },
  { id: 'a45', name: 'Full Arsenal', condition: '4 weapons at rank 4 in one run', reward: s(200), rule: { kind: 'run:maxRankWeapons', n: 4 } },
  { id: 'a46', name: 'Gravewarden', condition: 'Unlock Gravewarden', reward: s(100), rule: { kind: 'meta:class', id: 'gravewarden' } },
  { id: 'a47', name: 'Ashwitch', condition: 'Unlock Ashwitch', reward: s(100), rule: { kind: 'meta:class', id: 'ashwitch' } },
  { id: 'a48', name: 'Widowblade', condition: 'Unlock Widowblade', reward: s(100), rule: { kind: 'meta:class', id: 'widowblade' } },
  { id: 'a49', name: 'Class Act', condition: 'Extract with every class', reward: SIGIL, rule: { kind: 'meta:everyClassExtract' } },
  { id: 'a50', name: 'Gilded', condition: 'Own a Gilded item', reward: s(100), rule: { kind: 'meta:ownRarity', r: 4 } },
  { id: 'a51', name: 'Dread', condition: 'Own a Dread item', reward: s(200), rule: { kind: 'meta:ownRarity', r: 5 } },
  { id: 'a52', name: 'Hallowed', condition: 'Merge a Hallowed item', reward: SIGIL, rule: { kind: 'meta:mergedHallowed' } },
  { id: 'a53', name: 'Unique Taste', condition: 'Own 4 uniques', reward: s(300), rule: { kind: 'meta:uniques', n: 4 } },
  { id: 'a54', name: 'Collector', condition: 'Discover all 24 valuables', reward: s(300), rule: { kind: 'meta:valuables', n: 24 } },
  { id: 'a55', name: 'Loremaster', condition: 'Read all 24 lore stones', reward: s(300), rule: { kind: 'meta:lore', n: 24 } },
  { id: 'a56', name: 'Sanctified', condition: 'Buy 20 Sanctum nodes', reward: s(300), rule: { kind: 'meta:sanctumLevels', n: 20 } },
  { id: 'a57', name: 'Keystone', condition: 'Buy a keystone', reward: s(200), rule: { kind: 'meta:keystone' } },
  { id: 'a58', name: 'Contractor', condition: 'Claim 25 contracts', reward: s(300), rule: { kind: 'meta:contracts', n: 25 } },
  { id: 'a59', name: 'Daily Devotion', condition: '7-day Daily Rite streak', reward: SIGIL, rule: { kind: 'meta:dailyStreak', n: 7 } },
  { id: 'a60', name: 'Riftwalker', condition: 'Extract from a Weekly Rift', reward: SIGIL, rule: { kind: 'run:extractWeekly' } },
];
