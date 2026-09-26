/**
 * Points of interest runtime (PRD-V2 §5.12, §16.1 E18/E19).
 *
 * Runs on WorldGen's `map.pois` anchors: reliquary chests t1-t3 (interruptible
 * channel), the Dread Vault (Dread Key = instant, else a 12 s channel inside a
 * density pocket), 3 elite lairs (dormant pack spawned on approach), the
 * mid-boss den (opens 240 s, bone wall 20 s), 5 shrines, shard veins, lore
 * stones, the two bells of a Bell Gate run, the Wandering Fence (60%,
 * 180-300 s, stays 90 s) and 3 timeline events at `poi.eventTimesS` in a seeded
 * order (Gilded Caravan / Bell Vigil / Grave Rising) at event yards
 * ≥ `EVENT_MIN_DIST` from the hero. Elite/boss kills drop walk-over chests.
 *
 * Every random draw goes through `ctx.rng`. Every channel uses the SAME
 * accrual rule as the gates (`channelAccrualRate`, `TUNING.extract`
 * hit setback/stall). Phaser is touched only through `scene.add.image` /
 * `scene.textures` / `scene.anims` (type-only import), so the selftest can
 * drive the logic with a stub scene.
 */
import type Phaser from 'phaser';
import { TUNING } from '../config';
import { TEX } from '../core/keys';
import type { Rng } from '../core/rng';
import { ELITE_AFFIXES } from '../data/eliteAffixes';
import { enemiesForZone, midBossDef } from '../data/enemies';
import { rollGear } from '../data/gear';
import {
  EVENT_MIN_DIST,
  EVENT_WARN_S,
  FENCE_TRADES,
  loreIds,
  poiDef,
} from '../data/pois';
import type {
  Depth,
  EliteAffixId,
  EventKind,
  FenceOffer,
  FenceTradeId,
  GeneratedMap,
  KillReport,
  LootItem,
  MinimapModel,
  PoiAnchor,
  PoiKind,
  PickupId,
  PoiSpawnSpec,
  RunLoadoutV2,
} from '../data/types-v2';
import { lootUid, rollValuable, VALUABLES } from '../data/valuables';
import { zoneDef, type ZoneDef } from '../data/zones';
import type { Bag } from './bag';
import { itemRarity } from './bag';
import { channelAccrualRate, type ChannelContest, type ChannelTuning } from './extraction';

/** §16.1 E19, implemented in `game.ts`. */
export interface PoiCallbacks {
  onLoot(items: LootItem[], shards: number, x: number, y: number, source: string): void;
  onEliteChest(x: number, y: number, boss: boolean): void;
  onShrine(kind: PoiKind): void;
  onEvent(kind: EventKind, phase: 'start' | 'success' | 'fail'): void;
  onFence(offers: FenceOffer[]): void;
  onVein(shards: number): void;
  onLore(id: string): void;
  onBell(rung: number): void;
  requestSpawn(spec: PoiSpawnSpec): string[];
  onDenLock(locked: boolean): void;
}

export interface PoiContext { rng: Rng; zone: ZoneDef; loadout: RunLoadoutV2; callbacks: PoiCallbacks }

/** `RunReport` counters this system owns. */
export interface PoiStats {
  chestsOpened: number; vaultOpened: boolean; shrinesUsed: number; lairsCleared: number; eventsCompleted: number;
  veinsMined: number; loreRead: string[]; fenceTrades: number; poisVisited: number; midBossKilled: boolean;
}

/** Result of a Fence trade (`fenceTrade`); `game.ts` applies `effect` and banks `item`. */
export interface FenceTradeResult { ok: boolean; effect: 'heal' | 'rerolls' | 'reveal' | null; item: LootItem | null }

/** Stand radius per interactive kind (inside the clearing). */
const INTERACT_PX: Partial<Record<PoiKind, number>> = {
  chest_t1: 120, chest_t2: 120, chest_t3: 120, vault: 170, shrine_blood: 110, shrine_gilt: 110, shrine_bone: 110,
  shrine_grave: 110, shrine_curse: 110, vein: 90, lore: 90, bell: 120, fence: 170,
};
/** Walk-over radius of a dropped Elite/Boss chest. */
const DROP_CHEST_PX = 80;
/** Stand time for shrines (§5.12 "stand 1 s"). */
const SHRINE_STAND_MS = 1000;
/** Vault pocket: batch spawned when the channel starts and every `VAULT_PULSE_MS` while it runs (× `poi.vault.densityMul`). */
const VAULT_BATCH = 8;
const VAULT_PULSE_MS = 4000;
/** Grave Rising: the window opens when the hero first stands in the circle; enemies are fed in batches. */
const RISING_BATCH = 24;
const RISING_BATCH_MS = 8000;
/** An event nobody attends fails this long after it starts (Vigil gets 2 × holdS). */
const EVENT_ATTEND_S = 60;
/** Den bone wall: one segment per stamp doorway on this ring, covering the doorway width (WorldGen den stamp). */
const DEN_WALL_RING_PX = 540;
const DEN_DOORWAY_PX = 280;
const POI_DEPTH = 5;
/**
 * 16× map (WorldGen, ~820 anchors): records are bucketed into CHUNK_PX cells so
 * per-frame proximity work only visits the cells around the hero, and sprites
 * stream in within SPRITE_IN_PX and out beyond SPRITE_OUT_PX (checked every
 * SPRITE_SCAN_MS) — the same hysteresis WorldGen uses for hazards.
 */
const CHUNK_PX = 2048;
const SPRITE_IN_PX = 2400;
const SPRITE_OUT_PX = 3000;
const SPRITE_SCAN_MS = 250;
/** XP burst per completed POI, in levels at the §6.1 expected level (critic M4). */
const POI_XP_LEVELS: Partial<Record<PoiKind, number>> = {
  chest_t1: 0.6, chest_t2: 0.8, chest_t3: 1, vault: 1.5, lair: 1, vein: 0.35, lore: 0.25, bell: 0.3,
  shrine_blood: 0.5, shrine_gilt: 0.5, shrine_bone: 0.5, shrine_grave: 0.5, shrine_curse: 0.8, event_yard: 1,
};
/** Deeper POIs pay more: × (1 + step · depth). */
const POI_XP_DEPTH_STEP = 0.25;
/** §6.1 level targets (seconds → level) the burst is priced against. */
const LEVEL_PACE: readonly (readonly [number, number])[] = [[0, 1], [10, 2], [120, 8], [240, 16], [360, 21], [480, 25]];

