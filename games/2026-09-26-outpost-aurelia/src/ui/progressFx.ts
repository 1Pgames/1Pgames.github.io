import Phaser from 'phaser';
import { CSS, FONT, PALETTE, VIEW } from '../config';
import { playerSettings, sfx, sfxArp } from '../core/audio';
import { shake } from '../core/juice';
import { TEX } from '../core/keys';
import { iconImage } from './widgets';

/**
 * PROGRESSION BEATS — the mandatory "you are getting stronger" feel rows
 * (ported from Duskhaul's evolution ceremonies). Three beats on one engine:
 *
 * | beat        | length  | what the player sees                                                    |
 * |-------------|---------|-------------------------------------------------------------------------|
 * | evolution   | 2150 ms | gameplay dilated ×0.2, vignette, light column + rings on the anchor,    |
 * |             |         | ingredient icons fly in and merge, flare, title / names / effect line,  |
 * |             |         | result flies to `target` (the build/pause button)                        |
 * | rank-up     | 520 ms  | icon pop + pip fill over the anchor                                     |
 * | acquire     | 620-760 | new weapon/charm/item: icon pops over the anchor, flies to `target`     |
 *
 * Every beat is a pure function of its own REAL-TIME clock (`game.loop.delta`
 * on POST_UPDATE): the cinematic dilates the scene's gameplay clock and must
 * not slow with it. No tween is created; every object is owned by its beat and
 * destroyed on finish or on scene SHUTDOWN. A paused scene freezes its beats.
 *
 * Dilation: while a cinematic plays, `scene.time.timeScale` and the Arcade
 * world follow it; a slice that integrates its own sim from `update(delta)`
 * multiplies that delta by `beatTimeScale(scene)`.
 *
 * Skip: a tap ≥ 250 ms into the cinematic fast-forwards it ×4 through the SAME
 * timeline (merge, title and fly-in still resolve) and releases the dilation
 * at once. Input is never blocked — the skipping tap still reaches the game.
 *
 * Reduce motion (`playerSettings().reduceMotion`, the Settings sheet toggle,
 * defaulting to the OS preference): no dilation and no shake, and the
 * cinematic runs ×1.35.
 *
 * Icons are texture keys; a key that is not loaded skips that layer (and
 * `ui/widgets.ts iconImage` warns) — never a placeholder glyph. Screen layers
 * draw on the MAIN camera: in a hub scene with `ScrollView`/sheet cameras,
 * close overlays first or the beat renders under them.
 */

/** A world object the beat anchors to (the hero sprite); read live every frame. */
export interface BeatAnchor {
  readonly x: number;
  readonly y: number;
}

/** Screen point a reward flies into (the HUD build/pause button). */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface EvolutionSpec {
  /** Name of the piece that evolves ("Bone Bolt"). */
  fromName: string;
  /** Name of the evolved result ("Ossuary Lance"). */
  toName: string;
  /** Partner/catalyst name shown under its icon; omit for a single-ingredient evolution. */
  withName?: string;
  /** One line of what changed, under the names. */
  effectLine?: string;
  /** Headline; default `EVOLVED`. */
  title?: string;
  fromIcon?: string;
  withIcon?: string;
  resultIcon?: string;
  /** World anchor for the light column and shockwave rings; omit for a screen-only cinematic. */
  anchor?: BeatAnchor;
  /** Where the result flies at the end; omit and it fades in place. */
  target?: ScreenPoint;
  onDone?(): void;
}

export interface RankUpSpec {
  anchor: BeatAnchor;
  /** Rank AFTER the boost (2..maxRank). */
  rank: number;
  maxRank: number;
  icon?: string;
  /** Default `RANK <rank>`. */
  label?: string;
}

export interface AcquireSpec {
  anchor: BeatAnchor;
  /** The new thing's name. */
  name: string;
  /** Kicker above it: `NEW WEAPON`, `NEW CHARM`, `NEW ITEM`… */
  kind: string;
  icon?: string;
  target?: ScreenPoint;
  /** Smaller, `secondary`-toned variant (passives/charms). */
  small?: boolean;
}

