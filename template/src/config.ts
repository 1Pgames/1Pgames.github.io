import type Phaser from 'phaser';
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
 * Palette. Keep it to ~8 colors; a tight palette is the cheapest way to make a
 * generated game look intentional. Numbers are Phaser-style 0xRRGGBB.
 */
export const PALETTE = {
  bgDeep: 0x05070d,
  bgTop: 0x121a2e,
  bgBottom: 0x070a12,
  ink: 0xf2f6ff,
  inkSoft: 0x8fa1c7,
  primary: 0x4de1ff,
  secondary: 0xff5da2,
  accent: 0xffd166,
  good: 0x5df2a0,
  bad: 0xff4d5e,
} as const;

export const CSS = {
  ink: '#f2f6ff',
  inkSoft: '#8fa1c7',
  primary: '#4de1ff',
  secondary: '#ff5da2',
  accent: '#ffd166',
  good: '#5df2a0',
  bad: '#ff4d5e',
} as const;

/** Font stack — no webfont download, no FOUT, works offline. */
export const FONT = {
  family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: '"Arial Black", system-ui, sans-serif',
} as const;

/** Text presets so every scene has consistent typography. */
export const TEXT = {
  title: { fontFamily: FONT.display, fontSize: '96px', color: CSS.ink },
  heading: { fontFamily: FONT.display, fontSize: '56px', color: CSS.ink },
  score: { fontFamily: FONT.display, fontSize: '72px', color: CSS.ink },
  body: { fontFamily: FONT.family, fontSize: '32px', color: CSS.inkSoft },
  label: { fontFamily: FONT.family, fontSize: '26px', color: CSS.inkSoft },
  button: { fontFamily: FONT.display, fontSize: '40px', color: CSS.ink },
} as const satisfies Record<string, Phaser.Types.GameObjects.Text.TextStyle>;

/**
 * ---------------------------------------------------------------------------
 * BALANCE — replace wholesale per game, keep the shape.
 * Every number the design talks about lives here; scenes and entities read it.
 * Values below drive the demo survivor-like slice (480s run).
 * ---------------------------------------------------------------------------
 */