function expectedLevelAt(s: number): number {
  for (let i = 1; i < LEVEL_PACE.length; i += 1) {
    const [t1, l1] = LEVEL_PACE[i]!;
    const [t0, l0] = LEVEL_PACE[i - 1]!;
    if (s <= t1) return Math.floor(l0 + ((l1 - l0) * (s - t0)) / (t1 - t0));
  }
  return LEVEL_PACE[LEVEL_PACE.length - 1]![1];
}

/**
 * XP one completed POI of `kind` at `depth` pays at run second `elapsedS`
 * (critic M4): `POI_XP_LEVELS[kind]` levels at the §6.1 expected level,
 * × (1 + 0.25·depth). Shared by `PoiSystem` and the balance sim; 0 for kinds that pay none.
 */
export function poiXpBurst(kind: PoiKind, depth: Depth, elapsedS: number): number {
  const levels = POI_XP_LEVELS[kind] ?? 0;
  if (levels <= 0) return 0;
  return Math.round(levels * xpForLevel(expectedLevelAt(elapsedS)) * (1 + POI_XP_DEPTH_STEP * depth));
}

/** §6.1 `xpNeeded(L)` from `TUNING.xp`. */
function xpForLevel(level: number): number {
  const x = TUNING.xp;
  return x.base + x.linear * (level - 1) + (level > x.kneeLevel ? x.kneeStep * (level - x.kneeLevel) : 0);
}
const DISPLAY_PX: Partial<Record<PoiKind, number>> = {
  chest_t1: 112, chest_t2: 112, chest_t3: 120, vault: 220, lair: 120, shrine_blood: 170, shrine_gilt: 170,
  shrine_bone: 170, shrine_grave: 170, shrine_curse: 170, vein: 110, lore: 110, bell: 170, fence: 200,
};
const FALLBACK_TINT: Partial<Record<PoiKind, number>> = {
  chest_t1: 0xa5a38b, chest_t2: 0xc07a3a, chest_t3: 0xf3ca67, vault: 0xad6eef, lair: 0xb3122e, den: 0xeae1bf,
  shrine_blood: 0x8b1e1e, shrine_gilt: 0xd9a24b, shrine_bone: 0xeae1bf, shrine_grave: 0x6fd6ff, shrine_curse: 0xad6eef,
  vein: 0xf3ca67, lore: 0x9bdf9f, bell: 0xe8c547, fence: 0x9bdf9f,
};
/** Opened/depleted sheet frame per kind (ArtPOI: chest 3, vault 1, vein 2). */
const OPENED_FRAME: Partial<Record<PoiKind, number>> = { chest_t1: 3, chest_t2: 3, chest_t3: 3, vault: 1, vein: 2 };
/** Largest stand radius in INTERACT_PX — the channel broad phase. */
const MAX_INTERACT_PX = 170;
const EVENT_ORDER: readonly EventKind[] = ['ev_caravan', 'ev_vigil', 'ev_rising'];

/** Only anchors this run uses get a record (unpicked lore/fence candidates and bells without a Bell Gate are skipped). */
interface PoiRuntime {
  anchor: PoiAnchor;
  discovered: boolean;
  done: boolean;
  channelMs: number;
  stallMs: number;
  /** Lore id / lair affix etc. */
  tag: string;
  sprite: Phaser.GameObjects.Image | null;
  /** Lair: dormant pack spawned. Den: fight started. */
  spawned: boolean;
}

interface EventRuntime {
  kind: EventKind;
  atS: number;
  yard: PoiAnchor | null;
  phase: 'pending' | 'warned' | 'live' | 'done';
  startedS: number;
  progress: number;
  kills: number;
  windowStartS: number | null;
  wavesSent: number;
}

interface DropChest { x: number; y: number; boss: boolean; sprite: Phaser.GameObjects.Image | null }

export class PoiSystem {
  private readonly scene: Phaser.Scene;
  private readonly map: GeneratedMap;
  private readonly rng: Rng;
  private readonly loadout: RunLoadoutV2;
  private readonly cb: PoiCallbacks;
  private readonly channel: ChannelTuning;
  private readonly pois: PoiRuntime[] = [];
  private readonly events: EventRuntime[];
  private readonly chests: DropChest[] = [];
  private readonly denWallSprites: Phaser.GameObjects.Image[] = [];
  private readonly luck: number;
  /** Zone (§5.29) + hazard/mutator rarity shift for gear rolls — the same sum the hub's LOOT ODDS prints. */
  private readonly lootBias: number;
  private elapsedMs = 0;
  private fenceAtS: number | null = null;
  private fenceOffered = false;
  private dreadKeyCount: number;
  private curseRolls = 0;
  private mercyPending: boolean;
  private revealUntilMs = 0;
  private revealForever = false;
  private channelPoi: PoiRuntime | null = null;
  private vaultPulseMs = 0;
  private denLockMs = 0;
  /** The den whose bone wall is up (at most one: the hero can stand in one den). */
  private lockedDen: PoiRuntime | null = null;
  /** The one Wandering Fence this run (a seeded pick among the fence candidates), if rolled. */
  private fence: PoiRuntime | null = null;
  private bellsRung = 0;
  /** Chunk key → records; key = row · chunkCols + col. */
  private readonly chunks = new Map<number, PoiRuntime[]>();
  private readonly chunkCols: number;
  private readonly liveSprites = new Set<PoiRuntime>();
  private spriteScanMs = 0;
  /** Scratch for `near()` (reused every call; never retained by callers). */
  private readonly nearScratch: PoiRuntime[] = [];
  private xpQueue: { x: number; y: number; xp: number }[] = [];
  private pickupQueue: { id: PickupId; x: number; y: number }[] = [];
  private readonly counters: PoiStats = {
    chestsOpened: 0, vaultOpened: false, shrinesUsed: 0, lairsCleared: 0, eventsCompleted: 0,
    veinsMined: 0, loreRead: [], fenceTrades: 0, poisVisited: 0, midBossKilled: false,
  };