// ─────────────────────────── timing & layout ───────────────────────────

/** Over the HUD (1000), under the pause button (1500) and draft cards (2000). */
const DEPTH = { world: 880, vignette: 1100, glow: 1102, icons: 1104, text: 1106 } as const;
/** Centre of the evolution composition (clear of the HUD band and the thumb zone). */
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
  resultSize: 168,
} as const;

const REDUCED_SPEED = 1.35;
const SKIP_ARM_MS = 250;
const SKIP_SPEED = 4;
/** Small beats alive at once (extra ones wait); consecutive starts are staggered by this. */
const SMALL_MAX = 3;
const SMALL_STAGGER_MS = 140;
/** Vertical spacing between concurrent small beats over one anchor. */
const LANE_PX = 160;
const GLOW_TEX = 'progress-fx-glow';
/** Beats start here so `crossed(t, prev, 0)` fires exactly once, on the first rendered frame. */
const UNSTARTED = -1;

// ─────────────────────────── easing ───────────────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (t: number, from: number, ms: number): number => clamp01((t - from) / ms);
const outQuad = (p: number): number => 1 - (1 - p) * (1 - p);
const outCubic = (p: number): number => 1 - (1 - p) ** 3;
const inCubic = (p: number): number => p * p * p;
const inQuad = (p: number): number => p * p;
const outBack = (p: number, s = 1.9): number => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2;
/** True on the frame the beat clock crosses `at` (works under fast-forward too). */
const crossed = (t: number, prev: number, at: number): boolean => prev < at && t >= at;

/** Armoured text: beats draw straight over the play field. */
function beatText(scene: Phaser.Scene, text: string, size: number, color: string, display = true): Phaser.GameObjects.Text {
  return scene.add
    .text(0, 0, text, {
      fontFamily: display ? FONT.display : FONT.family,
      fontSize: `${size}px`,
      color,
      align: 'center',
      stroke: '#05070d',
      strokeThickness: Math.min(6, Math.max(2, Math.round(size / 12))),
      shadow: { offsetX: 0, offsetY: 3, color: '#05070d', blur: 6, stroke: true, fill: true },
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(DEPTH.text)
    .setAlpha(0);
}

/** Beat icon on the screen layer, or null when the key is absent. */
function beatIcon(scene: Phaser.Scene, key: string | undefined, size: number, depth: number = DEPTH.icons): Phaser.GameObjects.Image | null {
  const img = key === undefined ? null : iconImage(scene, key, size);
  img?.setScrollFactor(0).setDepth(depth).setAlpha(0);
  return img;
}

/** Soft radial light (white → transparent), generated once per game: glow, flare and the light column. */
function glowTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(GLOW_TEX)) return GLOW_TEX;
  const tex = scene.textures.createCanvas(GLOW_TEX, 128, 128);
  if (tex === null) return TEX.particle;
  const c = tex.getContext();
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  tex.refresh();
  return GLOW_TEX;
}

function toScreen(scene: Phaser.Scene, anchor: BeatAnchor, out: ScreenPoint): ScreenPoint {
  const cam = scene.cameras.main;
  out.x = (anchor.x - cam.worldView.x) * cam.zoom;
  out.y = (anchor.y - cam.worldView.y) * cam.zoom;
  return out;
}

// ─────────────────────────── engine ───────────────────────────

interface Beat {
  /** Beat ms since start (speed-scaled). */
  t: number;
  speed: number;
  readonly totalMs: number;
  /** Real ms to wait before `t` starts advancing (small-beat stagger). */
  delayMs: number;
  /** Small beats: vertical slot over the anchor, so concurrent beats never overlap. */
  lane?: number;
  render(t: number, prevT: number): void;
  destroy(): void;
}

/** Screen-space particle emitters shared by every beat of a scene, one per tone. */
type Sparks = Record<'primary' | 'secondary' | 'ink' | 'accent', Phaser.GameObjects.Particles.ParticleEmitter>;

