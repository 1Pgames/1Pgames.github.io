import Phaser from 'phaser';
import { CSS, FONT, PALETTE, VIEW } from '../config';
import { TEX } from '../core/keys';
import { sfx, sfxArp, audioSettings } from '../core/audio';
import { setTimeDilation, shake } from '../core/juice';
import { holdToasts } from './toast';
import { charmIconId, iconFor, weaponIconId } from './itemIcon';
import { weaponDef, type WeaponState } from '../data/weapons';
import { CHARMS } from '../data/charms';
import type { Enemy } from '../objects/enemy';
import type { CharmId, WeaponId } from '../data/types-v2';

/**
 * Progression ceremonies (user ask: "evolution animations, so the player feels
 * they are progressing"). Four beats on one engine:
 *
 * | beat          | length   | channels                                                        |
 * |---------------|----------|-----------------------------------------------------------------|
 * | evolution     | 2150 ms  | dilation ×0.2, vignette, hero column + rings, shove, icon merge, |
 * |               |          | burst, flare, shake, title/name/effect, gilt streak to HUD, sfx×6 |
 * | weapon rank-up| 520 ms   | icon pop + pip fill over the hero, cyan burst, sfx×2             |
 * | new weapon    | 760 ms   | icon pop over hero, ring, fly to the build button, arrival pop   |
 * | new charm     | 620 ms   | same as new weapon, smaller, violet                              |
 *
 * Every beat is a pure function of its own REAL-TIME clock (`game.loop.delta`
 * on POST_UPDATE, not `scene.time`/tweens): the cinematic dilates the scene's
 * gameplay clock, and the ceremony itself must not slow with it. No tween is
 * ever created, so the scene's tween count is untouched; every object is owned
 * by its beat and destroyed on finish or on scene SHUTDOWN.
 *
 * Skip: a tap ≥ SKIP_ARM_MS into the cinematic fast-forwards it ×SKIP_SPEED
 * through the SAME timeline (merge, title and fly-in all still resolve) and
 * releases the dilation at once. Input is never blocked — the tap that skips
 * also drives the joystick.
 *
 * Palette (PRD-V2 §5.8/§13.2): world-space hero fx stay cool (violet, cyan,
 * bone); gilt (`PALETTE.accent`) is used only screen-side, as the UI's reward
 * colour (title, streak into the HUD).
 */

/** Hero body the beats anchor to (the arena's `Player`). */
type Hero = Phaser.GameObjects.Sprite;

/** Broad-phase query the shove uses (`CombatSystem.enemiesInRadius`). */
export interface EnemyQuery {
  enemiesInRadius(x: number, y: number, r: number, out: Enemy[]): number;
}

/** Weapon slots the post-evolution flourish watches (`WeaponSystem`). */
export interface WeaponSlots {
  equipped(): readonly WeaponState[];
}

export interface EvolutionSpec {
  weaponId: WeaponId;
  charmId: CharmId;
  fromName: string;
  toName: string;
  effectLine: string;
  hero: Hero;
  /** Hostiles near the hero get shoved outward a little; omitted → fx only. */
  enemies?: EnemyQuery;
  /** Enables the flourish on the evolved weapon's first attacks; omitted → no flourish. */
  weapons?: WeaponSlots;
}

export interface RankUpSpec {
  weaponId: WeaponId;
  /** Rank AFTER the boost (2..maxRank). */
  rank: number;
  maxRank: number;
  hero: Hero;
}

export interface NewWeaponSpec {
  weaponId: WeaponId;
  name: string;
  hero: Hero;
}

export interface NewCharmSpec {
  charmId: CharmId;
  name: string;
  hero: Hero;
}

/** Data-derived spec fields for an evolution of `id` (names, partner, effect line). */
export function evolutionInfo(id: WeaponId): Pick<EvolutionSpec, 'weaponId' | 'charmId' | 'fromName' | 'toName' | 'effectLine'> {
  const def = weaponDef(id);
  return { weaponId: id, charmId: def.partner, fromName: def.name, toName: def.evolvedName, effectLine: def.evolvedDescription };
}

/** Charm display name from data (`CHARMS`), id as last resort. */
export function charmName(id: CharmId): string {
  return CHARMS.find((c) => c.id === id)?.name ?? id;
}

// ─────────────────────────── timing & layout ───────────────────────────

const HERO_FX = { cyan: 0x6fd6ff, violet: 0xad6eef, bone: 0xeae1bf } as const;
const GILT = PALETTE.accent;
const INK = 0x03040b;

/** Cinematic layers sit over the banner (1120) and flash (1140), under draft cards (2000) and pause (2100). */
const DEPTH = { vignette: 1142, glow: 1144, icons: 1146, text: 1148, world: 880 } as const;

/** Build / pause button centre (`ui/hud.ts PAUSE` 592,0,88): the run's build lives behind it. */
const BUILD_TARGET = { x: 636, y: 44 } as const;
/** Centre of the evolution composition (clear of HUD 0-170 and the joystick band). */
const STAGE = { x: VIEW.width / 2, y: 600 } as const;