  constructor(scene: Phaser.Scene, map: GeneratedMap, ctx: PoiContext) {
    this.scene = scene;
    this.map = map;
    this.rng = ctx.rng;
    this.loadout = ctx.loadout;
    this.cb = ctx.callbacks;
    this.channel = { ...TUNING.extract, contestedRate: ctx.loadout.contestedRate > 0 ? ctx.loadout.contestedRate : TUNING.extract.contestedRate };
    this.dreadKeyCount = Math.max(0, ctx.loadout.startDreadKeys);
    this.mercyPending = ctx.loadout.mercy;
    this.luck = ctx.loadout.modifiers.reduce((n, m) => n + (m.stat === 'luck' ? (m.add ?? 0) : 0), 0);
    this.lootBias = zoneDef(map.zone).lootBias + ctx.loadout.lootBias;

    const bellRun = map.gates.some((g) => g.kind === 'bell');
    // Per-run singletons on a map with many candidates: 3 lore stones (random
    // anchors, random codex ids of the zone's 6) and at most 1 Fence.
    const lore = this.rng.shuffle(loreIds(map.zone));
    const loreAnchors = map.pois.filter((a) => a.kind === 'lore');
    const loreCount = Math.min(poiDef('lore').perRun, lore.length, loreAnchors.length);
    const loreTag = new Map<string, string>();
    this.rng.shuffle([...loreAnchors]).slice(0, loreCount).forEach((a, i) => loreTag.set(a.id, lore[i]!));
    const fenceAnchors = map.pois.filter((a) => a.kind === 'fence');
    const fenceRolled = this.rng.chance(ctx.loadout.fenceChance) && fenceAnchors.length > 0;
    const fenceId = fenceRolled ? this.rng.pick(fenceAnchors).id : null;
    this.chunkCols = Math.max(1, Math.ceil(map.width / CHUNK_PX));
    for (const anchor of map.pois) {
      if (anchor.kind === 'event_yard') continue;
      let active = true;
      let tag = '';
      if (anchor.kind === 'lore') {
        tag = loreTag.get(anchor.id) ?? '';
        active = tag !== '';
      } else if (anchor.kind === 'bell') {
        active = bellRun;
      } else if (anchor.kind === 'fence') {
        active = anchor.id === fenceId;
      }
      if (!active) continue;
      const rec: PoiRuntime = { anchor, discovered: false, done: false, channelMs: 0, stallMs: 0, tag, sprite: null, spawned: false };
      this.pois.push(rec);
      if (anchor.kind === 'fence') this.fence = rec;
      const key = this.chunkKey(anchor.x, anchor.y);
      const bucket = this.chunks.get(key);
      if (bucket === undefined) this.chunks.set(key, [rec]);
      else bucket.push(rec);
    }
    if (this.fence !== null) {
      const [lo, hi] = TUNING.poi.fence.windowS;
      this.fenceAtS = this.rng.float(lo, hi);
    }
    const order = this.rng.shuffle([...EVENT_ORDER]);
    this.events = TUNING.poi.eventTimesS.map((atS, i) => ({
      kind: order[i % order.length]!, atS, yard: null, phase: 'pending', startedS: 0, progress: 0, kills: 0, windowStartS: null, wavesSent: 0,
    }));
  }

  /** Seconds this system has been ticked. */
  get elapsedS(): number {
    return this.elapsedMs / 1000;
  }

  /** Dread Keys held (start keys + lair/mid-boss drops − vault use). */
  get dreadKeys(): number {
    return this.dreadKeyCount;
  }

  /** RunReport counters (copy). */
  stats(): PoiStats {
    return { ...this.counters, loreRead: [...this.counters.loreRead] };
  }

  /**
   * Exploration XP (critic M4: POI routes starved XP). Each completed POI,
   * cleared lair and won event queues one burst worth `POI_XP_LEVELS[kind]`
   * levels at the level the §6.1 pacing expects for the elapsed time, scaled
   * up with depth. `game.ts` drains this every frame and spawns XP orbs.
   */
  takeXpBursts(): { x: number; y: number; xp: number }[] {
    if (this.xpQueue.length === 0) return [];
    const out = this.xpQueue;
    this.xpQueue = [];
    return out;
  }

  /**
   * Ground pickups POIs drop (critic v2c M1 in-run heal): Grave Bread from
   * elite kills (`pickups.bread.eliteChance`) and t2+ reliquaries
   * (`pickups.bread.chestChance`). `game.ts` drains this every frame and drops
   * each as a `LootPickup` {kind:'pickup'}.
   */
  takePickups(): { id: PickupId; x: number; y: number }[] {
    if (this.pickupQueue.length === 0) return [];
    const out = this.pickupQueue;
    this.pickupQueue = [];
    return out;
  }

  /** Bone-wall circles while the den is locked (the scene makes them static blockers). */
  denWalls(): { x: number; y: number; r: number }[] {
    const den = this.lockedDen;
    if (den === null) return [];
    // Den stamp doorways (WorldGen): k·π/4 for odd k (+y south), 280 px wide, ring r 540.
    return [1, 3, 5, 7].map((k) => ({
      x: den.anchor.x + Math.cos((k * Math.PI) / 4) * DEN_WALL_RING_PX,
      y: den.anchor.y + Math.sin((k * Math.PI) / 4) * DEN_WALL_RING_PX,
      r: DEN_DOORWAY_PX / 2,
    }));
  }

  /** Lantern Oil (60 s) / Fence reveal (`null` = rest of run): every active POI shows on the minimap. */
  reveal(ms: number | null): void {
    if (ms === null) this.revealForever = true;
    else this.revealUntilMs = Math.max(this.revealUntilMs, this.elapsedMs + ms);
  }