interface Director {
  cinematic: Beat | null;
  queue: EvolutionSpec[];
  small: Beat[];
  smallWaiting: Array<(lane: number) => Beat>;
  lastSmallStartMs: number;
  sparks: Sparks | null;
  realMs: number;
  /** Current cinematic dilation (1 = normal). */
  timeScale: number;
  /** Scene is shutting down: beats release objects only. */
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
    sparks: null,
    realMs: 0,
    timeScale: 1,
    closing: false,
  };
  directors.set(scene, d);
  const tick = (): void => step(scene, d, scene.game.loop.delta);
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    d.closing = true;
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, tick);
    d.cinematic?.destroy();
    for (const b of d.small) b.destroy();
    if (d.sparks !== null) for (const e of Object.values(d.sparks)) e.destroy();
    directors.delete(scene);
  });
  return d;
}

/** Writes the cinematic dilation to the scene's engine clocks (timers, Arcade). */
function dilate(scene: Phaser.Scene, d: Director, scale: number): void {
  if (d.closing || d.timeScale === scale) return;
  d.timeScale = scale;
  scene.time.timeScale = scale;
  const world = (scene as { physics?: { world?: { timeScale: number } } }).physics?.world;
  if (world) world.timeScale = 1 / Math.max(scale, 0.0001);
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
  d.sparks = { primary: make(PALETTE.primary), secondary: make(PALETTE.secondary), ink: make(PALETTE.ink), accent: make(PALETTE.accent) };
  return d.sparks;
}

/** Advances one beat; true when it finished (and was destroyed). */
function advance(beat: Beat, dt: number): boolean {
  let real = dt;
  if (beat.delayMs > 0) {
    beat.delayMs -= real;
    if (beat.delayMs > 0) return false;
    real = -beat.delayMs;
    beat.delayMs = 0;
  }
  const prev = beat.t;
  beat.t = Math.min(beat.totalMs, Math.max(0, beat.t) + real * beat.speed);
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
    let lane = 0;
    while (d.small.some((b) => b.lane === lane)) lane += 1;
    const beat = make(lane);
    beat.lane = lane;
    beat.delayMs = Math.max(0, SMALL_STAGGER_MS - (d.realMs - d.lastSmallStartMs));
    d.lastSmallStartMs = d.realMs + beat.delayMs;
    d.small.push(beat);
  }
}

// ─────────────────────────── public API ───────────────────────────

/**
 * Evolution cinematic (~2.15 s; ~1.6 s reduced-motion; ≤ 0.55 s once
 * skipped). One at a time per scene — a call while one plays is queued.
 */
export function playEvolution(scene: Phaser.Scene, spec: EvolutionSpec): void {
  const d = director(scene);
  if (d.cinematic !== null) {
    d.queue.push(spec);
    return;
  }
  d.cinematic = evolutionBeat(scene, d, spec);
}

/** True while an evolution cinematic plays or is queued (hold draft cards / spawns on it). */
export function evolutionPlaying(scene: Phaser.Scene): boolean {
  const d = directors.get(scene);
  return d !== undefined && (d.cinematic !== null || d.queue.length > 0);
}

/** Gameplay time scale the cinematic currently imposes (1 = normal): multiply a hand-integrated sim delta by it. */
export function beatTimeScale(scene: Phaser.Scene): number {
  return directors.get(scene)?.timeScale ?? 1;
}

/** Rank-up: the icon pops and the new pip fills over the anchor (~0.5 s). */
export function playRankUp(scene: Phaser.Scene, spec: RankUpSpec): void {
  const d = director(scene);
  d.smallWaiting.push((lane) => rankUpBeat(scene, d, spec, lane));
}

/** New weapon / charm / item: the icon pops over the anchor, then flies to `target` (~0.6-0.76 s). */
export function playAcquire(scene: Phaser.Scene, spec: AcquireSpec): void {
  const d = director(scene);
  d.smallWaiting.push((lane) => acquireBeat(scene, d, spec, lane));
}

// ─────────────────────────── evolution ───────────────────────────