const EVO = {
  totalMs: 2150,
  dilation: 0.2,
  dilateInMs: 120,
  dilateHoldMs: 1250,
  dilateOutMs: 350,
  vignetteInMs: 250,
  vignetteOutFrom: 1450,
  vignetteOutMs: 350,
  columnMs: 900,
  ringStaggerMs: 90,
  ringMs: 420,
  ringMaxR: 260,
  shoveR: 260,
  shovePx: 36,
  shoveMs: 300,
  flyInFrom: 300,
  mergeAt: 820,
  popMs: 280,
  titleAt: 880,
  nameAt: 960,
  effectAt: 1040,
  textInMs: 200,
  textOutFrom: 1500,
  textOutMs: 220,
  flyOutFrom: 1350,
  arriveAt: 1900,
  arrivalRingMs: 250,
  iconSize: 128,
  evoSize: 168,
} as const;

/** Reduced motion: no dilation/shake/shove, and the whole ceremony runs this much faster. */
const REDUCED_SPEED = 1.35;
const SKIP_ARM_MS = 250;
const SKIP_SPEED = 4;
/** Flourish on the evolved weapon: this many attacks, within this window after the cinematic. */
const FLOURISH = { count: 3, windowMs: 10000, orbitGapMs: 500, ms: 240 } as const;
/** Small beats alive at once (extra ones wait); consecutive starts are staggered by this. */
const SMALL_MAX = 3;
const SMALL_STAGGER_MS = 140;

// ─────────────────────────── easing ───────────────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (t: number, from: number, ms: number): number => clamp01((t - from) / ms);
const outQuad = (p: number): number => 1 - (1 - p) * (1 - p);
const outCubic = (p: number): number => 1 - (1 - p) ** 3;
const inCubic = (p: number): number => p * p * p;
const inQuad = (p: number): number => p * p;
const outBack = (p: number, s = 1.9): number => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2;

/** Beats start at this clock value so `crossed(t, prev, 0)` fires exactly once, on the first rendered frame. */
const UNSTARTED = -1;

function textStyle(size: number, color: string, display = true): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: display ? FONT.display : FONT.family,
    fontSize: `${size}px`,
    color,
    align: 'center',
    stroke: '#03040b',
    strokeThickness: Math.min(6, Math.max(2, Math.round(size / 12))),
    shadow: { offsetX: 0, offsetY: 3, color: '#03040b', blur: 6, stroke: true, fill: true },
  };
}

function heroScreen(scene: Phaser.Scene, hero: Hero, out: { x: number; y: number }): { x: number; y: number } {
  const cam = scene.cameras.main;
  out.x = (hero.x - cam.worldView.x) * cam.zoom;
  out.y = (hero.y - cam.worldView.y) * cam.zoom;
  return out;
}

// ─────────────────────────── engine ───────────────────────────

interface Beat {
  /** Real ms since start (already speed-scaled). */
  t: number;
  speed: number;
  readonly totalMs: number;
  /** Real ms to wait before t starts advancing (small-beat stagger). */
  delayMs: number;
  render(t: number, prevT: number): void;
  destroy(): void;
}

/** Screen-space particle emitters shared by every beat of a scene, one per colour. */
type Sparks = Record<'violet' | 'bone' | 'cyan' | 'gilt', Phaser.GameObjects.Particles.ParticleEmitter>;

interface Director {
  cinematic: Beat | null;
  queue: EvolutionSpec[];
  small: Beat[];
  smallWaiting: Array<() => Beat>;
  lastSmallStartMs: number;
  flourish: Beat[];
  sparks: Sparks | null;
  realMs: number;
  /** Scene is shutting down: beats release objects only (no dilation write, no new flourish). */
  closing: boolean;
}

const directors = new WeakMap<Phaser.Scene, Director>();

function director(scene: Phaser.Scene): Director {
  const existing = directors.get(scene);
  if (existing !== undefined) return existing;
  const d: Director = {
    cinematic: null,
    queue: [],
    small: [],
    smallWaiting: [],
    lastSmallStartMs: -Infinity,
    flourish: [],
    sparks: null,
    realMs: 0,
    closing: false,
  };
  directors.set(scene, d);
  const tick = (): void => step(scene, d, scene.game.loop.delta);
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    // Physics is already torn down and juice's own SHUTDOWN hook drops the dilations:
    // beats only release their objects here (no dilation write, no new flourish).
    d.closing = true;
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, tick);
    d.cinematic?.destroy();
    for (const b of d.small) b.destroy();
    for (const b of d.flourish) b.destroy();
    if (d.sparks !== null) for (const e of Object.values(d.sparks)) e.destroy();
    directors.delete(scene);
  });
  return d;
}

function sparks(scene: Phaser.Scene, d: Director): Sparks {
  if (d.sparks !== null) return d.sparks;
  const make = (tint: number): Phaser.GameObjects.Particles.ParticleEmitter =>
    scene.add
      .particles(0, 0, TEX.particle, {
        speed: { min: 140, max: 420 },
        lifespan: { min: 260, max: 620 },
        scale: { start: 1.2, end: 0 },
        alpha: { start: 1, end: 0 },
        tint,
        blendMode: 'ADD',
        emitting: false,
      })
      .setScrollFactor(0)
      .setDepth(DEPTH.icons + 1);
  d.sparks = { violet: make(HERO_FX.violet), bone: make(HERO_FX.bone), cyan: make(HERO_FX.cyan), gilt: make(GILT) };
  return d.sparks;
}

/** Advances one beat; true when it finished (and was destroyed). */
function advance(beat: Beat, dt: number): boolean {
  if (beat.delayMs > 0) {
    beat.delayMs -= dt;
    if (beat.delayMs > 0) return false;
    dt = -beat.delayMs;
    beat.delayMs = 0;
  }
  const prev = beat.t;
  beat.t = Math.min(beat.totalMs, Math.max(0, beat.t) + dt * beat.speed);
  beat.render(beat.t, prev);
  if (beat.t < beat.totalMs) return false;
  beat.destroy();
  return true;
}