  update(deltaMs: number, hero: { x: number; y: number }, contest: (x: number, y: number, r: number) => ChannelContest, hitThisFrame: boolean): void {
    if (deltaMs <= 0) return;
    this.elapsedMs += deltaMs;
    const t = this.elapsedS;
    const revealPx = this.loadout.minimapRevealPx > 0 ? this.loadout.minimapRevealPx : TUNING.minimap.revealPx;

    for (const p of this.near(hero.x, hero.y, Math.max(revealPx, TUNING.poi.activateRadius))) {
      const d = Math.hypot(p.anchor.x - hero.x, p.anchor.y - hero.y);
      if (!p.discovered && d <= revealPx && this.visibleNow(p)) p.discovered = true;
      if (p.anchor.kind === 'lair' && !p.spawned && d <= TUNING.poi.activateRadius) this.spawnLair(p);
    }
    this.spriteScanMs -= deltaMs;
    if (this.spriteScanMs <= 0) {
      this.spriteScanMs = SPRITE_SCAN_MS;
      this.streamSprites(hero);
    }
    this.tickFence(t, hero);
    this.tickDen(deltaMs, t, hero);
    this.tickChannel(deltaMs, hero, contest, hitThisFrame);
    this.tickEvents(t, deltaMs, hero);
    this.tickDropChests(hero);
  }

  /** Elite/Boss chest on the ground (walk over ⇒ `onEliteChest` + item roll `onLoot`). */
  dropChest(x: number, y: number, kind: 'elite' | 'boss'): void {
    const sprite = this.makeSprite(kind === 'boss' ? 'chest_t3' : 'chest_t2', x, y);
    sprite?.setTint(kind === 'boss' ? 0xad6eef : 0xf3ca67);
    this.chests.push({ x, y, boss: kind === 'boss', sprite });
  }

  /**
   * Kill hook (call for EVERY kill). Elites ⇒ Elite Chest + `loot.eliteValuables`
   * (+ `eliteExtraValuables`) valuables; lair elite ⇒ lair cleared + Dread Key
   * 35%; zone boss ⇒ Boss Chest; mid-boss ⇒ Gilded+ gear + 1 Dread Key, den
   * unlocks; Gilded Ghoul ⇒ valuable roll (50% during the Caravan); Grave
   * Rising counts kills inside its circle.
   */
  onKill(k: KillReport): void {
    for (const ev of this.events) {
      if (ev.phase === 'live' && ev.kind === 'ev_rising' && ev.yard !== null && ev.windowStartS !== null) {
        if (Math.hypot(k.x - ev.yard.x, k.y - ev.yard.y) <= TUNING.poi.events.rising.radius) ev.kills += 1;
      }
    }
    if (k.defId === 'gildedghoul') {
      const caravan = this.events.find((e) => e.kind === 'ev_caravan' && e.phase === 'live');
      if (caravan !== undefined) caravan.kills += 1;
      if (caravan === undefined || this.rng.chance(0.5)) {
        this.cb.onLoot([{ kind: 'valuable', item: rollValuable(this.rng, 0, this.map.zone) }], 0, k.x, k.y, 'gildedghoul');
      }
    }
    if (k.boss === 'zone') {
      this.dropChest(k.x, k.y, 'boss');
      return;
    }
    if (k.boss === 'mid') {
      this.counters.midBossKilled = true;
      this.dreadKeyCount += 1;
      this.cb.onLoot([this.rollItem(3, 0)], 0, k.x, k.y, 'midboss');
      // The den this mid-boss came from: the locked one, else the nearest fought den.
      let den = this.lockedDen;
      if (den === null) {
        let best = Infinity;
        for (const p of this.near(k.x, k.y, CHUNK_PX)) {
          if (p.anchor.kind !== 'den' || !p.spawned || p.done) continue;
          const d = Math.hypot(k.x - p.anchor.x, k.y - p.anchor.y);
          if (d < best) {
            best = d;
            den = p;
          }
        }
      }
      if (this.lockedDen !== null) this.setDenLock(null);
      if (den !== null && !den.done) {
        den.done = true;
        this.counters.poisVisited += 1;
      }
      return;
    }
    if (k.elite === null) return;
    this.dropChest(k.x, k.y, 'elite');
    if (this.rng.chance(TUNING.pickups.bread.eliteChance)) this.pickupQueue.push({ id: 'pk_bread', x: k.x + 40, y: k.y + 40 });
    const valuables = TUNING.loot.eliteValuables + Math.max(0, this.loadout.eliteExtraValuables);
    const items: LootItem[] = [];
    for (let i = 0; i < valuables; i += 1) items.push({ kind: 'valuable', item: rollValuable(this.rng, 0, this.map.zone) });
    if (items.length > 0) this.cb.onLoot(items, 0, k.x, k.y, 'elite');
    const lairReach = poiDef('lair').clearingRadius + 240;
    const lair = this.near(k.x, k.y, lairReach).find(
      (p) => p.anchor.kind === 'lair' && p.spawned && !p.done && Math.hypot(k.x - p.anchor.x, k.y - p.anchor.y) <= lairReach,
    );
    if (lair !== undefined) {
      lair.done = true;
      this.counters.lairsCleared += 1;
      this.counters.poisVisited += 1;
      if (this.rng.chance(TUNING.poi.lair.keyChance)) this.dreadKeyCount += 1;
      this.applyLook(lair);
      this.queueXp('lair', lair.anchor.x, lair.anchor.y, lair.anchor.depth);
    }
  }

  minimap(): MinimapModel['pois'] {
    const revealed = this.revealForever || this.elapsedMs < this.revealUntilMs;
    const out: MinimapModel['pois'] = [];
    for (const p of this.pois) {
      if (!this.visibleNow(p)) continue;
      if (!p.discovered && !revealed) continue;
      out.push({ id: p.anchor.id, kind: p.anchor.kind, x: p.anchor.x, y: p.anchor.y, done: p.done });
    }
    for (const ev of this.events) {
      if ((ev.phase === 'warned' || ev.phase === 'live') && ev.yard !== null) {
        out.push({ id: `${ev.kind}@${ev.atS}`, kind: ev.kind, x: ev.yard.x, y: ev.yard.y, done: false });
      }
    }
    return out;
  }

  channelling(): { poiId: string; progress: number } | null {
    const p = this.channelPoi;
    if (p === null) return null;
    const need = this.channelNeedMs(p);
    return { poiId: p.anchor.id, progress: need <= 0 ? 1 : Math.min(1, p.channelMs / need) };
  }

