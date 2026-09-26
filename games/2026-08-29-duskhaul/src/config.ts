import type Phaser from 'phaser';
import type { PlayerStatKey } from './data/types-v2';
/**
 * Single source of truth for presentation + balance.
 *
 * AGENT RULE: every tunable number that the PRD talks about (speeds, spawn
 * rates, costs, thresholds) lives in `TUNING`. Never hardcode balance values
 * inside scenes or entities — that is what makes a game impossible to iterate on.
 */

/** Internal render resolution. Portrait 9:16 — matches TikTok/Reels/Shorts. */
export const VIEW = {
  width: 720,
  height: 1280,
  centerX: 360,
  centerY: 640,
} as const;

/** Safe area to keep UI clear of platform overlays when recording vertical video. */
export const SAFE = {
  top: 140,
  bottom: 220,
  side: 40,
} as const;

/**
 * Palette — AUTHORED (PRD §11), sampled from the locked vision anchors
 * (`art/refs/vision-1.png`, `art/refs/vision-2.png`). This is an
 * art-director contract: code implements it verbatim and never invents a
 * tone. Every ink/text role is measured against `bgTop` with WCAG relative
 * luminance (>=4.5:1 text, >=3:1 graphical).
 *
 * Two measured text restrictions: `secondary` (3.54:1) and `bad` (3.52:1)
 * FAIL against `bgBottom` and against lit backdrop art. They may render as
 * TEXT only on `bgTop`, on the panel fill, or over a scrim band — otherwise
 * they appear as a FILL carrying a deep-ink `#03040b` label. See
 * `ui/duskChrome.ts`, which owns the §14.4 chrome side of this contract.
 *
 * Gameplay identity colours (relic tiers, gate violet, threat glow) are
 * ART-LOCKED LITERALS, not palette roles: they live in `ui/duskChrome.ts`
 * and must never be palette-swapped.
 */
export const PALETTE = {
  bgDeep: 0x03060f,
  bgTop: 0x141b2e,
  bgBottom: 0x2c3848,
  ink: 0xeae1bf,
  inkSoft: 0xa5a38b,
  primary: 0x9bdf9f,
  secondary: 0xad6eef,
  accent: 0xf3ca67,
  good: 0x9bdf9f,
  bad: 0xff4739,
  /** Timers, closing-gate chips, the COLLAPSE label (§11: torch flame core). */
  warn: 0xf7a446,
} as const;

export const CSS = {
  ink: '#eae1bf',
  inkSoft: '#a5a38b',
  primary: '#9bdf9f',
  secondary: '#ad6eef',
  accent: '#f3ca67',
  good: '#9bdf9f',
  bad: '#ff4739',
  warn: '#f7a446',
} as const;

/** Font stack — no webfont download, no FOUT, works offline. */
export const FONT = {
  family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: '"Arial Black", system-ui, sans-serif',
} as const;

/**
 * Text armour (§14.4). The game ships generated backdrops, two of whose four
 * zones are LIGHT-value sets (bone-white sand, snowfields), so unarmoured
 * type over the arena is unreadable. Stroke colour is `#03040b`, the darkest
 * tone in the anchors (the gate-arch interior shadow); thickness is
 * `round(fontSize / 12)` clamped to 2-6px, plus a soft `#03040b` shadow at
 * alpha 0.70, offset (0, 3), blur 6.
 *
 * ARMOUR-STRIP RULE: a label sitting on its own pill, panel or disc strips
 * the armour ENTIRELY — the panel already supplies a measured >=4.5:1
 * backing, and doubled armour at 24-32px turns chunky pixel type to mush.
 * Use `bareText()` for those; armour is for floaters, banners, HUD numerals,
 * world-space labels and anything drawn straight over the arena.
 */
const ARMOUR_INK = '#03040b';

function armour(fontSize: number): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    stroke: ARMOUR_INK,
    strokeThickness: Math.min(6, Math.max(2, Math.round(fontSize / 12))),
    shadow: { offsetX: 0, offsetY: 3, color: ARMOUR_INK, blur: 6, stroke: true, fill: true },
  };
}

/**
 * Strips the armour off a preset for a label that sits on its own pill,
 * panel or disc (§14.4). Spread it LAST: `{ ...TEXT.button, ...bareText() }`.
 */
export function bareText(): Phaser.Types.GameObjects.Text.TextStyle {
  return { stroke: undefined, strokeThickness: 0, shadow: undefined };
}

/** Text presets so every scene has consistent typography. */
export const TEXT = {
  title: { fontFamily: FONT.display, fontSize: '96px', color: CSS.ink, ...armour(96) },
  heading: { fontFamily: FONT.display, fontSize: '56px', color: CSS.ink, ...armour(56) },
  score: { fontFamily: FONT.display, fontSize: '72px', color: CSS.ink, ...armour(72) },
  body: { fontFamily: FONT.family, fontSize: '32px', color: CSS.inkSoft, ...armour(32) },
  label: { fontFamily: FONT.family, fontSize: '26px', color: CSS.inkSoft, ...armour(26) },
  button: { fontFamily: FONT.display, fontSize: '40px', color: CSS.ink, ...armour(40) },
} as const satisfies Record<string, Phaser.Types.GameObjects.Text.TextStyle>;

/**
 * ---------------------------------------------------------------------------
 * BALANCE — replace wholesale per game, keep the shape.
 * Every number the design talks about lives here; scenes and entities read it.
 * Values below drive the demo survivor-like slice (480s run).
 * ---------------------------------------------------------------------------
 */