function step(scene: Phaser.Scene, d: Director, dt: number): void {
  d.realMs += dt;
  if (d.cinematic !== null && advance(d.cinematic, dt)) {
    d.cinematic = null;
    const next = d.queue.shift();
    if (next !== undefined) d.cinematic = evolutionBeat(scene, d, next);
  }
  for (let i = d.small.length - 1; i >= 0; i -= 1) {
    const b = d.small[i];
    if (b !== undefined && advance(b, dt)) d.small.splice(i, 1);
  }
  while (d.smallWaiting.length > 0 && d.small.length < SMALL_MAX) {
    const make = d.smallWaiting.shift();
    if (make === undefined) break;
    const beat = make();
    const since = d.realMs - d.lastSmallStartMs;
    beat.delayMs = Math.max(0, SMALL_STAGGER_MS - since);
    d.lastSmallStartMs = d.realMs + beat.delayMs;
    d.small.push(beat);
  }
  for (let i = d.flourish.length - 1; i >= 0; i -= 1) {
    const b = d.flourish[i];
    if (b !== undefined && advance(b, dt)) d.flourish.splice(i, 1);
  }
}

/** Fires `fn` once when the beat clock crosses `at` (works under fast-forward too). */
function crossed(t: number, prev: number, at: number): boolean {
  return prev < at && t >= at;
}

// ─────────────────────────── public API ───────────────────────────

/**
 * Evolution cinematic (~2.15 s; ~1.6 s reduced-motion; ≤ 0.55 s once skipped).
 * One at a time per scene — a second call while one plays is queued.
 */
export function playEvolution(scene: Phaser.Scene, spec: EvolutionSpec): void {
  const d = director(scene);
  if (d.cinematic !== null) {
    d.queue.push(spec);
    return;
  }
  d.cinematic = evolutionBeat(scene, d, spec);
}

/** True while an evolution cinematic plays or is queued. */
export function evolutionPlaying(scene: Phaser.Scene): boolean {
  const d = directors.get(scene);
  return d !== undefined && (d.cinematic !== null || d.queue.length > 0);
}

/** Weapon rank-up: pips fill and the icon pops over the hero (~0.5 s). */
export function playRankUp(scene: Phaser.Scene, spec: RankUpSpec): void {
  const d = director(scene);
  d.smallWaiting.push(() => rankUpBeat(scene, d, spec));
}

/** New weapon: icon pops over the hero, then flies into the build button (~0.76 s). */
export function playNewWeapon(scene: Phaser.Scene, spec: NewWeaponSpec): void {
  const d = director(scene);
  d.smallWaiting.push(() => acquireBeat(scene, d, spec.hero, weaponIconId(spec.weaponId), 'star', spec.name, 'NEW WEAPON', false));
}

/** New charm: the same flight, smaller and violet (~0.62 s). */
export function playNewCharm(scene: Phaser.Scene, spec: NewCharmSpec): void {
  const d = director(scene);
  d.smallWaiting.push(() => acquireBeat(scene, d, spec.hero, charmIconId(spec.charmId), 'ring', spec.name, 'NEW CHARM', true));
}

// ─────────────────────────── evolution ───────────────────────────

/** Gameplay scale at cinematic time t (1 = normal). */
function evoDilation(t: number): number {
  const s = EVO.dilation;
  if (t < EVO.dilateInMs) return 1 + (s - 1) * outQuad(t / EVO.dilateInMs);
  if (t < EVO.dilateHoldMs) return s;
  return s + (1 - s) * inQuad(span(t, EVO.dilateHoldMs, EVO.dilateOutMs));
}

/** Scene-clock ms the cinematic spans (the toast lane's hold runs on the dilated scene clock). */
function evoSceneMs(dilated: boolean, speed: number): number {
  if (!dilated) return EVO.totalMs / speed;
  let ms = 0;
  for (let t = 0; t < EVO.totalMs; t += 10) ms += evoDilation(t) * 10;
  return ms / speed;
}