/** Gameplay scale at cinematic time t (1 = normal). */
function evoDilation(t: number): number {
  const s = EVO.dilation;
  if (t < EVO.dilateInMs) return 1 + (s - 1) * outQuad(t / EVO.dilateInMs);
  if (t < EVO.dilateHoldMs) return s;
  return s + (1 - s) * inQuad(span(t, EVO.dilateHoldMs, EVO.dilateOutMs));
}

function evolutionBeat(scene: Phaser.Scene, d: Director, spec: EvolutionSpec): Beat {
  const calm = playerSettings().reduceMotion;
  const fx = sparks(scene, d);
  const target = spec.target;
  const anchor = spec.anchor;

  const vignette = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.vignette).setAlpha(0);
  vignette.fillStyle(PALETTE.bgDeep, 0.38);
  vignette.fillRect(0, 0, VIEW.width, VIEW.height);
  for (let i = 0; i < 10; i += 1) {
    const inset = i * 16;
    vignette.lineStyle(32, PALETTE.bgDeep, 0.12);
    vignette.strokeRect(inset, inset, VIEW.width - inset * 2, VIEW.height - inset * 2);
  }
  vignette.lineStyle(6, PALETTE.secondary, 0.35);
  vignette.strokeRect(3, 3, VIEW.width - 6, VIEW.height - 6);

  const glow = scene.add.image(STAGE.x, STAGE.y, glowTexture(scene)).setScrollFactor(0).setDepth(DEPTH.glow);
  glow.setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.secondary).setAlpha(0);
  const glowBase = 460 / Math.max(1, glow.width);
  const halo = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.glow + 1).setPosition(STAGE.x, STAGE.y).setAlpha(0);
  halo.lineStyle(4, PALETTE.accent, 0.9);
  for (let i = 0; i < 12; i += 1) {
    const a0 = (i / 12) * Math.PI * 2;
    halo.beginPath();
    halo.arc(0, 0, 112, a0, a0 + 0.3);
    halo.strokePath();
  }
  halo.lineStyle(2, PALETTE.ink, 0.6);
  halo.strokeCircle(0, 0, 96);

  const fromIcon = beatIcon(scene, spec.fromIcon, EVO.iconSize);
  const withIcon = beatIcon(scene, spec.withIcon, EVO.iconSize);
  const resultIcon = beatIcon(scene, spec.resultIcon, EVO.resultSize);
  const fromBase = fromIcon?.scale ?? 1;
  const withBase = withIcon?.scale ?? 1;
  const resultBase = resultIcon?.scale ?? 1;
  const fromLabel = beatText(scene, spec.fromName, 22, CSS.ink, false);
  const withLabel = spec.withName === undefined ? null : beatText(scene, spec.withName, 22, CSS.secondary, false);
  const streak = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.icons - 2);
  const trail: Array<{ x: number; y: number; s: number }> = [];

  const flare = scene.add.image(STAGE.x, STAGE.y, glowTexture(scene)).setScrollFactor(0).setDepth(DEPTH.icons + 2);
  flare.setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.ink).setAlpha(0);
  const flareBase = 80 / Math.max(1, flare.width);
  const arrival = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.icons + 2);

  const title = beatText(scene, spec.title ?? 'EVOLVED', 64, CSS.accent).setPosition(STAGE.x, STAGE.y - 190);
  const nameLine = beatText(scene, `${spec.fromName}  →  ${spec.toName}`, 34, CSS.ink).setPosition(STAGE.x, STAGE.y + 132);
  const nameFit = Math.min(1, 640 / Math.max(1, nameLine.width));
  const effect = beatText(scene, spec.effectLine ?? '', 24, CSS.primary, false).setOrigin(0.5, 0).setWordWrapWidth(600);

  // World: light column + shockwave rings on the anchor.
  const column = scene.add.image(0, 0, glowTexture(scene)).setOrigin(0.5, 0.92).setDepth(DEPTH.world);
  column.setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.secondary).setAlpha(0);
  const core = scene.add.image(0, 0, glowTexture(scene)).setOrigin(0.5, 0.92).setDepth(DEPTH.world + 1);
  core.setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.ink).setAlpha(0);
  const colW = 150 / Math.max(1, column.width);
  const colH = 560 / Math.max(1, column.height);
  const rings = scene.add.graphics().setDepth(DEPTH.world);
  const ringColors = [PALETTE.secondary, PALETTE.ink, PALETTE.primary];

  let skipped = false;
  const beat: Beat = {
    t: UNSTARTED,
    speed: calm ? REDUCED_SPEED : 1,
    totalMs: EVO.totalMs,
    delayMs: 0,
    render: (t, prev) => {
      if (!calm) dilate(scene, d, skipped ? 1 : evoDilation(t));

      // ── beat 1: world ──
      if (crossed(t, prev, 0)) {
        sfx('levelup', { rate: 0.75 });
        sfx('whoosh', { rate: 0.7, volume: 0.8 });
      }
      vignette.setAlpha(
        t < EVO.vignetteOutFrom ? outQuad(span(t, 0, EVO.vignetteInMs)) : 1 - outQuad(span(t, EVO.vignetteOutFrom, EVO.vignetteOutMs)),
      );
      if (anchor !== undefined) {
        const colIn = span(t, 0, 110);
        const colOut = span(t, EVO.columnMs - 300, 300);
        const colX = outBack(colIn, 2.4) * (1 - inQuad(colOut));
        column.setPosition(anchor.x, anchor.y + 30).setScale(colW * colX, colH * (0.7 + 0.3 * outCubic(colIn)));
        column.setAlpha(colIn > 0 ? (1 - colOut) * (0.85 + 0.15 * Math.sin(t * 0.05)) : 0);
        core.setPosition(anchor.x, anchor.y + 30).setScale(colW * 0.4 * colX, colH * 0.95).setAlpha((1 - colOut) * 0.9);
        rings.clear();
        for (let i = 0; i < ringColors.length; i += 1) {
          const p = span(t, i * EVO.ringStaggerMs, EVO.ringMs);
          if (p <= 0 || p >= 1) continue;
          const r = 20 + (EVO.ringMaxR - 20) * outCubic(p);
          rings.lineStyle(10 * (1 - p) + 2, ringColors[i] ?? PALETTE.secondary, 0.9 * (1 - p));
          rings.strokeEllipse(anchor.x, anchor.y + 20, r * 2, r * 1.1);
        }
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
        // A lone ingredient flies in from above instead of from the left.
        const solo = withIcon === null && withLabel === null;
        const fx0 = solo ? STAGE.x : 150 + (STAGE.x - 150) * e;
        const fy0 = solo ? STAGE.y - 220 * (1 - e) : STAGE.y - arc;
        const wx = VIEW.width - 150 - (VIEW.width - 300 - STAGE.x + 150) * e;
        fromIcon?.setPosition(fx0, fy0).setScale(fromBase * appear * (1 - 0.35 * e)).setAlpha(1).setRotation(-0.5 * e);
        withIcon?.setPosition(wx, STAGE.y + arc).setScale(withBase * appear * (1 - 0.35 * e)).setAlpha(1).setRotation(0.5 * e);
        const labelA = 1 - span(t, EVO.flyInFrom + 260, 160);
        fromLabel.setPosition(fx0, fy0 + 72).setAlpha(appear * labelA);
        withLabel?.setPosition(wx, STAGE.y + arc + 72).setAlpha(appear * labelA);
        if (fx.secondary.getAliveParticleCount() < 60) {
          fx.primary.emitParticleAt(fx0, fy0, 1);
          if (!solo) fx.secondary.emitParticleAt(wx, STAGE.y + arc, 1);
        }
      } else {
        fromIcon?.setAlpha(0);
        withIcon?.setAlpha(0);
        fromLabel.setAlpha(0);
        withLabel?.setAlpha(0);
      }

      if (crossed(t, prev, EVO.mergeAt)) {
        fx.secondary.explode(22, STAGE.x, STAGE.y);
        fx.ink.explode(14, STAGE.x, STAGE.y);
        fx.primary.explode(10, STAGE.x, STAGE.y);
        sfx('hit', { rate: 0.6, volume: 0.7 });
        sfxArp('levelup', 4, { rate: 1.1, volume: 0.5 });
        if (!calm && !skipped) shake(scene, 0.006, 180);
      }
      if (crossed(t, prev, EVO.mergeAt + 40)) fx.accent.explode(12, STAGE.x, STAGE.y);
      const fl = span(t, EVO.mergeAt, 300);
      flare.setAlpha(fl > 0 && fl < 1 ? 1 - outQuad(fl) : 0).setScale(flareBase * (0.3 + 3.2 * outCubic(fl)));

      // Result: pop in, bob, then fly to the target (or fade in place).
      let ex = STAGE.x;
      let ey = STAGE.y;
      if (merged) {
        const pop = outBack(span(t, EVO.mergeAt, EVO.popMs), 2.2);
        let es = pop;
        let fade = 1;
        ey += Math.sin((t - EVO.mergeAt) * 0.008) * 6;
        const out = span(t, EVO.flyOutFrom, EVO.arriveAt - EVO.flyOutFrom);
        if (out > 0 && target !== undefined) {
          const e = inCubic(out);
          ex = STAGE.x + (target.x - STAGE.x) * e;
          ey = ey + (target.y - ey) * e - Math.sin(Math.PI * out) * 60;
          es = 1 - 0.7 * e;
          trail.unshift({ x: ex, y: ey, s: es });
          if (trail.length > 12) trail.length = 12;
        } else if (out > 0) {
          fade = 1 - outQuad(out);
        }
        const gone = t >= EVO.arriveAt;
        resultIcon?.setPosition(ex, ey).setScale(resultBase * es).setAlpha(gone ? 0 : fade);
        halo.setPosition(ex, ey).setScale(es).setRotation(t * 0.002).setAlpha(gone ? 0 : (1 - out) * fade);
      }
      streak.clear();
      if (target !== undefined && t >= EVO.flyOutFrom && t < EVO.arriveAt) {
        for (let i = 1; i < trail.length; i += 1) {
          const a = trail[i - 1];
          const b = trail[i];
          if (a === undefined || b === undefined) continue;
          streak.lineStyle(14 * (1 - i / trail.length) + 2, PALETTE.accent, 0.7 * (1 - i / trail.length));
          streak.lineBetween(a.x, a.y, b.x, b.y);
        }
      }
      if (crossed(t, prev, EVO.flyOutFrom) && target !== undefined) sfx('whoosh', { rate: 1.6, volume: 0.4 });

      // Titles.
      const textOut = 1 - span(t, EVO.textOutFrom, EVO.textOutMs);
      const ti = span(t, EVO.titleAt, EVO.textInMs);
      title.setAlpha(outQuad(ti) * textOut).setScale(0.7 + 0.3 * outBack(ti) + 0.08 * (1 - textOut));
      const ni = span(t, EVO.nameAt, EVO.textInMs);
      nameLine.setAlpha(outQuad(ni) * textOut).setScale(nameFit * (0.85 + 0.15 * outBack(ni)));
      const fi = span(t, EVO.effectAt, EVO.textInMs);
      effect.setAlpha(outQuad(fi) * textOut).setPosition(STAGE.x, STAGE.y + 182 + 16 * (1 - outCubic(fi)));

      // ── beat 3: arrival ──
      if (target === undefined) return;
      if (crossed(t, prev, EVO.arriveAt)) {
        fx.accent.explode(14, target.x, target.y);
        fx.secondary.explode(8, target.x, target.y);
        sfx('pickup', { rate: 1.2, volume: 0.6 });
      }
      arrival.clear();
      const ar = span(t, EVO.arriveAt, EVO.arrivalRingMs);
      if (ar > 0 && ar < 1) {
        arrival.lineStyle(6 * (1 - ar) + 2, PALETTE.accent, 1 - ar);
        arrival.strokeCircle(target.x, target.y, 24 + 46 * outCubic(ar));
      }
    },
    destroy: () => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onTap);
      for (const o of [vignette, glow, halo, fromIcon, withIcon, resultIcon, fromLabel, withLabel, streak, flare, arrival, title, nameLine, effect, column, core, rings]) {
        o?.destroy();
      }
      if (d.closing) return;
      dilate(scene, d, 1);
      spec.onDone?.();
    },
  };
  const onTap = (): void => {
    if (skipped || beat.t < SKIP_ARM_MS) return;
    skipped = true;
    beat.speed = SKIP_SPEED;
    dilate(scene, d, 1);
  };
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, onTap);
  // First frame of acknowledgement lands this frame, not next.
  beat.render(0, UNSTARTED);
  beat.t = 0;
  return beat;
}