export const TUNING = {
  /**
   * NO `graceSeconds` KEY. The template's enemy-free opening window is not how
   * Duskhaul opens: §5.4's first wave row starts at 0s and drips one husk every
   * 1800ms for 30s (`WAVE_LABEL.grace`), because 4 seconds of empty screen was
   * measured as an empty screen, not as grace. The grace window is authored in
   * `data/waves.ts` and nowhere else.
   */

  player: {
    maxHp: 110,
    moveSpeed: 360,
    /** Drag-follow easing: fraction of the remaining distance per 16ms. */
    followLerp: 0.22,
    size: 162,
    /** Law (PRD-V2 §5.4): on-screen hero height in px; `size` is the sheet cell that yields it. */
    visiblePx: 112,
    /** Hero collision radius; contact reach = enemy bodyRadius + this (scene AND sim). */
    bodyRadius: 34,
    /** Auto-attack range in px. Keep under ~45% of VIEW.width so kills happen on-screen. */
    range: 380,
    projectileSpeed: 700,
    projectileSize: 18,
    critChance: 0.05,
    critMul: 2,
    /** User playtest (2026-09-25, "too easy"): 0.8 → 0.6. */
    regenPerSecond: 0.6,
    pickupRadius: 170,
    invulnMs: 700,
    /** Impulse (px/s) applied to an enemy on contact with the player; `bulwark` doubles it. */
    contactKnockback: 70,
  },

  /**
   * Weapon patterns (PRD-V2 §5.8, `systems/weapons.ts`). V1 readers still use
   * `damageMul` (fraction of `player.damage`) and the boost riders; the V2
   * absolute `baseDamage` / geometry / `evolved` blocks are for WS-Arsenal.
   * PER-RANK GROWTH IS NOT HERE: it lives on the weapon row (`data/weapons.ts`
   * `rankGrowth`, read through `weaponBoostDamageMul`).
   */
  weapons: {
    /** Max simultaneously-equipped weapons (PRD-V2 §5.8, §18a: 3 → 4). */
    maxSlots: 4,
    /** Boost cards per weapon: rank = boosts + 1, so 3 is max rank 4 (law). */
    maxBoosts: 3,
    bolt: {
      /** ×1.5 (fix round 1, critic F1): the four class starters were killing 0.3-1.3/s live. */
      baseDamage: 12,
      cooldownMs: 900,
      speed: 700,
      size: 22,
      boostCooldownMul: 0.07,
      evolved: { projectiles: 3, pierce: 3, damage: 20 },
    },
    orbit: {
      /** V1: fraction of the `damage` stat one blade hit deals. */
      damageMul: 0.6,
      baseDamage: 9,
      hitCooldownMs: 380,
      radius: 190,
      blades: 1,
      boostRadiusMul: 0.12,
      evolved: { radius: 380, blades: 4, damage: 10 },
    },
    nova: {
      damageMul: 1.6,
      baseDamage: 15,
      cooldownMs: 1600,
      radius: 320,
      /** Fraction of radius at which falloff starts reducing damage toward 0 at the edge. */
      falloffStart: 0.4,
      boostCooldownMul: 0.1,
      evolved: { burnMs: 3000, burnDps: 8, burnRadius: 320 },
    },
    scythe: {
      baseDamage: 14,
      cooldownMs: 1200,
      arcDeg: 140,
      radius: 180,
      evolved: { arcDeg: 360, damageMul: 1.5 },
    },
    rail: {
      damageMul: 1.9,
      baseDamage: 36,
      cooldownMs: 2200,
      pierceCount: 4,
      boostPierceAdd: 1,
      length: 640,
      evolved: { damage: 60, critChanceAdd: 0.3 },
    },
    hex: {
      baseDamage: 9,
      cooldownMs: 1400,
      jumps: 4,
      jumpPx: 220,
      evolved: { jumps: 6, dotMs: 3000, dotDps: 6 },
    },
    skull: {
      baseDamage: 12,
      cooldownMs: 1500,
      speed: 420,
      turnRadPerS: 4,
      skulls: 1,
      evolved: { skulls: 4, explodeRadius: 90, explodeDamageMul: 0.5 },
    },
    censer: {
      dps: 6,
      cooldownMs: 2400,
      poolRadius: 110,
      poolMs: 3000,
      targetRange: 420,
      pools: 1,
      evolved: { poolRadius: 150, poolMs: 5000, slowPct: 30 },
    },
    sickle: {
      baseDamage: 16,
      cooldownMs: 1800,
      outPx: 420,
      sickles: 1,
      evolved: { sickles: 3, damage: 26 },
    },
    lash: {
      baseDamage: 15,
      cooldownMs: 1300,
      width: 360,
      height: 90,
      evolved: { damage: 30, bleedDps: 2, bleedMs: 3000 },
    },
    breath: {
      tickDamage: 5,
      tickMs: 200,
      cooldownMs: 2000,
      coneDeg: 60,
      length: 260,
      durationMs: 1000,
      evolved: { coneDeg: 90, length: 360, durationMs: 2000, igniteDps: 4, cooldownMs: 1600 },
    },
    spears: {
      baseDamage: 22,
      cooldownMs: 2000,
      spikes: 3,
      radius: 60,
      range: 380,
      telegraphMs: 350,
      evolved: { spikes: 8, rootMs: 1000 },
    },
    /** PRD-V2 §5.8b.1 Arsenal 20 — rank-1 + evolved numbers, transcribed verbatim. */
    aura: {
      radius: 110, tickDamage: 6, tickMs: 500, knockback: 40,
      evolved: { radius: 200, tickDamage: 10, tickMs: 350, slowPct: 25, healPerKill: 1, healCapPerS: 5 },
    },
    chakram: {
      baseDamage: 13, cooldownMs: 1400, speed: 520, size: 40, bounces: 3, bounceRange: 260, discs: 1,
      evolved: { discs: 3, bounces: 7, damage: 20 },
    },
    wake: {
      stepPx: 60, minSpeed: 60, radius: 45, lifeMs: 2000, tickDamage: 8, tickMs: 400,
      evolved: { radius: 80, lifeMs: 4000, tickDamage: 14, slowPct: 30 },
    },
    snares: {
      cooldownMs: 1600, armMs: 400, triggerRadius: 70, blastRadius: 120, baseDamage: 30, maxLive: 4,
      evolved: { maxLive: 10, damage: 45, chainRadius: 220, rootMs: 800 },
    },
    siphon: {
      tickDamage: 4, tickMs: 200, range: 320, healPct: 0.03, tethers: 1,
      evolved: { tethers: 3, tickDamage: 7, healPct: 0.06, healCapPerS: 6 },
    },
    bombs: {
      cooldownMs: 2000, range: 420, hopPx: 140, bounces: 3, blastRadius: 90, baseDamage: 14, urns: 1,
      evolved: { urns: 3, bounces: 5, shardDamage: 8, shardRange: 300, shardsPerBounce: 2 },
    },
    totem: {
      cooldownMs: 7000, lifeMs: 6000, pulseRadius: 200, pulseMs: 800, baseDamage: 10, maxLive: 1,
      evolved: { maxLive: 2, pulseRadius: 300, pulseMs: 600, damage: 16, pullPxPerS: 40 },
    },
    thralls: {
      cooldownMs: 12000, maxAlive: 1, hp: 40, speed: 300, bite: 10, biteMs: 700, lifeMs: 12000, bodyRadius: 26,
      evolved: { maxAlive: 4, bite: 16, burstRadius: 90, burstDamage: 30, respawnMs: 4000 },
    },
  },

  /** Charms (PRD-V2 §5.9). */
  charms: {
    maxSlots: 4,
    maxRank: 5,
    /** c_step Gloam Step: auto-dash on contact with cd ready; cd per rank 1-5. */
    gloamStep: { dashPx: 180, iframesMs: 300, cdMs: [6000, 5000, 4200, 3600, 3000] },
  },

  /** Evolution delivery (PRD-V2 §5.8): no chest within this long of eligibility ⇒ the card enters the draft. */
  evolution: {
    fallbackS: 60,
  },

  /**
   * XP curve (PRD-V2 §6.1): needed(L) = base + linear·(L−1) + (L > kneeLevel ? kneeStep·(L − kneeLevel) : 0).
   */
  xp: {
    /** Restored to the §6.1 spec (fix round 2, critic B1: 12/20/30 starved drafts to 3-10 per run live). */
    base: 10,
    linear: 8,
    kneeLevel: 20,
    kneeStep: 12,
    /** Early orb vacuum (critic minor: orphaned orbs): +radiusAdd pickup radius until `untilLevel`. */
    earlyVacuum: { untilLevel: 6, radiusAdd: 130 },
    /** Orb magnetism speed once inside pickupRadius. */
    orbSpeed: 560,
    /** Speed multiplier while the orb is still outside pickupRadius. */
    driftFactor: 0.22,
  },

  enemy: {
    /**
     * Trash HP multiplier (Balance, 2026-09-25): with 4 weapons + charms the
     * spec HP let the build clear every spawn on arrival (live@240 s ≈ 25 vs
     * band 100-150). Ramps linearly from ×1 at `hpMulRampS[0]` to ×hpMul at
     * `hpMulRampS[1]` so Grace/Early keep the §2.1 clear rate. Read by
     * `scaleEnemy` for trash rows only. Fix round 2 (critic B1): 3 → 1.5 —
     * with the §6.1 XP curve restored, ×3 trash left the live starter at LV 3-4
     * for a minute at a time.
     */
    /** User playtest ("too easy"): 1.5 → 2.0 (ramp unchanged). */
    hpMul: 2,
    hpMulRampS: [60, 240] as readonly [number, number],
    /**
     * Trash damage multiplier, trash rows only. Iteration 4: 0.75. Fix round 2
     * (live honest bot, 2026-09-25): 0.6 — the Gate B bot lost 106 hp in 20 s
     * at 112-132 s to 7-9-damage contact from 9-20 bodies within 200 px while
     * density sat ON target, so the per-hit number, not the count, was the killer.
     */
    /** User playtest ("too easy"): 0.6 → 0.8. */
    dmgMul: 0.8,
    /** Spawn ring radius beyond the screen edge. */
    spawnMargin: 140,
    /** Contact damage tick interval. */
    hitMs: 500,
    /**
     * NO `hpScaleCap`. The template caps difficulty-driven HP; §6 does not —
     * "HP scales LINEARLY with the multiplier, DAMAGE at half rate" is the
     * authored curve, and `data/enemies.ts scaleEnemy` implements exactly that.
     * The template's 3.2 cap was read by nothing, and wiring it would have
     * silently overridden §6 for every zone with `threatBase > 1` and for the
     * whole Collapse ramp.
     */
    /** Hard cap on live enemies — protects 60fps. */
    maxAlive: 250,
    /** bodyRadius = round(ratio × visiblePx) (PRD-V2 §5.4). */
    bodyRadiusRatio: 0.36,
    /** Enemies farther than `leashPx` from the hero for `leashMs` are recycled near the hero. */
    leashPx: 1800,
    leashMs: 4000,
    /** `healAura` enemies pulse a heal to allies within this radius, this often, for this much HP. */
    healAuraRadius: 220,
    healAuraIntervalMs: 2000,
    /** `charge` enemies flash + telegraph a thin line before dashing. */
    chargeTelegraphMs: 400,
  },

  boss: {
    /** Zone boss hp multiplier over the phase grunt (PRD-V2 §5.6). */
    /** User playtest: +20% (70 → 84). */
    hpMul: 84,
    visiblePx: 260,
    contactDamage: 22,
    /** Phase 2 shield damage reduction while adds live. */
    shieldDamageMul: 0.35,
    /** Phase 3 enrage speed. */
    enrageSpeedMul: 1.4,
    /** Per-zone attack numbers (PRD-V2 §5.6 table), read by `objects/enemy.ts` boss patterns. */
    castle: {
      toll: { rings: 3, fromRadius: 120, toRadius: 520, speed: 220, damage: 18, telegraphMs: 700, cdMs: 3500, phase3CdMs: 2500 },
      chainSweep: { arcDeg: 160, radius: 260, damage: 26, windupMs: 900 },
      summon: { id: 'husk', count: 6, cdMs: 12000 },
      bellDrop: { count: 4, radius: 110, telegraphMs: 1000, damage: 30 },
      bulletRing: { shots: 14, cdMs: 3000, telegraphMs: 500 },
    },
    outlands: {
      geyser: { count: 5, radius: 90, damage: 24, windupMs: 800, staggerMs: 120, phase3CdMs: 4000 },
      gust: { pushPxPerS: 140, durationMs: 1500, warnMs: 600 },
      summon: { id: 'kite', count: 8, cdMs: 14000 },
      boneRain: { count: 12, radius: 70, areaRadius: 500, telegraphMs: 900, damage: 20 },
      spiral: { arms: 3, shotsPerArm: 6, shotEveryMs: 400, durationMs: 3000, cdMs: 6000 },
    },
    desert: {
      burrowCharge: { sinkMs: 600, telegraphMs: 1200, radius: 140, damage: 32, phase3CdMs: 4000 },
      sandWall: { pillars: 6, bodyRadius: 50, durationMs: 5000 },
      summon: { id: 'leech', count: 4 },
      scorchBeam: { length: 400, sweepDegPerS: 180, durationMs: 3000, telegraphMs: 800, damage: 12, tickMs: 200 },
      sinkholes: { count: 3, radius: 160, slowPct: 50, durationMs: 8000 },
    },
    winter: {
      iceLance: { count: 5, spreadDeg: 30, telegraphMs: 900, damage: 20 },
      frostNova: { radius: 300, windupMs: 1000, slowPct: 80, slowMs: 1000, phase3CdMs: 5000 },
      summon: { id: 'widow', count: 2 },
      glacier: { walls: 3, durationMs: 6000 },
      blizzard: { count: 20, radius: 60, durationMs: 4000, telegraphMs: 700 },
    },
  },

  /** Den mid-bosses (PRD-V2 §5.6). */
  midboss: {
    /** User playtest: +20% (30 → 36). */
    hpMul: 36,
    visiblePx: 200,
    /** Bone wall lock on entering the den. */
    lockS: 20,
    opensS: 240,
  },

  /**
   * Elites: the scheduled spikes, the Gate B guard pack, and their coin drop.
   * `atS` are the three scripted elite entrances (PRD §5.4); `gateGuard*`
   * is the pack that contests Gate B shortly after it opens, which is what
   * prices the mid gate above the free early one.
   */
  elite: {
    /** Promotion (PRD-V2 §5.5): hp ×8, visiblePx ×1.6 capped at 170, dmg ×1.5. */
    /** User playtest: +20% (8 → 9.6). */
    hpMul: 9.6,
    sizeMul: 1.6,
    sizeCap: 170,
    dmgMul: 1.5,
    /** Elite kill payout (was `economy.currencyPerElite`). */
    shards: 25,
    /** Affix numbers (PRD-V2 §5.5), read by `objects/enemy.ts`. */
    affixes: {
      vampiric: { healPct: 0.2, capPctMaxHpPerS: 0.05 },
      hasted: { moveMul: 1.4, attackCdMul: 0.7 },
      shielded: { frontalDamageMul: 0.3 },
      splitter: { minions: 4 },
      frenzied: { belowHpRatio: 0.5, speedMul: 1.5, damageMul: 1.3 },
      warded: { immuneMs: 1000, everyMs: 4000 },
      plagued: { radius: 90, dps: 3, durationMs: 4000, everyMs: 1500 },
      magnetic: { pullPxPerS: 60, radius: 250 },
    },
    coinDropMin: 3,
    coinDropMax: 5,
    atS: [150, 270, 390],
    /**
     * Gate B guard (critic C1): spawns AT gate open, parked `gateGuardParkPx`
     * beyond the gate apron (`mapgen.gateClear`) on the hero's side, so the
     * fight happens before the player commits to the channel. Never inside
     * `extract.suppressRadius` of the open gate.
     */
    gateGuardAtS: 190,
    gateGuardGate: 'b',
    /** Distance past the apron edge the pack is parked at: [min, max]. */
    gateGuardParkPx: [350, 450],
    /** Pack spread around its park point. */
    gateGuardRadiusPx: 160,
    gateGuardAdds: 8,
    /** Max damage per hit from the guard elite and its adds at H1; scaled by the hazard's threatMul. */
    gateGuardDmgCap: 12,
    /** The park point is never closer than this to the hero at spawn (QA v2c NEW-1). */
    gateGuardHeroClearPx: 600,
    /** The amber ground telegraph under the parked pack lasts this long; the pack is dormant until it ends. */
    gateGuardTelegraphMs: 2500,
  },

  /** Legendary `effect` cards (PRD §5.3). `lastGasp` is the only live effect id. */
  effects: {
    /**
     * Last Gasp (PRD §5.3): revive once per run at this fraction of maxHp with
     * `iframesMs` of grace. The grace matters — without it the blow that killed
     * you re-kills you on the next tick and the card reads as broken.
     * The charge is held in ONE place (`CombatSystem.consumeLastGasp`) because
     * damage reaches the player by two routes: `Health.apply`, and the hazard /
     * Collapse drains that write `health.hp` directly to bypass i-frames. A
     * revive wired only into the first would fail on exactly the deaths the
     * Collapse exists to cause.
     */
    lastGasp: { reviveHpRatio: 0.3, iframesMs: 2000 },
  },

  economy: {
    /** Zone-boss kill payout (PRD-V2 §5.6). */
    currencyPerBoss: 120,
    /**
     * Economy retune (user: "maxed Sanctum very fast"): a kill pays its shard
     * value only with this seeded chance, stepping down over the run so deep
     * runs stop scaling ◆ with density (flattens the Gate C / Gate A premium).
     * `[fromS, chance]` rows, last row whose `fromS ≤ elapsed` wins.
     * Readers: `systems/combat.ts` KillReport.shards, `sim/families/arena.ts`.
     */
    killShardChanceByS: [[0, 0.5], [240, 0.3], [360, 0.08]],
    /** Valuable sell price multiplier (Vault SELL, `core/progression.ts sellValue`). */
    sellMul: 0.5,
  },

  /**
   * Bounded play field (see `systems/arena.ts`). Several screens wide, camera
   * follows the player inside it — a known field beats an endless plain: the
   * player can read where pressure comes from and the run has a shape.
   */
  arena: {
    /**
     * 24576² (user request, 16× the PRD-V2 §3.1 6144² in area): a run cannot
     * explore it all. Gate positions come from mapgen.
     */
    width: 24576,
    height: 24576,
    /** Floor tile size in px (§3.7 Tilemap, 96×96 tiles). */
    tileSize: 256,
    wallThickness: 26,
    /** Camera follow smoothing (0..1 per frame). */
    cameraLerp: 0.12,
    /** View bias: positive pushes the player below the HUD band. */
    cameraOffsetY: 90,
  },

  /** World generation (PRD-V2 §3.2, `systems/mapgen.ts`). Densities are per px². */
  mapgen: {
    /** 6×6 regions of ~4096 px (36 landmarks). */
    regionGrid: 6,
    regionJitter: 800,
    lloydIters: 2,
    maskCell: 32,
    navCell: 64,
    roadWidth: 360,
    extraEdgeRatio: 0.2,
    /** Min gap between two major POIs (den/vault/lair/event yard/fence/gilt chest). */
    poiMinSpacing: 2000,
    /** Min gap between any two POI anchors (every kind). */
    poiMinorSpacing: 1100,
    clusterMinSpacing: 420,
    /**
     * Blocking coverage of walkable area, re-derived for SINGLE placement
     * (user request: no heaps). Lone blockers keep a full 300 px corridor
     * and never overlap, so the floor saturates near 6.5% before narrow
     * floor (< 360 px passages) would pass the 0.15 band.
     */
    coverageTarget: 0.065,
    coverageMin: 0.055,
    coverageMax: 0.085,
    minCorridor: 240,
    narrowShareMax: 0.15,
    pathFactorMax: 1.35,
    plazaDiameter: 800,
    borderBand: 192,
    spawnClear: 600,
    gateClear: 400,
    maxBodyRadius: 190,
    maxRepairs: 8,
    maxReseeds: 3,
    /** Floor debris: ~1 per 270k px² (~3 per screen), composed along roads and at the foot of masses. */
    decalPerPx2: 1 / 270000,
    /** Decals keep this far apart (no overlaps); the same decal id keeps `decalSameIdPx`. */
    decalSpacing: 260,
    decalSameIdPx: 900,
    /** ≤ 1 splat per ~2 screens (2 × 720×1280). */
    splatPerPx2: 1 / 1840000,
    lightPoolPerPx2: 1 / 350000,
    breakablePerPx2: 1 / 120000,
    /** Threat multiplier by region depth 0/1/2 (§3.3). */
    depthMul: [1.0, 1.1, 1.3],
    chestTierBiasByDepth: [0, 1, 2],
    /**
     * Path distance bands from spawn (§3.6, 24576² map). Gate C is pulled
     * in to 6,000-7,500 px (critic v2d M1: 8+ km was out of honest reach) and
     * always sits ≥ `cBeyondB` farther along its path than Gate B.
     */
    gateDist: {
      a: [2800, 4400],
      b: [4800, 6800],
      c: [6000, 7500],
      cBeyondB: 800,
      xMin: 3200,
      separation: 3000,
    },
    /**
     * POI anchors per 24576² map, per kind (user request: ~1 POI per 3
     * screens, not 1 per screen). Lairs split 1/4 depth 1, 3/4 depth 2;
     * rusted chests 1/4 in depth 0-1, 3/4 in depth 2.
     * Bells (2) exist only with a Bell Gate and are not listed. Veins may
     * come up short when the floor runs out; every other kind is exact.
     */
    poiCounts: {
      den: 2, vault: 2, lair: 12, fence: 4, event_yard: 4,
      chest_t1: 34, chest_t2: 16, chest_t3: 10,
      shrine_blood: 3, shrine_bone: 3, shrine_curse: 3, shrine_grave: 4, shrine_gilt: 3,
      lore: 12, vein: 30,
    },
  },

  /** Big-map navigation (PRD-V2 §3.9), read by `systems/combat.ts`. */
  nav: {
    rebuildMs: 250,
    windowCells: 40,
    separation: 0.6,
    separationNeighbours: 6,
  },

  /**
   * On-screen thumb stick (see `ui/joystick.ts`). Floating: the base jumps to
   * the touch point inside the control zone, and rests at the home position.
   */
  joystick: {
    radius: 108,
    knobRadius: 46,
    /** Movement stays at zero inside this radius, in px. */
    deadzone: 18,
    /** Idle home position: x from the left, y measured up from the bottom. */
    homeX: 170,
    homeBottom: 200,
    /** Presses above this fraction of the screen height are not stick input. */
    /**
     * NO `idleAlpha`/`activeAlpha`. §14.3 authors the stick's visibility —
     * INVISIBLE at rest ("no persistent chrome") and 0.35 while a touch is
     * live — and `ui/joystick.ts` states that it deliberately does not read
     * these. Two numbers nobody read, contradicting the spec that overrode
     * them, is a retune that silently does nothing.
     */
  },

  /** Upgrade draft (PRD-V2 §5.10): cards per hand and per-run reroll / banish charges. */
  draft: {
    choices: 3,
    rerollsPerRun: 2,
    banishPerRun: 0,
  },

  /**
   * Extraction gates (PRD §7 `gate.*`): open/close windows in run seconds
   * plus the channel-ring radius. Gate C never closes (`closeS: null`) — the
   * Collapse is its closing mechanism.
   */
  gate: {
    a: { openS: 90, closeS: 180 },
    b: { openS: 190, closeS: 320 },
    c: { openS: 420, closeS: null },
    radius: 150,
    /** A gate reads/renders as 'closing' inside this many seconds of its close. */
    closingWarnS: 25,
    /**
     * The compass previews a gate this far ahead of its open time. Raised from
     * 30 to 60 to kill the measured two-minute cold open: the extraction clock
     * has to be legible BEFORE it matters (PRD §7, §18.28).
     */
    previewS: 60,
  },

  /** Conditional extracts (PRD-V2 §5.25); one per run, kind weighted. */
  gates: {
    toll: { opensS: 90, closesS: 480, pct: 0.25, min: 40 },
    offering: { opensS: 180 },
    bell: { bells: 2, openS: 60, standMs: 2000, wave: 12 },
    conditionalWeights: { toll: 40, offering: 30, bell: 30 },
  },

  /**
   * Hold-to-extract channel (PRD §7 `extract.*`). A hit NO LONGER resets the
   * channel — the measured old rule capped progress at 17.5% under any contact
   * (invulnMs 700 / channelMs 4000), making Gates B and C unusable by exactly
   * the greedy player they exist for. Instead a hit costs a flat setback plus a
   * stall, and the accrual rate drops while the ring is contested.
   *
   * INVARIANT, do not break it when retuning:
   *   (player.invulnMs - extract.hitStallMs) * extract.minRate > extract.hitSetbackMs
   * At 700ms i-frames: 500 * 0.55 = 275 > 200, so progress is strictly
   * monotone-positive under ANY contact. It FAILS at invulnMs 400 (110 < 200) —
   * 700 is authoritative (PRD §7); §5.1's 400 is stale.
   */
  extract: {
    channelMs: 4000,
    /** Flat rollback of accrued channel time per hit, clamped at 0. Never a %. */
    hitSetbackMs: 200,
    /** Accrual is frozen this long after a hit. */
    hitStallMs: 200,
    /** Accrual rate while >= 1 enemy is inside `gate.radius`. */
    contestedRate: 0.7,
    /** Subtracted from the rate per elite/boss in the ring. */
    eliteContestPenalty: 0.1,
    /** Hard floor on the accrual rate — the invariant above is computed on it. */
    minRate: 0.55,
    /**
     * No NEW spawn this close to a gate in state `open` or `closing`, so
     * "clear the ring, then hold" is the intended pattern. `closed`/`spent` do
     * not suppress, or the ring would refill during the commit window.
     */
    suppressRadius: 600,
    /** Headless fallback: with no in-ring count, contest is inferred from a hit inside this window. */
    contestedInferMs: 1000,
    /** Added to channelMs in one place (Gravekey sets -800). */
    channelMsDelta: 0,
    /** Effective channel = max(floor, channelMs + delta). */
    channelMsFloor: 1200,
  },

  /**
   * The Collapse (PRD §7 `collapse.*`): the post-480s anti-idle ending.
   *
   * The ring is centred on GATE C and its start radius is derived from the
   * player, never a corner span — the measured old rule started at 2340px and
   * never touched the player in 29s of overtime. It stops and HOLDS at
   * `minRadius` (> `gate.radius`) so Gate C stays standable and extraction
   * stays possible to the last frame.
   *
   * Escalation is deliberately NOT spawn volume: `enemy.maxAlive` is already
   * saturated from ~t=283s, so more spawns are invisible. The three ramps are
   * ring speed, fire damage, and elite injection against a STOPPED trash drip —
   * live count falls as the player clears while elite share rises.
   */
  collapse: {
    atS: 480,
    /** Ring is centred on this gate. */
    centerGate: 'c',
    /** start = clamp(dist(player, gateC) + startPad, minStart, maxStart) at ignition. */
    startPad: 240,
    /** ×2 with the 24576² map (gate C sits 8,000-10,400 px from spawn). */
    minStart: 2000,
    maxStart: 4800,
    /** Ring stops here — Gate C (r=150) must stay standable. */
    minRadius: 170,
    /** Initial shrink rate toward Gate C. */
    ringSpeedPxPerS: 22,
    /** Shrink-rate ramp (escalation 1 of 3). */
    ringAccel: 10,
    /** Cap on the instantaneous shrink rate. */
    ringSpeedMax: 220,
    /** Standing in the fire drains this many hp/s, bypassing i-frames. */
    fireDps: 10,
    /** Fire damage ramp (escalation 2 of 3). */
    fireDpsStep: 4,
    fireDpsMax: 60,
    /**
     * ONE PULSE, EVERY THREE SECONDS. `eliteEveryS` was 6 and `stepEveryS` was
     * 10, and the first run that ever reached the Collapse showed why that is
     * wrong: it resolved in 5.2 seconds — camp outside the ring, ignition, step
     * in, 4s channel, gone — and in those 5.2 seconds NONE of the three
     * escalations the ending is built on had fired. Ring 833 -> 708px was the
     * only thing that moved; the fire was still at its opening 10 dps and not
     * one elite had been injected. A ramp whose first step lands after the
     * window it is ramping inside of is a ramp nobody plays.
     *
     * The window is not negotiable — it is the Gate C channel, 4s clean and
     * 26s under the Warden — so the ramp moves to fit it. On a shared 3s beat
     * every overtime, even the shortest, shows the fire step, the elite at the
     * ring edge and the ring closing; a contested exit eats eight of them.
     */
    eliteEveryS: 3,
    /** At ignition the trash drip stops entirely; only elites spawn. */
    stopTrashDrip: true,
    /** Threat multiplier grows by this much every `stepEveryS`, uncapped. */
    threatStep: 0.4,
    stepEveryS: 3,
    /** Spawn drip interval floor while the Collapse runs. */
    spawnFloorMs: 100,
  },

  /** Greed meter (PRD-V2 §5.26): ×(1 + stepPct/100 · floor((t − startS)/stepS)), capped at maxMul. */
  greed: {
    startS: 240,
    stepS: 48,
    stepPct: 5,
    maxMul: 1.25,
  },

  /** Carried-loot bag (PRD-V2 §5.16): a cols × rows cell grid. */
  bag: {
    cols: 4,
    rows: 3,
    casketSlots: 1,
    /** An overflow-dropped relic lingers on the ground this long for regret pickup. */
    dropLingerS: 10,
    /**
     * FALSE IS LAW (PRD §5.6). Auto-pinning the highest tier inverted the
     * casket's whole purpose: measured, it insured the player's BEST relic, so
     * death cost only the worst loot and 3 of 5 runs lost zero relics. The
     * casket starts EMPTY and `pinCasket` is the only way in.
     */
    autoPinHighest: false,
  },

  /** Loot from elites and bosses (items otherwise come from POIs and breakables). */
  loot: {
    /** Valuables per elite kill (PRD-V2 §5.5). */
    eliteValuables: 1,
    /** Items in a Boss Chest (PRD-V2 §5.6). */
    bossItems: 2,
    /** Tier shift for elite / boss drops. */
    eliteTierBias: 1,
    bossTierBias: 2,
  },

  /** Points of interest (PRD-V2 §5.12, `systems/poi.ts`). */
  poi: {
    /** POIs within this of the hero are live (and discovered). */
    activateRadius: 900,
    chest: {
      t1: { channelMs: 1500, tierBias: 0, shards: [25, 40] },
      t2: { channelMs: 2000, tierBias: 1, shards: [35, 55] },
      t3: { channelMs: 2500, tierBias: 1, shards: [50, 75], guards: 4 },
    },
    vault: { densityMul: 2.5, radius: 260, channelMs: 12000 },
    vein: { standMs: 3000, shards: [25, 40] },
    lair: { wakePx: 600, guards: [6, 10], keyChance: 0.35 },
    eventTimesS: [100, 220, 340],
    events: {
      caravan: { ghouls: 5, speed: 176, durationS: 40 },
      vigil: { radius: 200, holdS: 25, waves: 3, waveSize: 20 },
      rising: { kills: 60, windowS: 30, radius: 420 },
    },
    fence: { chance: 0.6, windowS: [180, 300], stayS: 90 },
    shrines: {
      blood: { maxHpPenalty: 0.2, drafts: 2 },
      gilt: { shardsMul: 1.3, spawnMul: 1.5, durationS: 60 },
      curse: { elites: 3, radius: 500, tierBonus: 1, rolls: 3 },
    },
  },

  /** Breakables (PRD-V2 §5.13, `objects/breakable.ts`); drop chances sum to 1. */
  breakable: {
    chunk: 1024,
    spawnPx: 1400,
    despawnPx: 2200,
    drops: {
      shards: { chance: 0.55, coins: [1, 3] },
      xp: { chance: 0.15, orbs: 5, value: 4 },
      /** Critic v2c M1: bread is the in-run heal — 10% while the hero is below `lowHpRatio`, 4% otherwise. */
      pk_bread: { chance: 0.04, lowHpChance: 0.08, lowHpRatio: 0.5 },
      pk_bell: { chance: 0.06 },
      pk_flask: { chance: 0.05 },
      pk_salt: { chance: 0.05 },
      item: { chance: 0.04, tierBias: -1 },
    },
  },

  /** Ground pickups (PRD-V2 §5.13), resolved in `game.ts`. */
  pickups: {
    /** Grave Bread also drops from elite kills (`eliteChance`) and t2+ reliquaries (`chestChance`), critic v2c M1. */
    bread: { heal: 25, eliteChance: 0.3, chestChance: 0.5 },
    bell: { vacuumMs: 2000 },
    flask: { damage: 80, radius: 520 },
    salt: { freezeMs: 3000, radius: 700 },
  },

  /** Gear (PRD-V2 §5.15); arrays are indexed by rarity − 1. */
  gear: {
    valueByRarity: [30, 60, 120, 240, 480, 900],
    rarityWeights: [50, 28, 14, 6, 2, 0],
    dustByRarity: [1, 3, 8, 20, 50, 120],
    /**
     * Item level is the main mid/late ◆ sink (economy retune): L → L+1 costs
     * `dustBase + dustPerLevel·L` Bone Dust and `round(shardsBase·shardsGrowth^(L−1))` ◆.
     */
    levelCost: { dustBase: 4, dustPerLevel: 3, shardsBase: 60, shardsGrowth: 1.22 },
    /** Max item level = min(20, base + perHazard × highest hazard extracted at). */
    levelCap: { base: 10, perHazard: 2 },
    /** Affix reroll: `shardsBase × implicitMul(rarity) × growth^rerolls` ◆ + `dust`, escalating per item. */
    affixReroll: { shardsBase: 150, growth: 1.6, dust: 10 },
    /** Unique chance per Boss Chest / Vault item roll. */
    uniqueChance: 0.08,
  },

  /** Dread Ascension (post-Sanctum infinite node): +perRankPct % damage and shards per rank, `base × growth^rank` ◆. */
  ascension: { perRankPct: 1, base: 5000, growth: 1.15 },

  /** The Gate Warden (PRD §7 `warden.*`): guards Gate C from 420s. */
  warden: {
    atS: 420,
    /**
     * The second the Climax's heavy lanes STOP and the arena clears for the
     * boss beat (`data/waves.ts` rows 14 and 15 end here).
     *
     * Fifteen seconds ahead of `atS`, not on it, and that gap is the whole
     * point. The §8 deep route evaluates its Gate C plan the moment the arch is
     * within travel range — about 414s, six seconds BEFORE the gate opens — and
     * that evaluation prices the wait against its own recent damage intake. As
     * long as the Climax lanes were still running at 414s, the estimate read a
     * Climax-rate drain over a 66-second wait and the answer was always "leave
     * now", so the Collapse was structurally unreachable content: 0 of 120
     * measured runs ever saw it, and the deep lane's whole §8 identity — stay
     * for `extract.collapseHaulBonus` — was a number nothing could ever earn.
     * The field thinning BEFORE the decision is what makes the decision real.
     *
     * It is also just better staging: the Dread Herald at 390s is the Climax's
     * crest, and a boss that arrives inside an unbroken horde is not a beat.
     * The ambient lanes (ratking, bonecaster, shroudmoth, Gilded Ghoul) keep
     * running to 480 so the arena is never empty, and `wave.compositionFromS`
     * keeps upgrading their spawns to elites — the pressure that remains is
     * the Warden and what the arch itself pulls in.
     */
    beatFromS: 405,
    gate: 'c',
    spawnOffsetPx: 220,
  },

  /**
   * Live-pool COMPOSITION ramp (PRD §7 `wave.*`). Density saturates at
   * `enemy.maxAlive` from ~285s and then never changes again — 226 measured
   * seconds of a flat picture, with player HP RISING at 470s. Past that point
   * the only honest escalation is what the pool is MADE OF, not how big it is:
   * scheduled trash spawns are upgraded to elites, consuming that spawn's
   * budget so no cull API is needed.
   *
   * `eliteSwapEveryS` was 20, and 20 is a LANE, not an escalation. Measured
   * over 20 deep-lane ceiling runs, every hit taken after 330s attributed to
   * the biggest body in contact: elites were 486 of 896 damage (54%), with the
   * Sorrow Reaper alone at 332 — one 38-damage swing is a quarter of the
   * player's bar at that phase, and two inside an i-frame pair is the run. At
   * 20s the swap injects ~10 elites between 285s and the Collapse on top of
   * §5.4's three AUTHORED entrances, so the scripted beats stop reading as
   * beats and the deep lanes never arrive at Gate C with a health bar to
   * spend. At 40s it injects ~5: the composition still turns over, the pool
   * still gets heavier as it thins, and the 150s/270s/390s entrances stay the
   * spikes the timeline is written around.
   */
  wave: {
    /**
     * Near-hero DENSITY TARGET (fix round 1, critic F1 / QA #3): ambient
     * spawns (director drip AND leash re-seats) only land while the live
     * count within 900 px of the hero is below this curve, so bodies the
     * player fails to clear throttle new arrivals instead of snowballing to
     * `enemy.maxAlive`. `[runSecond, bodies]` knots, linear between, flat
     * after the last. Read through `data/waves.ts densityTarget`.
     */
    densityTarget: [
      // Fix round 2 (critic B1): raised toward §6.3 (30/70/120/170/230) by Main's
      // decision; the throttle, not the spawn table, keeps it survivable.
      [0, 15],
      [30, 28],
      // Live fix round 2: 120 s / 240 s at −20% of Main's 55/90 — honest
      // Gate-B bots died at 130-165 s to 9-dmg contact from 10-23 bodies
      // within 200 px while density sat ON the curve.
      // User playtest ("too easy", 2026-09-25): 0-30 s unchanged, 120 s+ ~+20%.
      [120, 52],
      [180, 62],
      [240, 88],
      [420, 150],
    ] as readonly (readonly [number, number])[],
    /** The Wicket (FTUE) run holds this fraction of the curve. */
    /** 0.6 → 0.55 with the +20% mid curve, so the Wicket's 60-120 s density stays ~20-29 (was 20-26). */
    ftueDensityMul: 0.55,
    compositionFromS: 285,
    eliteSwapEveryS: 40,
    /** Fix round 2 (critic B3): 0.25 → 0.1; an elite swap is skipped while elites are ≥ this share of the live pool. */
    eliteShareMax: 0.1,
    /**
     * Density hard cap (critic B2): POI / event / elite / gate-guard bodies
     * count toward the near-hero budget; ambient spawning yields while they are
     * awake, and NOTHING (scripted or POI) lands near the hero once
     * `liveNear(900) ≥ densityTarget × densityHardCapMul`.
     */
    densityHardCapMul: 1.4,
    /**
     * Fix round 3 (QA v2b): ambient bodies ANYWHERE may not exceed
     * densityTarget × this. The near-hero throttle alone let 900-1800 px
     * stragglers pile up to 167 total and converge on the hero at ~120 s.
     */
    ambientTotalMul: 1.8,
    /** Critic B3: at most this many elites within `eliteNearPx` of the hero; extra elite spawns wait / seat farther out. */
    eliteNearCap: 2,
    eliteNearPx: 400,
  },

  /** Meta valves read at loadout/settlement (PRD-V2 §5.26). */
  meta: {
    /** % of carried shards kept on death (base). */
    deathKeepPct: 25,
    /** Rot Tithe `m_tithe` levels 1 / 2. */
    tithePct: [40, 55],
  },

  /** Hauler XP & account ladder (PRD-V2 §5.20); XP to next level = xpBase + xpStep·(L−1). */
  account: {
    xpBase: 200,
    xpStep: 75,
    deathMul: 0.6,
    perKill: 1,
    perSecond: 0.5,
    perPoi: 25,
    extractBonus: 100,
    perBoss: 150,
  },

  /** Hazard XP bonus per level above H1 (PRD-V2 §5.21); the rest of the table lives in `data/hazards.ts`. */
  hazard: {
    xpPerLevel: 0.15,
  },

  /** Grave's Pity (PRD-V2 §5.28): hidden help after consecutive deaths. */
  mercy: {
    deathStreak: 2,
    hpBonus: 0.15,
    chestBias: 1,
  },

  /** Minimap (PRD-V2 §14.10). */
  minimap: {
    /** Fog reveal radius; ×1.5 for the 24576² map. */
    revealPx: 1400,
    peekMs: 1500,
  },

  /** Baked outlines (PRD-V2 §13.1, `core/outline.ts`). */
  outline: {
    enemyPx: 3,
    elitePx: 4,
    bossPx: 5,
    heroPx: 3,
    enemyColor: 0xff2d2d,
    heroColor: 0x39ff6a,
    eliteGlow: 0x7a0000,
  },

  /** Floor lighting pools (PRD-V2 §3.7). */
  lighting: {
    poolAlpha: 0.32,
    flicker: 0.04,
    gradeMul: 0.85,
  },

  /** Wicket first run (PRD-V2 §5.28). */
  ftue: {
    runS: 240,
    /** Gate A sits ~1,200 px out (reached in ~5 s); 60 s left ~50 s of dead air at a shut door (critic F4). */
    gateAOpenS: 40,
    /** …or this long after the Ash Locket is picked up, if sooner (critic v2c M2)… */
    gateAAfterLocketS: 10,
    /** …but never before this. */
    gateAEarliestS: 30,
    gateADist: 1200,
    threatMul: 0.7,
    maxRetries: 2,
  },

  /** Low-tier device fallback (PRD-V2 §15): below `lowTierFps` for `lowTierWindowMs`. */
  perf: {
    lowTierFps: 50,
    lowTierWindowMs: 5000,
  },

  /** Scripted timeline events (see `data/waves.ts` `TIMELINE_EVENTS`). */
  events: {
    /**
     * `breather` seconds. The kind was implemented end to end — the slice heals
     * and silences spawns, the sim heals — and then AUTHORED NOWHERE: the run
     * timeline went from 240s to the Warden at 420s as one unbroken escalation
     * with no recovery beat, which is the shape the deep lanes measured as
     * unsurvivable.
     *
     * 290s lands after the Gate B stack (240s open + 250s guard pack + 270s
     * elite). 412s is placed to the FRAME, not to the phase: the §8 deep route
     * prices its Gate C plan the moment the arch comes into travel range, ~414s,
     * and that one evaluation decides whether the run ends at 424s or plays the
     * Collapse. A recovery beat two seconds earlier is the difference between
     * making that call on a real health bar and making it on the wreckage of
     * the Climax; the 8s spawn silence then covers the Warden's entrance at
     * 420s. It sits after `warden.beatFromS` (405s) on purpose — heal into a
     * field that has already thinned, not into one still spawning.
     */
    breatherAtS: [290, 412],
    /** `breather` silences ordinary spawns for this long and heals this fraction of max HP. */
    breatherSilenceMs: 8000,
    breatherHealRatio: 0.1,
  },

  /** Performance and feel caps from the design heuristics and the §13 juice table. */
  caps: {
    /** §13 "12 floatTexts/s scene-wide" — the AGGREGATE across hit and kill floaters. */
    floatTextPerSecond: 12,
    /** Above this many live enemies, screen shake is suppressed. */
    shakeEntityLimit: 150,
    /**
     * §13 "no burst above 200 entities" — the death-burst cull, DELIBERATELY a
     * different threshold from `shakeEntityLimit` (150) and not to be unified
     * with it: a burst is per-kill and costs an emitter, shake is per-beat and
     * costs legibility, so they fail in different ways and at different counts.
     * Neither fires in normal play (the sim peaks at 98 live bodies, median 42
     * at the Warden beat); both exist for the Collapse, where
     * `collapse.stopTrashDrip` makes the live count FALL while elite share
     * rises — so this cap is quieter in overtime than at Climax, by design.
     */
    burstEntityLimit: 200,
    /** §12: at most this many enemy-hit voices a second. */
    hitSfxPerSecond: 6,
    /** §13 "1 shake/s" on the player-hurt beat. */
    hurtShakePerSecond: 1,
    spatialCellSize: 96,
  },
} as const;