function evolutionBeat(scene: Phaser.Scene, d: Director, spec: EvolutionSpec): Beat {
  const calm = audioSettings().reduceMotion;
  const fx = sparks(scene, d);
  const hero = spec.hero;
  const hp = { x: 0, y: 0 };
  heroScreen(scene, hero, hp);
  holdToasts(scene, evoSceneMs(!calm, calm ? REDUCED_SPEED : 1) + 200);

  // Screen: vignette + dim (one Graphics, drawn once).
  const vignette = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.vignette).setAlpha(0);
  vignette.fillStyle(INK, 0.38);
  vignette.fillRect(0, 0, VIEW.width, VIEW.height);
  for (let i = 0; i < 10; i += 1) {
    const inset = i * 16;
    vignette.lineStyle(32, INK, 0.12);
    vignette.strokeRect(inset, inset, VIEW.width - inset * 2, VIEW.height - inset * 2);
  }
  vignette.lineStyle(6, HERO_FX.violet, 0.35);
  vignette.strokeRect(3, 3, VIEW.width - 6, VIEW.height - 6);

  const glow = scene.textures.exists('fx-lightpool')
    ? scene.add.image(STAGE.x, STAGE.y, 'fx-lightpool')
    : scene.add.image(STAGE.x, STAGE.y, TEX.disc);
  glow.setScrollFactor(0).setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD).setTint(HERO_FX.violet).setAlpha(0);
  const glowBase = 460 / Math.max(1, glow.width);

  const halo = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.glow + 1).setPosition(STAGE.x, STAGE.y).setAlpha(0);
  halo.lineStyle(4, GILT, 0.9);
  for (let i = 0; i < 12; i += 1) {
    const a0 = (i / 12) * Math.PI * 2;
    halo.beginPath();
    halo.arc(0, 0, 112, a0, a0 + 0.3);
    halo.strokePath();
  }
  halo.lineStyle(2, HERO_FX.bone, 0.6);
  halo.strokeCircle(0, 0, 96);

  const wIcon = iconFor(scene, weaponIconId(spec.weaponId), EVO.iconSize, HERO_FX.cyan, 'star');
  const cIcon = iconFor(scene, charmIconId(spec.charmId), EVO.iconSize, HERO_FX.violet, 'ring');
  const eIcon = iconFor(scene, weaponIconId(spec.weaponId, true), EVO.evoSize, GILT, 'star');
  const wBase = wIcon.scale;
  const cBase = cIcon.scale;
  const eBase = eIcon.scale;
  for (const img of [wIcon, cIcon, eIcon]) img.setScrollFactor(0).setDepth(DEPTH.icons).setAlpha(0);
  const wLabel = scene.add.text(0, 0, spec.fromName, textStyle(22, CSS.ink, false)).setOrigin(0.5, 0);
  const cLabel = scene.add.text(0, 0, charmName(spec.charmId), textStyle(22, CSS.secondary, false)).setOrigin(0.5, 0);

  const GHOSTS = 6;
  const ghosts: Phaser.GameObjects.Image[] = [];
  for (let i = 0; i < GHOSTS; i += 1) {
    const g = iconFor(scene, weaponIconId(spec.weaponId, true), EVO.evoSize, GILT, 'star');
    g.setScrollFactor(0).setDepth(DEPTH.icons - 1).setBlendMode(Phaser.BlendModes.ADD).setTint(GILT).setAlpha(0);
    ghosts.push(g);
  }
  const trail: Array<{ x: number; y: number; s: number }> = [];
  const streak = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.icons - 2);

  const flare = scene.add.image(STAGE.x, STAGE.y, TEX.disc).setScrollFactor(0).setDepth(DEPTH.icons + 2);
  flare.setBlendMode(Phaser.BlendModes.ADD).setTint(HERO_FX.bone).setAlpha(0);
  const flareBase = 80 / Math.max(1, flare.width);
  const arrival = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.icons + 2);

  const title = scene.add.text(STAGE.x, STAGE.y - 190, 'EVOLVED', textStyle(64, CSS.accent)).setOrigin(0.5);
  const nameLine = scene.add
    .text(STAGE.x, STAGE.y + 132, `${spec.fromName}  →  ${spec.toName}`, textStyle(34, CSS.ink))
    .setOrigin(0.5);
  const effect = scene.add
    .text(STAGE.x, STAGE.y + 182, spec.effectLine, { ...textStyle(24, '#6fd6ff', false), wordWrap: { width: 600 } })
    .setOrigin(0.5, 0);
  for (const t of [title, nameLine, effect, wLabel, cLabel]) t.setScrollFactor(0).setDepth(DEPTH.text).setAlpha(0);
  const nameFit = Math.min(1, 640 / Math.max(1, nameLine.width));

  // World: light column + shockwave rings on the hero.
  const columnKey = scene.textures.exists('fx-chest-beam') ? 'fx-chest-beam' : TEX.square;
  const column = scene.add.sprite(hero.x, hero.y, columnKey).setOrigin(0.5, 0.92).setDepth(DEPTH.world);
  column.setBlendMode(Phaser.BlendModes.ADD).setTint(HERO_FX.violet).setAlpha(0);
  if (columnKey === 'fx-chest-beam' && scene.anims.exists('fx-chest-beam')) column.play('fx-chest-beam');
  const core = scene.add.sprite(hero.x, hero.y, columnKey).setOrigin(0.5, 0.92).setDepth(DEPTH.world + 1);
  core.setBlendMode(Phaser.BlendModes.ADD).setTint(HERO_FX.bone).setAlpha(0);
  const colW = 150 / Math.max(1, column.width);
  const colH = 560 / Math.max(1, column.height);
  const rings = scene.add.graphics().setDepth(DEPTH.world);

  // Shove: captured once, eased out over EVO.shoveMs by position (AI rewrites velocity every tick).
  const shoved: Array<{ e: Enemy; dx: number; dy: number }> = [];
  if (!calm && spec.enemies !== undefined) {
    const near: Enemy[] = [];
    spec.enemies.enemiesInRadius(hero.x, hero.y, EVO.shoveR, near);
    for (const e of near) {
      const dx = e.x - hero.x;
      const dy = e.y - hero.y;
      const dist = Math.hypot(dx, dy);
      if (!e.active || dist > EVO.shoveR) continue;
      const push = EVO.shovePx * (1 - dist / EVO.shoveR * 0.6);
      const len = dist || 1;
      shoved.push({ e, dx: (dx / len) * push, dy: (dy / len) * push });
    }
  }

  let skipped = false;
  const beat: Beat = {
    t: UNSTARTED,
    speed: calm ? REDUCED_SPEED : 1,
    totalMs: EVO.totalMs,
    delayMs: 0,
    render: (t, prev) => {
      // Dilation (released at once on skip, restored by destroy()).
      if (!calm) setTimeDilation(scene, 'evolve', skipped ? 1 : evoDilation(t));

      // ── beat 1: world ──
      if (crossed(t, prev, 0)) {
        sfx('choir');
        sfx('whoosh', { rate: 0.7, volume: 0.8 });
      }
      vignette.setAlpha(
        t < EVO.vignetteOutFrom ? outQuad(span(t, 0, EVO.vignetteInMs)) : 1 - outQuad(span(t, EVO.vignetteOutFrom, EVO.vignetteOutMs)),
      );
      const colIn = span(t, 0, 110);
      const colOut = span(t, EVO.columnMs - 300, 300);
      const colX = outBack(colIn, 2.4) * (1 - inQuad(colOut));
      column.setPosition(hero.x, hero.y + 30).setScale(colW * colX, colH * (0.7 + 0.3 * outCubic(colIn)));
      column.setAlpha(colIn > 0 ? (1 - colOut) * (0.85 + 0.15 * Math.sin(t * 0.05)) : 0);
      core.setPosition(hero.x, hero.y + 30).setScale(colW * 0.4 * colX, colH * 0.95).setAlpha((1 - colOut) * 0.9);
      rings.clear();
      const ringColors = [HERO_FX.violet, HERO_FX.bone, HERO_FX.cyan];
      for (let i = 0; i < 3; i += 1) {
        const p = span(t, i * EVO.ringStaggerMs, EVO.ringMs);
        if (p <= 0 || p >= 1) continue;
        const r = 20 + (EVO.ringMaxR - 20) * outCubic(p);
        rings.lineStyle(10 * (1 - p) + 2, ringColors[i] ?? HERO_FX.violet, 0.9 * (1 - p));
        rings.strokeEllipse(hero.x, hero.y + 20, r * 2, r * 1.1);
      }
      if (shoved.length > 0 && prev < EVO.shoveMs) {
        const k = outCubic(span(t, 0, EVO.shoveMs)) - outCubic(span(prev, 0, EVO.shoveMs));
        for (const s of shoved) if (s.e.active) s.e.setPosition(s.e.x + s.dx * k, s.e.y + s.dy * k);
      }

      // ── beat 2: composition ──
      const glowIn = outCubic(span(t, 250, 200));
      const glowOut = span(t, EVO.flyOutFrom - 50, 300);
      glow.setAlpha(0.6 * glowIn * (1 - glowOut) + (t >= EVO.mergeAt ? 0.25 * (1 - span(t, EVO.mergeAt, 400)) : 0));
      glow.setScale(glowBase * (0.4 + 0.6 * glowIn + 0.25 * outCubic(span(t, EVO.mergeAt, 300))));
      glow.setRotation(t * 0.0006);

      if (crossed(t, prev, EVO.flyInFrom)) sfx('whoosh', { rate: 1.3, volume: 0.5 });
      const fly = span(t, EVO.flyInFrom, EVO.mergeAt - EVO.flyInFrom);
      const merged = t >= EVO.mergeAt;
      if (t >= EVO.flyInFrom && !merged) {
        const e = inCubic(fly);
        const appear = outBack(span(t, EVO.flyInFrom, 160));
        const arc = Math.sin(Math.PI * fly) * 90;
        const wx = 150 + (STAGE.x - 150) * e;
        const cx = VIEW.width - 150 - (VIEW.width - 300 - STAGE.x + 150) * e;
        wIcon.setPosition(wx, STAGE.y - arc).setScale(wBase * appear * (1 - 0.35 * e)).setAlpha(1).setRotation(-0.5 * e);
        cIcon.setPosition(cx, STAGE.y + arc).setScale(cBase * appear * (1 - 0.35 * e)).setAlpha(1).setRotation(0.5 * e);
        const labelA = 1 - span(t, EVO.flyInFrom + 260, 160);
        wLabel.setPosition(wx, STAGE.y - arc + 72).setAlpha(appear * labelA);
        cLabel.setPosition(cx, STAGE.y + arc + 72).setAlpha(appear * labelA);
        if (fx.violet.getAliveParticleCount() < 60) {
          fx.cyan.emitParticleAt(wx, STAGE.y - arc, 1);
          fx.violet.emitParticleAt(cx, STAGE.y + arc, 1);
        }
      } else {
        wIcon.setAlpha(0);
        cIcon.setAlpha(0);
        wLabel.setAlpha(0);
        cLabel.setAlpha(0);
      }

      if (crossed(t, prev, EVO.mergeAt)) {
        fx.violet.explode(22, STAGE.x, STAGE.y);
        fx.bone.explode(14, STAGE.x, STAGE.y);
        fx.cyan.explode(10, STAGE.x, STAGE.y);
        sfx('hit', { rate: 0.6, volume: 0.7 });
        sfxArp('levelup', 4, { rate: 1.1, volume: 0.5 });
        if (!calm && !skipped) shake(scene, 0.006, 180);
      }
      if (crossed(t, prev, EVO.mergeAt + 40)) fx.gilt.explode(12, STAGE.x, STAGE.y);
      const fl = span(t, EVO.mergeAt, 300);
      flare.setAlpha(fl > 0 && fl < 1 ? 1 - outQuad(fl) : 0).setScale(flareBase * (0.3 + 3.2 * outCubic(fl)));

      // Evolved icon: pop in, bob, then fly to the build button.
      let ex = STAGE.x;
      let ey = STAGE.y;
      let es = 0;
      if (merged) {
        const pop = outBack(span(t, EVO.mergeAt, EVO.popMs), 2.2);
        es = pop;
        ey += Math.sin((t - EVO.mergeAt) * 0.008) * 6;
        const out = span(t, EVO.flyOutFrom, EVO.arriveAt - EVO.flyOutFrom);
        if (out > 0) {
          const e = inCubic(out);
          ex = STAGE.x + (BUILD_TARGET.x - STAGE.x) * e;
          ey = ey + (BUILD_TARGET.y - ey) * e - Math.sin(Math.PI * out) * 60;
          es = 1 - 0.7 * e;
        }
        const arrived = t >= EVO.arriveAt;
        eIcon.setPosition(ex, ey).setScale(eBase * es).setAlpha(arrived ? 0 : 1);
        halo.setPosition(ex, ey).setScale(es).setRotation(t * 0.002).setAlpha(arrived ? 0 : pop > 0 ? 1 - out : 0);
        if (out > 0 && !arrived) {
          trail.unshift({ x: ex, y: ey, s: es });
          if (trail.length > GHOSTS * 2) trail.length = GHOSTS * 2;
        }
      }
      const flying = t >= EVO.flyOutFrom && t < EVO.arriveAt;
      streak.clear();
      for (let i = 0; i < GHOSTS; i += 1) {
        const g = ghosts[i];
        const p = trail[i * 2];
        if (g === undefined) continue;
        if (!flying || p === undefined) {
          g.setAlpha(0);
          continue;
        }
        g.setPosition(p.x, p.y).setScale(eBase * p.s * (1 - i * 0.08)).setAlpha(0.45 * (1 - i / GHOSTS));
      }
      if (flying && trail.length > 1) {
        for (let i = 1; i < trail.length; i += 1) {
          const a = trail[i - 1];
          const b = trail[i];
          if (a === undefined || b === undefined) continue;
          streak.lineStyle(14 * (1 - i / trail.length) + 2, GILT, 0.7 * (1 - i / trail.length));
          streak.lineBetween(a.x, a.y, b.x, b.y);
        }
      }
      if (crossed(t, prev, EVO.flyOutFrom)) sfx('whoosh', { rate: 1.6, volume: 0.4 });

      // Titles.
      const textOut = 1 - span(t, EVO.textOutFrom, EVO.textOutMs);
      const ti = span(t, EVO.titleAt, EVO.textInMs);
      title.setAlpha(outQuad(ti) * textOut).setScale(0.7 + 0.3 * outBack(ti) + 0.08 * (1 - textOut));
      const ni = span(t, EVO.nameAt, EVO.textInMs);
      nameLine.setAlpha(outQuad(ni) * textOut).setScale(nameFit * (0.85 + 0.15 * outBack(ni)));
      const fi = span(t, EVO.effectAt, EVO.textInMs);
      effect.setAlpha(outQuad(fi) * textOut).setY(STAGE.y + 182 + 16 * (1 - outCubic(fi)));

      // ── beat 3: arrival ──
      if (crossed(t, prev, EVO.arriveAt)) {
        fx.gilt.explode(14, BUILD_TARGET.x, BUILD_TARGET.y);
        fx.violet.explode(8, BUILD_TARGET.x, BUILD_TARGET.y);
        sfx('pickup', { rate: 1.2, volume: 0.6 });
      }
      arrival.clear();
      const ar = span(t, EVO.arriveAt, EVO.arrivalRingMs);
      if (ar > 0 && ar < 1) {
        arrival.lineStyle(6 * (1 - ar) + 2, GILT, 1 - ar);
        arrival.strokeCircle(BUILD_TARGET.x, BUILD_TARGET.y, 24 + 46 * outCubic(ar));
      }
    },
    destroy: () => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onTap);
      for (const o of [vignette, glow, halo, wIcon, cIcon, eIcon, wLabel, cLabel, streak, flare, arrival, title, nameLine, effect, column, core, rings, ...ghosts]) {
        o.destroy();
      }
      if (d.closing) return;
      setTimeDilation(scene, 'evolve', 1);
      if (spec.weapons !== undefined) d.flourish.push(flourishBeat(scene, d, spec.hero, spec.weapons, spec.weaponId));
    },
  };
  const onTap = (): void => {
    if (skipped || beat.t < SKIP_ARM_MS) return;
    skipped = true;
    beat.speed = SKIP_SPEED;
    setTimeDilation(scene, 'evolve', 1);
  };
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, onTap);
  // First frame of acknowledgement lands this frame, not next.
  beat.render(0, UNSTARTED);
  beat.t = 0;
  return beat;
}

