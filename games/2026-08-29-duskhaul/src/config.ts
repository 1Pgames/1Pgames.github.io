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
    /** Max simultaneously-equipped weapons (§7 `weapon.slots` = 4). */
    maxSlots: 3,
    /**
     * Boost cards per weapon before it evolves. Rank = boosts + 1, so 4 is
     * §7's `weapon.maxRank` 5 — the number `WEAPON_MAX_RANK`, the boost card's
     * stack limit and the §5.3 evolution gate all derive from.
     */
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
    /**
     * Phase 3: enrage speed plus the bullet-ring cadence. Phase 3 REPLACES the
     * volley with the ring (`Enemy.tickBoss` routes into `tickBossRing` and
     * never reaches the volley branch), so the ring's own cooldown is the
     * phase-3 cadence and there is no separate enrage cadence multiplier to
     * apply — the one that used to sit here was read by nothing but the sim,
     * which was modelling a phase-3 volley the game does not fire.
     */
    enrageSpeedMul: 1.4,
    ringCooldownMs: 3000,
    ringTelegraphMs: 500,
    ringShots: 14,
  },

  /**
   * Elites: the scheduled spikes, the Gate B guard pack, and their coin drop.
   * `atS` are the three scripted elite entrances (PRD §5.4); `gateGuard*`
   * is the pack that contests Gate B shortly after it opens, which is what
   * prices the mid gate above the free early one.
   */
  elite: {
    coinDropMin: 3,
    coinDropMax: 5,
    atS: [150, 270, 390],
    gateGuardAtS: 250,
    gateGuardGate: 'b',
    gateGuardRadiusPx: 300,
    gateGuardAdds: 8,
  },

  /** Legendary `effect` cards (see `core/effects.ts`) — the numbers the hooks read. */
  effects: {
    glassCannon: { damageMul: 0.8, hpCapRatio: 0.4, killIframesMs: 200 },
    bulwark: { maxHpAdd: 60, regenPerSecondAdd: 1.5, moveSpeedMul: -0.25, knockbackMul: 2 },
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

  /**
   * Extraction gates (PRD §7 `gate.*`): open/close windows in run seconds
   * plus the channel-ring radius. Gate C never closes (`closeS: null`) — the
   * Collapse is its closing mechanism.
   */
  gate: {
    a: { openS: 120, closeS: 210 },
    b: { openS: 240, closeS: 360 },
    c: { openS: 420, closeS: null },
    radius: 120,
    /** A gate reads/renders as 'closing' inside this many seconds of its close. */
    closingWarnS: 15,
    /**
     * The compass previews a gate this far ahead of its open time. Raised from
     * 30 to 60 to kill the measured two-minute cold open: the extraction clock
     * has to be legible BEFORE it matters (PRD §7, §18.28).
     */
    previewS: 60,
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
    suppressRadius: 400,
    /** Headless fallback: with no in-ring count, contest is inferred from a hit inside this window. */
    contestedInferMs: 1000,
    /** Added to every gate's closeS inside ExtractionSystem (Duskmirror sets +20). */
    gateWindowBonusS: 0,
    /** Added to channelMs in one place (Gravekey sets -800). */
    channelMsDelta: 0,
    /** Effective channel = max(floor, channelMs + delta). */
    channelMsFloor: 1200,
    /**
     * Haul premium for extracting at or after `collapse.atS` — a multiplier on
     * BANKED shards, applied at settlement in the slice (not inside `Bag`,
     * whose §16.1 signature is frozen and must stay a pure function).
     *
     * Why it exists: the sim proved the Collapse was unreachable content.
     * Gate C opens at 420s and its channel can be started immediately, so an
     * optimally-played deep run always ends BEFORE 480 and nobody ever sees
     * the ending we specced. Locking the Gate C channel until ignition was
     * measured and rejected — it cost the deep lane 10-15 points of extraction
     * and bolts a low-HP player in with both other gates spent. Paying for the
     * risk instead keeps the decision the player's, which is the whole thesis
     * of the game: you stay because it pays, not because the door is barred.
     */
    collapseHaulBonus: 0.5,
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
    minStart: 700,
    maxStart: 1200,
    /** Ring stops here — Gate C (r=120) must stay standable. */
    minRadius: 140,
    /** Initial shrink rate toward Gate C. */
    ringSpeedPxPerS: 22,
    /** Shrink-rate ramp (escalation 1 of 3). */
    ringAccel: 0.8,
    /** Cap on the instantaneous shrink rate. */
    ringSpeedMax: 90,
    /** Standing in the fire drains this many hp/s, bypassing i-frames. */
    fireDps: 10,
    /** Fire damage ramp (escalation 2 of 3). */
    fireDpsStep: 4,
    fireDpsMax: 60,
    /** Inject one elite at the ring edge this often (escalation 3 of 3). */
    eliteEveryS: 6,
    /** At ignition the trash drip stops entirely; only elites spawn. */
    stopTrashDrip: true,
    /** Threat multiplier grows by this much every `stepEveryS`, uncapped. */
    threatStep: 0.4,
    stepEveryS: 10,
    /** Spawn drip interval floor while the Collapse runs. */
    spawnFloorMs: 100,
  },

  /** Carried-loot bag (PRD §7 `bag.*`). */
  bag: {
    slots: 8,
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

  /** Relic loot (PRD §7 `loot.*`): tier weights t1-t4 and salvage values per tier. */
  loot: {
    tierWeights: [60, 27, 10, 3],
    salvage: [10, 30, 80, 200],
    /** First relic drop. Was implicitly 120s, which left a two-minute cold open. */
    firstRelicS: 35,
    /** Ambient relic drip. Was 55s, which meant the 8-slot bag first bound at t=497s of a 509s run. */
    relicDripS: 26,
    /** Relics dropped per elite kill. */
    eliteRelics: 2,
    /** Tier-weight shift for elite / boss (Warden) drops. */
    eliteTierBias: 1,
    bossTierBias: 2,
    /**
     * Shard caches: the non-kill income source (PRD §6). Income was measured as
     * a FORK, not a curve — an avoidant player banked 0.79-1.30/s against a
     * 2.4-3.2 spec while a killing player hit it exactly. Caches give the
     * avoidant branch a floor that does not require clearing the screen.
     */
    cacheEveryS: 30,
    cacheValue: 18,
    cacheMinDist: 500,
    cacheMaxDist: 700,
    cacheLingerS: 45,
  },

  /** Guaranteed relic chests (PRD §7 `chest.*`). */
  chest: {
    atS: [165, 345],
    tierBias: 1,
    relics: 1,
  },

  /** The Dread Shrine (PRD §7 `shrine.*`): a high-density, high-reward pocket. */
  shrine: {
    atS: 300,
    densityMul: 2.5,
    radiusPx: 260,
    tierBias: 2,
    minTier: 3,
  },

  /** The Gate Warden (PRD §7 `warden.*`): guards Gate C from 420s. */
  warden: {
    atS: 420,
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
   */
  wave: {
    compositionFromS: 285,
    eliteSwapEveryS: 20,
    eliteShareMax: 0.25,
  },

  /** Meta valves read at settlement (PRD §7 `meta.*`). */
  meta: {
    /** % of carried shards kept on death — 0 until the Rot Tithe upgrade exists. */
    deathKeepPct: 0,
  },

  /** Scripted timeline events (see `data/waves.ts` `TIMELINE_EVENTS`). */
  events: {
    /** `breather` silences ordinary spawns for this long and heals this fraction of max HP. */
    breatherSilenceMs: 8000,
    breatherHealRatio: 0.1,
    /** `elite-rush` spawns this many elites in a tight arc facing one random direction. */
    eliteRushCount: 2,
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
    /** §13/§12: at most this many enemy-death voices a second. */
    dieSfxPerSecond: 4,
    /** §12: at most this many enemy-hit voices a second. */
    hitSfxPerSecond: 6,
    /** §13 "1 shake/s" on the player-hurt beat. */
    hurtShakePerSecond: 1,
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
 * THIS LIST IS THE FROZEN §16.1 `StatKey` UNION, VERBATIM, and it is the same
 * eleven keys `sim/families/arena.ts` `baseStats()` opens with — the parity
 * rule: the build the sim measures is the build the scene runs. The template's
 * own keys (`damage`, `attackMs`, `attackSpeed`, `range`, `projectiles`,
 * `projectileSpeed`, `areaMul`, `regenPerSecond`, `xpGain`) are GONE from the
 * stat surface, not renamed into it: the engine numbers among them are plain
 * `TUNING.player.*` config read directly by `systems/combat.ts` and
 * `objects/player.ts`, because a constant nothing modifies has no business
 * paying for a modifier stack (see `core/stats.ts`).
 *
 * Semantics of the eleven:
 * - `damageMul` scales every weapon's authored base damage.
 * - `cooldownMul` scales every weapon's authored interval (lower = faster).
 * - `area` scales reach, blast radii and projectile hit radius.
 * - `shardsMul` scales every shard payout (kills, coins, caches).
 * - `channelMs` is the extraction hold in ms; the scene turns the DELTA from
 *   its base into `ExtractionTuning.channel.channelMsDelta`.
 * - `bagSlots` is the relic bag size; the delta feeds `resolveBagCapacity`.
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
  bagSlots: TUNING.bag.slots,
} as const satisfies Record<string, number>;

export type PlayerStatKey = keyof typeof PLAYER_BASE_STATS;