export const TUNING = {
  /** Reference run: 8 minutes, phases from data/waves.ts. */
  runSeconds: 480,
  /** No enemies before this — the player learns the verb first. */
  graceSeconds: 4,

  player: {
    maxHp: 110,
    moveSpeed: 330,
    /** Drag-follow easing: fraction of the remaining distance per 16ms. */
    followLerp: 0.22,
    size: 96,
    damage: 12,
    attackMs: 620,
    /** Auto-attack range in px. Keep under ~45% of VIEW.width so kills happen on-screen. */
    range: 300,
    projectiles: 1,
    projectileSpeed: 700,
    projectileSize: 18,
    critChance: 0.05,
    critMul: 2,
    regenPerSecond: 0.4,
    pickupRadius: 150,
    invulnMs: 700,
    /** Impulse (px/s) applied to an enemy on contact with the player; `bulwark` doubles it. */
    contactKnockback: 70,
    contactKnockbackMs: 160,
  },

  /** Weapon patterns (see `data/weapons.ts`). `bolt` reads `player.*` above unchanged. */
  weapons: {
    /** Max simultaneously-equipped weapons. */
    maxSlots: 3,
    /** Boost cards per weapon before it evolves. */
    maxBoosts: 3,
    bolt: { boostDamageMul: 0.15, boostCooldownMul: 0.07 },
    orbit: {
      /** Fraction of the `damage` stat one blade hit deals. */
      damageMul: 0.6,
      hitCooldownMs: 380,
      radius: 150,
      blades: 1,
      boostDamageMul: 0.2,
      boostRadiusMul: 0.12,
    },
    nova: {
      damageMul: 1.6,
      cooldownMs: 2200,
      radius: 260,
      /** Fraction of radius at which falloff starts reducing damage toward 0 at the edge. */
      falloffStart: 0.4,
      boostDamageMul: 0.2,
      boostCooldownMul: 0.1,
    },
    rail: {
      damageMul: 1.9,
      cooldownMs: 1900,
      pierceCount: 4,
      boostDamageMul: 0.2,
      boostPierceAdd: 1,
    },
  },

  /** XP thresholds: needed(level) = round(base * growth^(level-1)). */
  xp: {
    base: 15,
    growth: 1.5,
    /** Orb magnetism speed once inside pickupRadius. */
    orbSpeed: 560,
    /** Speed multiplier while the orb is still outside pickupRadius. */
    driftFactor: 0.22,
  },

  enemy: {
    /** Spawn ring radius beyond the screen edge. */
    spawnMargin: 70,
    /** Contact damage tick interval. */
    hitMs: 500,
    /** Applied on top of data/enemies.ts base stats by RunDirector.difficulty. */
    hpScaleCap: 3.2,
    /** Hard cap on live enemies — protects 60fps. */
    maxAlive: 220,
    /** `healAura` enemies pulse a heal to allies within this radius, this often, for this much HP. */
    healAuraRadius: 220,
    healAuraIntervalMs: 2000,
    healAuraAmount: 8,
    /** `charge` enemies flash + telegraph a thin line before dashing. */
    chargeTelegraphMs: 400,
  },

  boss: {
    /** HP ratio thresholds below which phase 2 / phase 3 begin. */
    phase2At: 0.66,
    phase3At: 0.33,
    /** Phase 1: spread-shot volley cadence and shot count. */
    volleyCooldownMs: 2200,
    volleyShots: 5,
    /** Phase 2: swarm summon count and shield damage reduction while adds live. */
    summonMin: 6,
    summonMax: 10,
    shieldDamageMul: 0.35,
    /** Phase 3: enrage speed/cadence multipliers and the bullet-ring cadence. */
    enrageSpeedMul: 1.4,
    enrageCadenceMul: 0.65,
    ringCooldownMs: 3000,
    ringTelegraphMs: 500,
    ringShots: 14,
  },

  /** Elites drop pooled coin pickups splitting `economy.currencyPerElite`. */
  elite: {
    coinDropMin: 3,
    coinDropMax: 5,
  },

  /** Legendary `effect` cards (see `core/effects.ts`) — the numbers the hooks read. */
  effects: {
    glassCannon: { damageMul: 0.8, hpCapRatio: 0.4, killIframesMs: 200 },
    bulwark: { maxHpAdd: 60, regenPerSecondAdd: 1.5, moveSpeedMul: -0.25, knockbackMul: 2 },
  },

  economy: {
    /** Meta currency: per kill, per elite, per boss, and the win bonus. */
    currencyPerKill: 1,
    currencyPerElite: 25,
    currencyPerBoss: 120,
    winBonus: 150,
    /** Score shown in results. */
    scorePerKill: 10,
    scorePerSecond: 1,
  },

  /**
   * Bounded play field (see `systems/arena.ts`). Several screens wide, camera
   * follows the player inside it — a known field beats an endless plain: the
   * player can read where pressure comes from and the run has a shape.
   */
  arena: {
    width: 1440,
    height: 2160,
    /** Floor tile size in px. */
    tileSize: 512,
    wallThickness: 26,
    /** Impassable props per run. */
    propsMin: 14,
    propsMax: 20,
    /** No props inside this radius of the centre, where the run starts. */
    spawnClearRadius: 260,
    /** Flat, non-colliding floor decoration. */
    decalCount: 16,
    /** Camera follow smoothing (0..1 per frame). */
    cameraLerp: 0.12,
    /** View bias: positive pushes the player below the HUD band. */
    cameraOffsetY: 90,
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
    zoneTop: 0.42,
    idleAlpha: 0.28,
    activeAlpha: 0.75,
  },

  /** Upgrade draft: how many cards per level-up and the reroll cost. */
  draft: {
    choices: 3,
    rerollCost: 0,
  },

  /** Scripted timeline events (see `data/waves.ts` `TIMELINE_EVENTS`). */
  events: {
    /** `breather` silences ordinary spawns for this long and heals this fraction of max HP. */
    breatherSilenceMs: 8000,
    breatherHealRatio: 0.1,
    /** `elite-rush` spawns this many elites in a tight arc facing one random direction. */
    eliteRushCount: 2,
  },

  /** Performance and feel caps from the design heuristics. */
  caps: {
    floatTextPerSecond: 12,
    /** Above this many live enemies, screen shake is suppressed. */
    shakeEntityLimit: 150,
    spatialCellSize: 96,
  },
} as const;

export type Tuning = typeof TUNING;

/**
 * The player's `StatBlock` base values — and, just as importantly, the ONE list
 * of stat keys upgrades are allowed to modify. `data/upgrades.ts` is validated
 * against these keys at boot, because a card pointing at a stat nobody reads
 * (`projectileCount` vs `projectiles`) fails completely silently: the modifier
 * lands, the number changes, and nothing in the game consults it.
 *
 * Semantics worth knowing:
 * - `attackSpeed` is a multiplier: the attack interval is `attackMs / attackSpeed`.
 * - `areaMul` scales projectile size and hit radius.
 * - `regenPerSecond` is HP per second, `pickupRadius` is px.
 */
export const PLAYER_BASE_STATS = {
  maxHp: TUNING.player.maxHp,
  damage: TUNING.player.damage,
  attackMs: TUNING.player.attackMs,
  attackSpeed: 1,
  moveSpeed: TUNING.player.moveSpeed,
  range: TUNING.player.range,
  projectiles: TUNING.player.projectiles,
  projectileSpeed: TUNING.player.projectileSpeed,
  areaMul: 1,
  critChance: TUNING.player.critChance,
  critMul: TUNING.player.critMul,
  regenPerSecond: TUNING.player.regenPerSecond,
  pickupRadius: TUNING.player.pickupRadius,
  xpGain: 1,
} as const satisfies Record<string, number>;

export type PlayerStatKey = keyof typeof PLAYER_BASE_STATS;