// ─────────────────────────── flourish ───────────────────────────

/**
 * The evolved weapon's first FLOURISH.count attacks: a violet silhouette pulse
 * on the hero, a cyan ring and a rising chime. Attacks are read off the slot's
 * cooldown jumping up (the weapon just fired); Bone Halo spins continuously, so
 * it pulses on a fixed cadence instead.
 */
function flourishBeat(scene: Phaser.Scene, d: Director, hero: Hero, weapons: WeaponSlots, id: WeaponId): Beat {
  const fx = sparks(scene, d);
  const ghost = scene.add.image(hero.x, hero.y, hero.texture.key, hero.frame.name).setDepth(DEPTH.world);
  ghost.setBlendMode(Phaser.BlendModes.ADD).setTint(HERO_FX.violet).setTintMode(Phaser.TintModes.FILL).setAlpha(0);
  const ring = scene.add.graphics().setDepth(DEPTH.world);
  const hp = { x: 0, y: 0 };
  let lastCd = weapons.equipped().find((w) => w.id === id)?.cooldownMs ?? 0;
  let fired = 0;
  let pulseAt = -Infinity;
  const beat: Beat = {
    t: UNSTARTED,
    speed: 1,
    totalMs: FLOURISH.windowMs,
    delayMs: 0,
    render: (t) => {
      const slot = weapons.equipped().find((w) => w.id === id);
      let fire = false;
      if (slot !== undefined) {
        if (id === 'orbit') fire = fired < FLOURISH.count && t - pulseAt >= FLOURISH.orbitGapMs;
        else fire = slot.cooldownMs > lastCd + 1;
        lastCd = slot.cooldownMs;
      }
      if (fire && fired < FLOURISH.count) {
        fired += 1;
        pulseAt = t;
        heroScreen(scene, hero, hp);
        fx.cyan.explode(8, hp.x, hp.y);
        sfx('combo', { rate: 0.8 + fired * 0.12, volume: 0.35 });
      }
      const p = span(t, pulseAt, FLOURISH.ms);
      const live = p > 0 && p < 1;
      ghost
        .setTexture(hero.texture.key, hero.frame.name)
        .setPosition(hero.x, hero.y)
        .setOrigin(hero.originX, hero.originY)
        .setDisplaySize(hero.displayWidth * (1 + 0.15 * p), hero.displayHeight * (1 + 0.15 * p))
        .setFlipX(hero.flipX)
        .setAlpha(live ? 0.7 * (1 - outQuad(p)) : 0);
      ring.clear();
      if (live) {
        ring.lineStyle(6 * (1 - p) + 2, HERO_FX.cyan, 0.9 * (1 - p));
        ring.strokeCircle(hero.x, hero.y, 30 + 90 * outCubic(p));
      }
      // Done early once every flourish played out.
      if (fired >= FLOURISH.count && p >= 1) beat.t = beat.totalMs;
    },
    destroy: () => {
      ghost.destroy();
      ring.destroy();
    },
  };
  return beat;
}