export type Tuning = typeof TUNING;

/**
 * The player's `StatBlock` base values — and the ONE list of stat keys
 * modifiers are allowed to target (PRD-V2 §5.2 frozen union, `PlayerStatKey`
 * in `data/types-v2.ts`). `data/upgrades.ts` is validated against these keys
 * at boot, because a card pointing at a stat nobody reads fails silently.
 * Engine numbers nothing modifies (`projectileSpeed`, `invulnMs`…)
 * stay plain `TUNING.player.*` config.
 *
 * Semantics:
 * - `damageMul` scales every weapon's authored base damage.
 * - `cooldownMul` scales every weapon's authored interval (lower = faster).
 * - `area` scales reach, blast radii and projectile hit radius.
 * - `shardsMul` scales every shard payout (kills, coins, veins).
 * - `channelMs` is the extraction hold in ms; the scene turns the DELTA from
 *   its base into `ExtractionTuning.channel.channelMsDelta`.
 * - `bagCells` is the bag grid size (cols × rows).
 * - `projectileBonus` adds projectiles to every projectile weapon.
 * - `durationMul` scales DoTs, pools and buffs; `regenPerS` is hp/s.
 * - `contactDamageMul` scales every blow that reaches the hero.
 * - `xpMul` scales XP pickups; `luck` shifts item rarity (§5.15).
 * - `pickupRadius` is px, `critChance` is 0..1, `critMul` is a multiplier.
 */
export const PLAYER_BASE_STATS = {
  maxHp: TUNING.player.maxHp,
  moveSpeed: TUNING.player.moveSpeed,
  damageMul: 1,
  cooldownMul: 1,
  area: 1,
  critChance: TUNING.player.critChance,
  critMul: TUNING.player.critMul,
  pickupRadius: TUNING.player.pickupRadius,
  shardsMul: 1,
  channelMs: TUNING.extract.channelMs,
  bagCells: TUNING.bag.cols * TUNING.bag.rows,
  projectileBonus: 0,
  durationMul: 1,
  regenPerS: TUNING.player.regenPerSecond,
  contactDamageMul: 1,
  xpMul: 1,
  luck: 0,
} as const satisfies Record<PlayerStatKey, number>;

export type { PlayerStatKey };