// ─────────────────────────── small beats ───────────────────────────

const RANK = { totalMs: 520, popMs: 160, fillAt: 180, fadeFrom: 380, pip: 18, gap: 26, iconSize: 72, rise: 110 } as const;

function rankUpBeat(scene: Phaser.Scene, d: Director, spec: RankUpSpec, lane: number): Beat {
  const rise = RANK.rise + lane * LANE_PX;
  const fx = sparks(scene, d);
  const hp = { x: 0, y: 0 };
  const icon = beatIcon(scene, spec.icon, RANK.iconSize);
  const base = icon?.scale ?? 1;
  const pips = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.icons);
  const caption = beatText(scene, spec.label ?? `RANK ${spec.rank}`, 22, CSS.primary);
  const diamond = (x: number, y: number, h: number): void => {
    pips.beginPath();
    pips.moveTo(x, y - h);
    pips.lineTo(x + h, y);
    pips.lineTo(x, y + h);
    pips.lineTo(x - h, y);
    pips.closePath();
  };
  return {
    t: UNSTARTED,
    speed: 1,
    totalMs: RANK.totalMs,
    delayMs: 0,
    render: (t, prev) => {
      toScreen(scene, spec.anchor, hp);
      const fade = 1 - span(t, RANK.fadeFrom, RANK.totalMs - RANK.fadeFrom);
      const cx = hp.x;
      const cy = hp.y - rise - 14 * outQuad(span(t, RANK.fadeFrom, RANK.totalMs - RANK.fadeFrom));
      if (crossed(t, prev, 0)) sfx('tap', { rate: 1.2, volume: 0.6 });
      icon?.setPosition(cx, cy).setScale(base * outBack(span(t, 0, RANK.popMs), 2.2)).setAlpha(fade);
      caption.setPosition(cx, cy - 52).setAlpha(fade * outQuad(span(t, 60, 120)));
      pips.clear();
      pips.setAlpha(fade);
      const py = cy + 52;
      const x0 = cx - ((spec.maxRank - 1) * RANK.gap) / 2;
      const fill = span(t, RANK.fillAt, 140);
      for (let i = 0; i < spec.maxRank; i += 1) {
        const isNew = i === spec.rank - 1;
        const filled = i < spec.rank - 1 || (isNew && fill > 0);
        const h = (isNew && fill > 0 ? RANK.pip * (1 + 0.8 * (1 - outCubic(fill))) : RANK.pip) / 2;
        const x = x0 + i * RANK.gap;
        pips.fillStyle(PALETTE.bgDeep, 0.85);
        diamond(x, py, h + 3);
        pips.fillPath();
        diamond(x, py, h);
        if (filled) {
          pips.fillStyle(isNew ? PALETTE.primary : PALETTE.ink, 1);
          pips.fillPath();
        } else {
          pips.lineStyle(2, PALETTE.ink, 0.6);
          pips.strokePath();
        }
      }
      if (crossed(t, prev, RANK.fillAt)) {
        fx.primary.explode(8, x0 + (spec.rank - 1) * RANK.gap, py);
        sfx('pickup', { rate: 0.9 + 0.12 * spec.rank, volume: 0.5 });
      }
    },
    destroy: () => {
      icon?.destroy();
      pips.destroy();
      caption.destroy();
    },
  };
}