// ─────────────────────────── small beats ───────────────────────────

const RANK = { totalMs: 520, popMs: 160, fillAt: 180, fadeFrom: 380, pip: 18, gap: 26, iconSize: 72, rise: 110 } as const;

function rankUpBeat(scene: Phaser.Scene, d: Director, spec: RankUpSpec): Beat {
  const fx = sparks(scene, d);
  const hp = { x: 0, y: 0 };
  const icon = iconFor(scene, weaponIconId(spec.weaponId), RANK.iconSize, HERO_FX.cyan, 'star');
  const base = icon.scale;
  icon.setScrollFactor(0).setDepth(DEPTH.icons).setAlpha(0);
  const pips = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.icons);
  const label = scene.add.text(0, 0, `RANK ${spec.rank}`, textStyle(22, '#6fd6ff')).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.text);
  const diamond = (x: number, y: number, h: number): void => {
    pips.beginPath();
    pips.moveTo(x, y - h);
    pips.lineTo(x + h, y);
    pips.lineTo(x, y + h);
    pips.lineTo(x - h, y);
    pips.closePath();
  };
  const drawPip = (x: number, y: number, size: number, filled: boolean, color: number): void => {
    const h = size / 2;
    pips.fillStyle(INK, 0.85);
    diamond(x, y, h + 3);
    pips.fillPath();
    diamond(x, y, h);
    if (filled) {
      pips.fillStyle(color, 1);
      pips.fillPath();
    } else {
      pips.lineStyle(2, HERO_FX.bone, 0.6);
      pips.strokePath();
    }
  };
  return {
    t: UNSTARTED,
    speed: 1,
    totalMs: RANK.totalMs,
    delayMs: 0,
    render: (t, prev) => {
      heroScreen(scene, spec.hero, hp);
      const fade = 1 - span(t, RANK.fadeFrom, RANK.totalMs - RANK.fadeFrom);
      const rise = 14 * outQuad(span(t, RANK.fadeFrom, RANK.totalMs - RANK.fadeFrom));
      const cx = hp.x;
      const cy = hp.y - RANK.rise - rise;
      if (crossed(t, prev, 0)) sfx('tap', { rate: 1.2, volume: 0.6 });
      const pop = outBack(span(t, 0, RANK.popMs), 2.2);
      icon.setPosition(cx, cy).setScale(base * pop).setAlpha(fade);
      label.setPosition(cx, cy - 52).setAlpha(fade * outQuad(span(t, 60, 120)));
      pips.clear();
      pips.setAlpha(fade);
      const py = cy + 52;
      const x0 = cx - ((spec.maxRank - 1) * RANK.gap) / 2;
      const fill = span(t, RANK.fillAt, 140);
      for (let i = 0; i < spec.maxRank; i += 1) {
        const isNew = i === spec.rank - 1;
        const filled = i < spec.rank - 1 || (isNew && fill > 0);
        const size = isNew && fill > 0 ? RANK.pip * (1 + 0.8 * (1 - outCubic(fill))) : RANK.pip;
        drawPip(x0 + i * RANK.gap, py, size, filled, isNew ? HERO_FX.cyan : HERO_FX.bone);
      }
      if (crossed(t, prev, RANK.fillAt)) {
        fx.cyan.explode(8, x0 + (spec.rank - 1) * RANK.gap, py);
        sfx('pickup', { rate: 0.9 + 0.12 * spec.rank, volume: 0.5 });
      }
    },
    destroy: () => {
      icon.destroy();
      pips.destroy();
      label.destroy();
    },
  };
}