  nearestUndiscovered(x: number, y: number): PoiAnchor | null {
    let best: PoiAnchor | null = null;
    let bestD = Infinity;
    for (const p of this.pois) {
      if (p.discovered || p.done || !this.visibleNow(p)) continue;
      const d = Math.hypot(p.anchor.x - x, p.anchor.y - y);
      if (d < bestD) {
        bestD = d;
        best = p.anchor;
      }
    }
    return best;
  }

  /**
   * Resolves one Fence trade against the bag (§5.12.7). Gives up the LOWEST-value
   * unpinned eligible items. `fence_upgrade` returns a gear roll whose tier bias
   * equals the best given rarity (weights shift ⇒ result ≥ that rarity + 1).
   */
  fenceTrade(id: FenceTradeId, bag: Bag): FenceTradeResult {
    const fail: FenceTradeResult = { ok: false, effect: null, item: null };
    const view = bag.view();
    const cheapest = (pred: (i: LootItem) => boolean): string[] =>
      [...view.items].filter((v) => pred(v.item)).sort((a, b) => a.value - b.value).map((v) => v.uid);
    let result: FenceTradeResult = fail;
    if (id === 'fence_heal') {
      const uid = cheapest((i) => i.kind === 'gear')[0];
      if (uid !== undefined && bag.drop(uid) !== null) result = { ok: true, effect: 'heal', item: null };
    } else if (id === 'fence_rerolls') {
      const uid = cheapest((i) => i.kind === 'valuable')[0];
      if (uid !== undefined && bag.drop(uid) !== null) result = { ok: true, effect: 'rerolls', item: null };
    } else if (id === 'fence_reveal') {
      const cost = FENCE_TRADES.find((f) => f.id === 'fence_reveal')?.cost.shards ?? 60;
      if (bag.spendShards(cost)) {
        this.reveal(null);
        result = { ok: true, effect: 'reveal', item: null };
      }
    } else {
      const uids = cheapest(() => true).slice(0, 2);
      if (uids.length === 2) {
        let best = 1;
        for (const uid of uids) {
          const given = bag.drop(uid);
          if (given !== null) best = Math.max(best, itemRarity(given));
        }
        result = { ok: true, effect: null, item: this.rollItem(best, 0) };
      }
    }
    if (result.ok) this.counters.fenceTrades += 1;
    return result;
  }

  /** Scene SHUTDOWN: release sprites. */
  destroy(): void {
    for (const p of this.liveSprites) {
      p.sprite?.destroy();
      p.sprite = null;
    }
    this.liveSprites.clear();
    for (const c of this.chests) c.sprite?.destroy();
    for (const w of this.denWallSprites) w.destroy();
    this.chests.length = 0;
    this.denWallSprites.length = 0;
  }

  // ─── rolls ───

  /**
   * One gear roll (§5.15 "item roll"): source bias + curse shrine bonus (next 3
   * rolls +1) + Grave's Pity on the first chest. Luck/hazard bias go to `rollGear`.
   */
  private rollItem(tierBias: number, uniqueChance: number): LootItem {
    let bias = tierBias;
    if (this.curseRolls > 0) {
      bias += TUNING.poi.shrines.curse.tierBonus;
      this.curseRolls -= 1;
    }
    const gear = rollGear(this.rng, {
      tierBias: bias,
      luck: this.luck,
      lootBias: this.lootBias,
      itemLevel: this.loadout.itemLevel,
      uniqueChance,
      zone: this.map.zone,
    });
    return { kind: 'gear', item: gear };
  }

  // ─── ticks ───

  private visibleNow(p: PoiRuntime): boolean {
    if (p.anchor.kind === 'fence') return this.fenceAtS !== null && this.elapsedS >= this.fenceAtS && this.elapsedS < this.fenceAtS + TUNING.poi.fence.stayS;
    if (p.anchor.kind === 'den') return this.elapsedS >= TUNING.midboss.opensS || p.done;
    return true;
  }

  private tickFence(t: number, hero: { x: number; y: number }): void {
    const fence = this.fence;
    if (fence === null || this.fenceAtS === null || fence.done) return;
    const here = this.visibleNow(fence);
    if (!here && t >= this.fenceAtS + TUNING.poi.fence.stayS) {
      fence.done = true;
      this.dropSprite(fence);
      return;
    }
    if (!here || this.fenceOffered) return;
    if (Math.hypot(hero.x - fence.anchor.x, hero.y - fence.anchor.y) <= (INTERACT_PX.fence ?? 170)) {
      this.fenceOffered = true;
      this.counters.poisVisited += 1;
      this.cb.onFence([...FENCE_TRADES]);
    }
  }

  private tickDen(deltaMs: number, t: number, hero: { x: number; y: number }): void {
    if (this.lockedDen !== null) {
      this.denLockMs -= deltaMs;
      if (this.denLockMs <= 0) this.setDenLock(null);
      return;
    }
    if (t < TUNING.midboss.opensS) return;
    const r = poiDef('den').clearingRadius;
    const den = this.near(hero.x, hero.y, r).find(
      (p) => p.anchor.kind === 'den' && !p.spawned && !p.done && Math.hypot(hero.x - p.anchor.x, hero.y - p.anchor.y) <= r,
    );
    if (den === undefined) return;
    den.spawned = true;
    this.cb.requestSpawn({
      source: `den:${den.anchor.id}`, x: den.anchor.x, y: den.anchor.y, radius: 120,
      entries: [{ defId: midBossDef(this.map.zone).id, count: 1, elite: null }],
    });
    this.denLockMs = TUNING.midboss.lockS * 1000;
    this.setDenLock(den);
  }

  private setDenLock(den: PoiRuntime | null): void {
    this.lockedDen = den;
    const locked = den !== null;
    for (const w of this.denWallSprites) w.destroy();
    this.denWallSprites.length = 0;
    if (locked) {
      for (const wall of this.denWalls()) {
        const s = this.makeSprite('den', wall.x, wall.y);
        if (s !== null) this.denWallSprites.push(s);
      }
    }
    this.cb.onDenLock(locked);
  }