function acquireBeat(scene: Phaser.Scene, d: Director, spec: AcquireSpec, lane: number): Beat {
  const fx = sparks(scene, d);
  const small = spec.small === true;
  const hp = { x: 0, y: 0 };
  const size = small ? 72 : 96;
  const tone = small ? PALETTE.secondary : PALETTE.primary;
  const T = small
    ? { totalMs: 620, popMs: 160, holdTo: 260, arriveAt: 520, ringMs: 100, lift: 100 }
    : { totalMs: 760, popMs: 180, holdTo: 320, arriveAt: 640, ringMs: 120, lift: 120 };
  const lift = T.lift + lane * LANE_PX;
  const icon = beatIcon(scene, spec.icon, size);
  const base = icon?.scale ?? 1;
  const kindText = beatText(scene, spec.kind, small ? 16 : 18, small ? CSS.secondary : CSS.primary);
  const nameText = beatText(scene, spec.name, small ? 22 : 26, CSS.ink, false);
  const rings = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.icons - 1);
  const target = spec.target;
  let startX = 0;
  let startY = 0;
  return {
    t: UNSTARTED,
    speed: 1,
    totalMs: T.totalMs,
    delayMs: 0,
    render: (t, prev) => {
      if (crossed(t, prev, 0)) {
        toScreen(scene, spec.anchor, hp);
        fx[small ? 'secondary' : 'primary'].explode(small ? 6 : 10, hp.x, hp.y);
        sfx('pickup', { rate: small ? 1.15 : 1, volume: small ? 0.4 : 0.55 });
      }
      const out = target === undefined ? 0 : span(t, T.holdTo, T.arriveAt - T.holdTo);
      let x = startX;
      let y = startY;
      let s = 1;
      if (out <= 0) {
        toScreen(scene, spec.anchor, hp);
        startX = hp.x;
        startY = hp.y - lift;
        x = startX;
        y = startY - 8 * outQuad(span(t, 0, T.holdTo));
        s = outBack(span(t, 0, T.popMs), 2.2);
      } else if (target !== undefined) {
        const e = inCubic(out);
        x = startX + (target.x - startX) * e;
        y = startY + (target.y - startY) * e;
        s = 1 - 0.6 * e;
      }
      if (crossed(t, prev, T.holdTo) && target !== undefined) sfx('whoosh', { rate: 1.5, volume: 0.35 });
      const gone = target === undefined ? 1 - span(t, T.arriveAt, T.totalMs - T.arriveAt) : t >= T.arriveAt ? 0 : 1;
      icon?.setPosition(x, y).setScale(base * s).setAlpha(gone);
      const labelA = outQuad(span(t, 40, 100)) * (1 - span(t, T.holdTo - 40 + (target === undefined ? 200 : 0), 100));
      kindText.setPosition(startX, startY - size * 0.5 - 14).setAlpha(labelA);
      nameText.setPosition(startX, startY + size * 0.5 + 18).setAlpha(labelA);
      rings.clear();
      const r0 = span(t, 0, 260);
      if (r0 > 0 && r0 < 1) {
        rings.lineStyle(6 * (1 - r0) + 2, tone, 0.85 * (1 - r0));
        rings.strokeCircle(startX, startY + lift, 24 + (small ? 70 : 100) * outCubic(r0));
      }
      if (target === undefined) return;
      if (crossed(t, prev, T.arriveAt)) {
        fx[small ? 'secondary' : 'accent'].explode(small ? 6 : 10, target.x, target.y);
        sfx('tap', { rate: 1.3, volume: 0.5 });
      }
      const ar = span(t, T.arriveAt, T.ringMs);
      if (ar > 0 && ar < 1) {
        rings.lineStyle(5 * (1 - ar) + 2, small ? tone : PALETTE.accent, 1 - ar);
        rings.strokeCircle(target.x, target.y, 22 + 30 * outCubic(ar));
      }
    },
    destroy: () => {
      icon?.destroy();
      kindText.destroy();
      nameText.destroy();
      rings.destroy();
    },
  };
}