function acquireBeat(
  scene: Phaser.Scene,
  d: Director,
  hero: Hero,
  iconId: string,
  shape: 'star' | 'ring',
  name: string,
  kind: string,
  small: boolean,
): Beat {
  const fx = sparks(scene, d);
  const hp = { x: 0, y: 0 };
  const size = small ? 72 : 96;
  const tone = small ? HERO_FX.violet : HERO_FX.cyan;
  const T = small
    ? { totalMs: 620, popMs: 160, holdTo: 260, arriveAt: 520, ringMs: 100 }
    : { totalMs: 760, popMs: 180, holdTo: 320, arriveAt: 640, ringMs: 120 };
  const icon = iconFor(scene, iconId, size, tone, shape);
  const base = icon.scale;
  icon.setScrollFactor(0).setDepth(DEPTH.icons).setAlpha(0);
  const ghosts: Phaser.GameObjects.Image[] = [];
  for (let i = 0; i < 3; i += 1) {
    const g = iconFor(scene, iconId, size, tone, shape);
    g.setScrollFactor(0).setDepth(DEPTH.icons - 1).setBlendMode(Phaser.BlendModes.ADD).setTint(tone).setAlpha(0);
    ghosts.push(g);
  }
  const trail: Array<{ x: number; y: number; s: number }> = [];
  const kindText = scene.add.text(0, 0, kind, textStyle(small ? 16 : 18, small ? CSS.secondary : '#6fd6ff')).setOrigin(0.5);
  const nameText = scene.add.text(0, 0, name, textStyle(small ? 22 : 26, CSS.ink, false)).setOrigin(0.5);
  for (const t of [kindText, nameText]) t.setScrollFactor(0).setDepth(DEPTH.text).setAlpha(0);
  const rings = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.icons - 1);
  let startX = 0;
  let startY = 0;
  return {
    t: UNSTARTED,
    speed: 1,
    totalMs: T.totalMs,
    delayMs: 0,
    render: (t, prev) => {
      if (crossed(t, prev, 0)) {
        heroScreen(scene, hero, hp);
        fx[small ? 'violet' : 'cyan'].explode(small ? 6 : 10, hp.x, hp.y);
        sfx('pickup', { rate: small ? 1.15 : 1, volume: small ? 0.4 : 0.55 });
      }
      let x: number;
      let y: number;
      let s: number;
      const out = span(t, T.holdTo, T.arriveAt - T.holdTo);
      if (out <= 0) {
        heroScreen(scene, hero, hp);
        startX = hp.x;
        startY = hp.y - (small ? 100 : 120);
        x = startX;
        y = startY - 8 * outQuad(span(t, 0, T.holdTo));
        s = outBack(span(t, 0, T.popMs), 2.2);
      } else {
        const e = inCubic(out);
        x = startX + (BUILD_TARGET.x - startX) * e;
        y = startY + (BUILD_TARGET.y - startY) * e;
        s = 1 - 0.6 * e;
      }
      if (crossed(t, prev, T.holdTo)) sfx('whoosh', { rate: 1.5, volume: 0.35 });
      const arrived = t >= T.arriveAt;
      icon.setPosition(x, y).setScale(base * s).setAlpha(arrived ? 0 : 1);
      const labelA = outQuad(span(t, 40, 100)) * (1 - span(t, T.holdTo - 40, 100));
      kindText.setPosition(startX, startY - size * 0.5 - 14).setAlpha(labelA);
      nameText.setPosition(startX, startY + size * 0.5 + 18).setAlpha(labelA);
      if (out > 0 && !arrived) {
        trail.unshift({ x, y, s });
        if (trail.length > 6) trail.length = 6;
      }
      for (let i = 0; i < ghosts.length; i += 1) {
        const g = ghosts[i];
        const p = trail[i * 2 + 1];
        if (g === undefined) continue;
        if (p === undefined || arrived || out <= 0) g.setAlpha(0);
        else g.setPosition(p.x, p.y).setScale(base * p.s).setAlpha(0.4 * (1 - i / ghosts.length));
      }
      rings.clear();
      const r0 = span(t, 0, 260);
      if (r0 > 0 && r0 < 1) {
        rings.lineStyle(6 * (1 - r0) + 2, tone, 0.85 * (1 - r0));
        rings.strokeCircle(startX, startY + (small ? 100 : 120), 24 + (small ? 70 : 100) * outCubic(r0));
      }
      if (crossed(t, prev, T.arriveAt)) {
        fx[small ? 'violet' : 'gilt'].explode(small ? 6 : 10, BUILD_TARGET.x, BUILD_TARGET.y);
        sfx('tap', { rate: 1.3, volume: 0.5 });
      }
      const ar = span(t, T.arriveAt, T.ringMs);
      if (ar > 0 && ar < 1) {
        rings.lineStyle(5 * (1 - ar) + 2, small ? tone : GILT, 1 - ar);
        rings.strokeCircle(BUILD_TARGET.x, BUILD_TARGET.y, 22 + 30 * outCubic(ar));
      }
    },
    destroy: () => {
      icon.destroy();
      for (const g of ghosts) g.destroy();
      kindText.destroy();
      nameText.destroy();
      rings.destroy();
    },
  };
}