  private spawnLair(p: PoiRuntime): void {
    p.spawned = true;
    const pool = enemiesForZone(this.map.zone).filter((d) => d.firstSeenS <= Math.max(60, this.elapsedS));
    const eliteDef = this.rng.pick(pool.length > 0 ? pool : enemiesForZone(this.map.zone));
    const affix: EliteAffixId = this.loadout.hazardExtras.forcedAffix ?? this.rng.pick(ELITE_AFFIXES).id;
    p.tag = affix;
    const [lo, hi] = TUNING.poi.lair.guards;
    const guards = this.rng.int(lo, hi);
    const guardDef = this.rng.pick(pool.length > 0 ? pool : enemiesForZone(this.map.zone));
    this.cb.requestSpawn({
      source: `lair:${p.anchor.id}`, x: p.anchor.x, y: p.anchor.y, radius: poiDef('lair').clearingRadius * 0.6, dormant: true,
      entries: [
        { defId: eliteDef.id, count: 1, elite: affix },
        { defId: guardDef.id, count: guards, elite: null },
      ],
    });
  }

  private channelNeedMs(p: PoiRuntime): number {
    const c = TUNING.poi.chest;
    switch (p.anchor.kind) {
      case 'chest_t1': return c.t1.channelMs;
      case 'chest_t2': return c.t2.channelMs;
      case 'chest_t3': return c.t3.channelMs;
      case 'vault': return TUNING.poi.vault.channelMs;
      case 'vein': return this.loadout.veinStandMs > 0 ? this.loadout.veinStandMs : TUNING.poi.vein.standMs;
      case 'bell': return TUNING.gates.bell.standMs;
      case 'lore': return 0;
      default: return SHRINE_STAND_MS;
    }
  }

  private tickChannel(deltaMs: number, hero: { x: number; y: number }, contest: (x: number, y: number, r: number) => ChannelContest, hit: boolean): void {
    // Nearest channelable POI in stand range.
    let target: PoiRuntime | null = null;
    let bestD = Infinity;
    for (const p of this.near(hero.x, hero.y, MAX_INTERACT_PX)) {
      if (p.done || p.anchor.kind === 'lair' || p.anchor.kind === 'den' || p.anchor.kind === 'fence') continue;
      const d = Math.hypot(p.anchor.x - hero.x, p.anchor.y - hero.y);
      if (d <= (INTERACT_PX[p.anchor.kind] ?? 110) && d < bestD) {
        bestD = d;
        target = p;
      }
    }
    if (target !== this.channelPoi && this.channelPoi !== null) this.channelPoi.stallMs = 0;
    this.channelPoi = target;
    if (target === null) return;

    // u_gravekey (Gravekey unique): vault opens without a Dread Key; otherwise a held key is spent.
    if (target.anchor.kind === 'vault' && target.channelMs === 0 && (this.loadout.uniques.includes('u_gravekey') || this.dreadKeyCount > 0)) {
      if (!this.loadout.uniques.includes('u_gravekey')) this.dreadKeyCount -= 1;
      this.complete(target);
      return;
    }
    if (target.anchor.kind === 'vault') this.tickVaultPocket(target, deltaMs);

    const need = this.channelNeedMs(target);
    if (need <= 0) {
      this.complete(target);
      return;
    }
    if (hit) {
      target.channelMs = Math.max(0, target.channelMs - this.channel.hitSetbackMs);
      target.stallMs = this.channel.hitStallMs;
    }
    const stalled = Math.min(target.stallMs, deltaMs);
    target.stallMs -= stalled;
    const rate = channelAccrualRate(this.channel, contest(target.anchor.x, target.anchor.y, target.anchor.radius));
    target.channelMs += (deltaMs - stalled) * rate;
    if (target.channelMs >= need) this.complete(target);
  }

  private tickVaultPocket(vault: PoiRuntime, deltaMs: number): void {
    const batch = Math.round(VAULT_BATCH * TUNING.poi.vault.densityMul);
    if (vault.channelMs === 0 && !vault.spawned) {
      vault.spawned = true;
      this.vaultPulseMs = VAULT_PULSE_MS;
      this.spawnTrash(`vault:${vault.anchor.id}`, vault.anchor.x, vault.anchor.y, TUNING.poi.vault.radius, batch);
      return;
    }
    this.vaultPulseMs -= deltaMs;
    if (this.vaultPulseMs <= 0) {
      this.vaultPulseMs += VAULT_PULSE_MS;
      this.spawnTrash(`vault:${vault.anchor.id}`, vault.anchor.x, vault.anchor.y, TUNING.poi.vault.radius, Math.round(batch / 4));
    }
  }

  private spawnTrash(source: string, x: number, y: number, radius: number, count: number): string[] {
    const pool = enemiesForZone(this.map.zone).filter((d) => d.firstSeenS <= Math.max(30, this.elapsedS));
    const def = this.rng.pick(pool.length > 0 ? pool : enemiesForZone(this.map.zone));
    return this.cb.requestSpawn({ source, x, y, radius, entries: [{ defId: def.id, count, elite: null }] });
  }

