import { isDailyMode, sessionSeed, setDailyMode } from '../../core/daily';
import { Rng } from '../../core/rng';
import { load, save } from '../../core/storage';
import { hasUnlock, loadMeta, totalStars, type MetaSave } from '../../core/progression';
import { ARK_NODES, KITS, KIT_NONE, SITES, type LandingKit, type SiteDef } from '../../slices/colony/content';
import type { LandingSetup } from '../../slices/colony/contracts';

/**
 * Landing selection rules shared by the hub tabs and the results RETRY
 * (PRD §10 save schema: `colony:last*` keys, `rung:<site>:<r>` unlocks,
 * `<site>:<rung>` stars; §14b edge states).
 */
export const RUNGS = 5;
const KEY = { site: 'colony:lastSite', rung: 'colony:lastRung', kit: 'colony:lastKit' } as const;

/** Owned Ark node ids (the setup's `ark`; the model resolves their effects and unlocks). */
function ownedArk(meta: MetaSave = loadMeta()): string[] {
  return ARK_NODES.filter((n) => meta.unlocks.includes(n.id)).map((n) => n.id);
}

export function siteLock(site: SiteDef): string | null {
  if (site.requiresNode !== null && !hasUnlock(site.requiresNode)) {
    const node = ARK_NODES.find((n) => n.id === site.requiresNode);
    return `Needs Ark: ${node?.name ?? site.requiresNode}`;
  }
  const stars = totalStars();
  return stars < site.starsToUnlock ? `Needs ${site.starsToUnlock} ★ (${stars} now)` : null;
}

/** Highest rung playable on a site: rung 1, then every rung a win opened (`rung:<site>:<r>`). */
export function maxRung(siteId: string): number {
  let r = 1;
  while (r < RUNGS && hasUnlock(`rung:${siteId}:${r + 1}`)) r += 1;
  return r;
}

export function kitUnlocked(kit: LandingKit): boolean {
  return kit.openAtL1 || (kit.unlockNode !== null && hasUnlock(kit.unlockNode));
}

export function stars(siteId: string, rung: number, meta: MetaSave = loadMeta()): number {
  return meta.stars[`${siteId}:${rung}`] ?? 0;
}

function findSite(id: string): SiteDef {
  return SITES.find((s) => s.id === id) ?? (SITES[0] as SiteDef);
}

function findKit(id: string): LandingKit {
  return KITS.find((k) => k.id === id) ?? KIT_NONE;
}

/** The persisted LAND selection, re-validated (a locked site / rung / kit falls back, never dead-ends LAUNCH). */
export function lastSelection(): { site: SiteDef; rung: number; kit: LandingKit } {
  let site = findSite(load<string>(KEY.site, SITES[0]?.id ?? ''));
  if (siteLock(site) !== null) site = SITES[0] as SiteDef;
  const rung = Math.min(Math.max(1, load<number>(KEY.rung, 1)), maxRung(site.id));
  let kit = findKit(load<string>(KEY.kit, KIT_NONE.id));
  if (!kitUnlocked(kit)) kit = KIT_NONE;
  return { site, rung, kit };
}

export function saveSelection(site: SiteDef, rung: number, kit: LandingKit): void {
  save(KEY.site, site.id);
  save(KEY.rung, rung);
  save(KEY.kit, kit.id);
}

export interface SetupOpts {
  site: SiteDef;
  rung: number;
  kit: LandingKit;
  daily: boolean;
  ftue: boolean;
  /** Replays a seed (RETRY); a fresh one otherwise. */
  seed?: string;
}

/** The `LandingSetup` GameScene receives (`scene.start(SCENES.game, { setup })`). */
export function landingSetup(o: SetupOpts): LandingSetup {
  const meta = loadMeta();
  if (isDailyMode() !== o.daily) setDailyMode(o.daily);
  const seed = o.seed ?? (o.daily ? sessionSeed() : `${o.site.id}:${o.rung}:${Date.now().toString(36)}`);
  return { site: o.site, rung: o.rung, kit: o.kit, seed, size: 'frontier', ark: ownedArk(meta), refit: meta.upgrades.refit ?? 0, daily: o.daily, ftue: o.ftue };
}

/** Today's daily Landing: an unlocked site and rung drawn from the day seed (same for every player on those unlocks). */
export function dailySetup(kit: LandingKit): LandingSetup {
  setDailyMode(true);
  const seed = sessionSeed();
  const rng = new Rng(`${seed}:daily-site`);
  const open = SITES.filter((s) => siteLock(s) === null);
  const site = open[rng.int(0, Math.max(0, open.length - 1))] ?? (SITES[0] as SiteDef);
  const rung = Math.min(maxRung(site.id), rng.int(1, 3));
  return landingSetup({ site, rung, kit, daily: true, ftue: false, seed });
}

/** The first-ever Landing (§14b law 7): Halcyon rung 1, the empty crate, no landing pick. */
export function ftueSetup(): LandingSetup {
  return landingSetup({ site: SITES[0] as SiteDef, rung: 1, kit: KIT_NONE, daily: false, ftue: true });
}

/** Hub map node centres, map-local px on the 720 × 900 `hub-planet-map` (art/briefs/reports/hub.md §Site-node plan). */
export const NODE_CENTRE: Readonly<Record<string, { x: number; y: number }>> = {
  halcyon: { x: 168, y: 812 },
  prism_reach: { x: 480, y: 744 },
  rimewater: { x: 188, y: 580 },
  frostcrown: { x: 500, y: 534 },
  cinder_fen: { x: 150, y: 378 },
  sulfur_hollow: { x: 490, y: 310 },
  nacre_shelf: { x: 220, y: 194 },
  aurora_rift: { x: 540, y: 70 },
};

/** Display journal written by `settleLanding` (newest first). */
export interface LogEntry { siteId: string; rung: number; reason: string; won: boolean; sols: number; data: number; stars: number; at: number }

export function landingLog(): LogEntry[] {
  const raw = load<unknown>('colony:log', []);
  return Array.isArray(raw) ? (raw as LogEntry[]) : [];
}