  /** Reward + bookkeeping when a POI's interaction finishes. */
  private complete(p: PoiRuntime): void {
    p.done = true;
    p.channelMs = 0;
    this.channelPoi = null;
    this.counters.poisVisited += 1;
    const { x, y, kind } = p.anchor;
    this.queueXp(kind, x, y, p.anchor.depth);
    const depthBias = TUNING.mapgen.chestTierBiasByDepth[p.anchor.depth] ?? 0;
    switch (kind) {
      case 'chest_t1':
      case 'chest_t2':
      case 'chest_t3': {
        const row = kind === 'chest_t1' ? TUNING.poi.chest.t1 : kind === 'chest_t2' ? TUNING.poi.chest.t2 : TUNING.poi.chest.t3;
        let bias = row.tierBias + depthBias;
        if (this.mercyPending) {
          bias += TUNING.mercy.chestBias;
          this.mercyPending = false;
        }
        const count = kind === 'chest_t3' ? 2 : 1;
        const items: LootItem[] = [];
        for (let i = 0; i < count; i += 1) items.push(this.rollItem(bias, 0));
        const shards = this.rng.int(row.shards[0], row.shards[1]);
        this.counters.chestsOpened += 1;
        this.cb.onLoot(items, shards, x, y, kind);
        if (kind !== 'chest_t1' && this.rng.chance(TUNING.pickups.bread.chestChance)) this.pickupQueue.push({ id: 'pk_bread', x: x - 50, y: y + 50 });
        if (kind === 'chest_t3') {
          this.spawnTrash(`chest:${p.anchor.id}`, x, y, 260, TUNING.poi.chest.t3.guards);
        }
        break;
      }
      case 'vault': {
        const t4 = VALUABLES.filter((v) => v.tier === 4);
        const items: LootItem[] = [
          this.rollItem(3, TUNING.gear.uniqueChance),
          this.rollItem(3, TUNING.gear.uniqueChance),
          { kind: 'valuable', item: { uid: lootUid(this.rng, 'val'), id: this.rng.pick(t4).id } },
        ];
        this.counters.vaultOpened = true;
        this.counters.chestsOpened += 1;
        this.cb.onLoot(items, 0, x, y, 'vault');
        break;
      }
      case 'vein': {
        const [lo, hi] = TUNING.poi.vein.shards;
        const mul = this.loadout.veinMul > 0 ? this.loadout.veinMul : 1;
        this.counters.veinsMined += 1;
        this.cb.onVein(Math.round(this.rng.int(lo, hi) * mul));
        break;
      }
      case 'lore':
        this.counters.loreRead.push(p.tag);
        this.cb.onLore(p.tag);
        break;
      case 'bell': {
        this.bellsRung += 1;
        this.spawnTrash(`bell:${p.anchor.id}`, x, y, 360, TUNING.gates.bell.wave);
        this.cb.onBell(this.bellsRung);
        break;
      }
      case 'shrine_curse': {
        const c = TUNING.poi.shrines.curse;
        this.curseRolls += c.rolls;
        const pool = enemiesForZone(this.map.zone).filter((d) => d.firstSeenS <= Math.max(60, this.elapsedS));
        for (let i = 0; i < c.elites; i += 1) {
          const a = (i / c.elites) * Math.PI * 2 + this.rng.float(0, 0.5);
          this.cb.requestSpawn({
            source: `shrine:${p.anchor.id}`, x: x + Math.cos(a) * c.radius, y: y + Math.sin(a) * c.radius, radius: 40,
            entries: [{ defId: this.rng.pick(pool.length > 0 ? pool : enemiesForZone(this.map.zone)).id, count: 1, elite: this.rng.pick(ELITE_AFFIXES).id }],
          });
        }
        this.counters.shrinesUsed += 1;
        this.cb.onShrine(kind);
        break;
      }
      case 'shrine_blood':
      case 'shrine_gilt':
      case 'shrine_bone':
      case 'shrine_grave':
        this.counters.shrinesUsed += 1;
        this.cb.onShrine(kind);
        break;
      default:
        break;
    }
    this.applyLook(p);
  }

  private tickEvents(t: number, deltaMs: number, hero: { x: number; y: number }): void {
    for (const ev of this.events) {
      if (ev.phase === 'pending' && t >= ev.atS - EVENT_WARN_S) {
        ev.yard = this.pickYard(hero);
        ev.phase = ev.yard === null ? 'done' : 'warned';
      }
      if (ev.phase === 'warned' && t >= ev.atS) this.startEvent(ev);
      if (ev.phase === 'live') this.tickLiveEvent(ev, t, deltaMs, hero);
    }
  }

  private pickYard(hero: { x: number; y: number }): PoiAnchor | null {
    const used = new Set(this.events.map((e) => e.yard?.id));
    const yards = this.map.pois.filter((p) => p.kind === 'event_yard' && !used.has(p.id));
    if (yards.length === 0) return null;
    const far = yards.filter((y) => Math.hypot(y.x - hero.x, y.y - hero.y) >= EVENT_MIN_DIST);
    // Nearest of the far-enough yards keeps the detour honest; none far enough ⇒ the farthest.
    const pool = far.length > 0 ? far : yards;
    const score = (y: PoiAnchor): number => Math.hypot(y.x - hero.x, y.y - hero.y);
    return pool.reduce((a, b) => (far.length > 0 ? (score(b) < score(a) ? b : a) : score(b) > score(a) ? b : a));
  }

  private startEvent(ev: EventRuntime): void {
    const yard = ev.yard!;
    ev.phase = 'live';
    ev.startedS = this.elapsedS;
    const e = TUNING.poi.events;
    if (ev.kind === 'ev_caravan') {
      this.cb.requestSpawn({ source: `event:${ev.kind}`, x: yard.x, y: yard.y, radius: 160, entries: [{ defId: 'gildedghoul', count: e.caravan.ghouls, elite: null }] });
    } else if (ev.kind === 'ev_vigil') {
      ev.wavesSent = 1;
      this.spawnTrash(`event:${ev.kind}`, yard.x, yard.y, yard.radius, e.vigil.waveSize);
    } else {
      ev.wavesSent = 1;
      this.spawnTrash(`event:${ev.kind}`, yard.x, yard.y, e.rising.radius, RISING_BATCH);
    }
    this.cb.onEvent(ev.kind, 'start');
  }

  private finishEvent(ev: EventRuntime, ok: boolean): void {
    ev.phase = 'done';
    if (ok) {
      this.counters.eventsCompleted += 1;
      if (ev.yard !== null) this.queueXp('event_yard', ev.yard.x, ev.yard.y, ev.yard.depth);
    }
    this.cb.onEvent(ev.kind, ok ? 'success' : 'fail');
  }

  private queueXp(kind: PoiKind, x: number, y: number, depth: Depth): void {
    const xp = poiXpBurst(kind, depth, this.elapsedS);
    if (xp > 0) this.xpQueue.push({ x, y, xp });
  }

  private tickLiveEvent(ev: EventRuntime, t: number, deltaMs: number, hero: { x: number; y: number }): void {
    const yard = ev.yard!;
    const e = TUNING.poi.events;
    const since = t - ev.startedS;
    const inside = (r: number): boolean => Math.hypot(hero.x - yard.x, hero.y - yard.y) <= r;
    if (ev.kind === 'ev_caravan') {
      if (ev.kills >= e.caravan.ghouls) this.finishEvent(ev, true);
      else if (since >= e.caravan.durationS) this.finishEvent(ev, false);
      return;
    }
    if (ev.kind === 'ev_vigil') {
      const waveEvery = e.vigil.holdS / e.vigil.waves;
      if (ev.wavesSent < e.vigil.waves && since >= ev.wavesSent * waveEvery) {
        ev.wavesSent += 1;
        this.spawnTrash(`event:${ev.kind}`, yard.x, yard.y, yard.radius, e.vigil.waveSize);
      }
      if (inside(e.vigil.radius)) ev.progress += deltaMs / 1000;
      if (ev.progress >= e.vigil.holdS) {
        this.cb.onLoot([this.rollItem(2, 0)], 0, yard.x, yard.y, ev.kind);
        this.finishEvent(ev, true);
      } else if (since >= e.vigil.holdS * 2) {
        this.finishEvent(ev, false);
      }
      return;
    }
    // Grave Rising
    if (ev.windowStartS === null) {
      if (inside(e.rising.radius)) {
        ev.windowStartS = t;
        ev.kills = 0;
      } else if (since >= EVENT_ATTEND_S) this.finishEvent(ev, false);
      return;
    }
    const inWindow = t - ev.windowStartS;
    if (ev.kills >= e.rising.kills) {
      this.dropChest(yard.x, yard.y, 'elite');
      this.finishEvent(ev, true);
    } else if (inWindow >= e.rising.windowS) {
      this.finishEvent(ev, false);
    } else if (inWindow * 1000 >= ev.wavesSent * RISING_BATCH_MS) {
      ev.wavesSent += 1;
      this.spawnTrash(`event:${ev.kind}`, yard.x, yard.y, e.rising.radius, RISING_BATCH);
    }
  }

  private tickDropChests(hero: { x: number; y: number }): void {
    for (let i = this.chests.length - 1; i >= 0; i -= 1) {
      const c = this.chests[i]!;
      if (Math.hypot(hero.x - c.x, hero.y - c.y) > DROP_CHEST_PX) continue;
      this.chests.splice(i, 1);
      c.sprite?.destroy();
      this.counters.chestsOpened += 1;
      this.cb.onEliteChest(c.x, c.y, c.boss);
      const items: LootItem[] = [];
      if (c.boss) {
        for (let k = 0; k < TUNING.loot.bossItems; k += 1) items.push(this.rollItem(TUNING.loot.bossTierBias, TUNING.gear.uniqueChance));
      } else {
        items.push(this.rollItem(TUNING.loot.eliteTierBias, 0));
      }
      this.cb.onLoot(items, 0, c.x, c.y, c.boss ? 'boss-chest' : 'elite-chest');
    }
  }

  // ─── visuals ───

  private makeSprite(kind: PoiKind, x: number, y: number): Phaser.GameObjects.Image | null {
    if (kind === 'event_yard') return null;
    const def = poiDef(kind);
    const size = DISPLAY_PX[kind] ?? 140;
    const hasArt = def.art !== '' && this.scene.textures.exists(def.art);
    const img = this.scene.add.image(x, y, hasArt ? def.art : TEX.disc, 0).setDepth(POI_DEPTH).setDisplaySize(size, size);
    if (!hasArt) img.setTint(FALLBACK_TINT[kind] ?? 0xeae1bf).setDisplaySize(size * 0.5, size * 0.5);
    return img;
  }

  /**
   * Done look, re-applied whenever a streamed sprite is (re)created: chests /
   * vault / vein switch to their opened / depleted frame (fallback dims),
   * shrines and lore stones dim, a cleared lair's banner fades.
   */
  private applyLook(p: PoiRuntime): void {
    const s = p.sprite;
    if (s === null || !p.done) return;
    const kind = p.anchor.kind;
    const openFrame = OPENED_FRAME[kind];
    if (openFrame !== undefined) {
      const def = poiDef(kind);
      if (def.art !== '' && this.scene.textures.exists(def.art)) s.setFrame(openFrame);
      else s.setAlpha(0.4);
      return;
    }
    s.setAlpha(kind === 'lair' ? 0.35 : kind === 'lore' ? 0.5 : 0.45);
  }

  private chunkKey(x: number, y: number): number {
    const col = Math.min(this.chunkCols - 1, Math.max(0, Math.floor(x / CHUNK_PX)));
    const row = Math.max(0, Math.floor(y / CHUNK_PX));
    return row * this.chunkCols + col;
  }

  /**
   * Records in every chunk that intersects the square of half-side `r` around
   * (x, y) — a broad phase; callers still test exact distance. Returns a shared
   * scratch array valid until the next call.
   */
  private near(x: number, y: number, r: number): PoiRuntime[] {
    const out = this.nearScratch;
    out.length = 0;
    const c0 = Math.max(0, Math.floor((x - r) / CHUNK_PX));
    const c1 = Math.min(this.chunkCols - 1, Math.floor((x + r) / CHUNK_PX));
    const r0 = Math.max(0, Math.floor((y - r) / CHUNK_PX));
    const r1 = Math.floor((y + r) / CHUNK_PX);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const bucket = this.chunks.get(row * this.chunkCols + col);
        if (bucket !== undefined) for (const p of bucket) out.push(p);
      }
    }
    return out;
  }

  /** Sprite streaming: create within SPRITE_IN_PX, destroy beyond SPRITE_OUT_PX (or when no longer shown). */
  private streamSprites(hero: { x: number; y: number }): void {
    for (const p of this.liveSprites) {
      if (Math.hypot(p.anchor.x - hero.x, p.anchor.y - hero.y) > SPRITE_OUT_PX || !this.showsSprite(p)) this.dropSprite(p);
    }
    for (const p of this.near(hero.x, hero.y, SPRITE_IN_PX)) {
      if (p.sprite !== null || !this.showsSprite(p)) continue;
      if (Math.hypot(p.anchor.x - hero.x, p.anchor.y - hero.y) > SPRITE_IN_PX) continue;
      p.sprite = this.makeSprite(p.anchor.kind, p.anchor.x, p.anchor.y);
      if (p.sprite === null) continue;
      this.liveSprites.add(p);
      this.applyLook(p);
    }
  }

  /** The Fence cart only exists inside its window; everything else always has a marker. */
  private showsSprite(p: PoiRuntime): boolean {
    return p.anchor.kind === 'fence' ? !p.done && this.visibleNow(p) : true;
  }

  private dropSprite(p: PoiRuntime): void {
    p.sprite?.destroy();
    p.sprite = null;
    this.liveSprites.delete(p);
  }
}
