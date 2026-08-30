import Phaser from 'phaser';
import { CSS, PALETTE } from '../config';
import type { ZoneId } from '../data/zones';
import { drawPanel, type ChromeStyle } from './primitives';

/**
 * The §14.4 CHROME SPEC, in one place.
 *
 * PRD §14 is an AUTHORED CONTRACT from the art-director: every fill, alpha,
 * radius, stroke width and identity literal below is measured and quoted from
 * it. Code never originates a chrome or palette value — a disagreement routes
 * back to the art-director instead of turning into an ad-hoc constant here.
 *
 * Why a module rather than four private copies: `scenes/{menu,meta,gameover}`,
 * `ui/{gateCompass,bagPips,channelBar,cards}` and the arena slice all draw the
 * same chrome, and four copies of `0x19212e @ 0.92` drift the moment one is
 * tuned.
 *
 * ART-LOCKED literals (`IDENTITY`, `TIER_COLOR`) are GAMEPLAY IDENTITY, not
 * palette roles (§11): never palette-swapped, never re-themed, and they must
 * match the generated icon glyphs exactly. That is why they are literals here
 * and not `PALETTE` references.
 */

/** The darkest tone in the anchors (gate-arch interior shadow) — §14.4. */
export const DEEP_INK = 0x03040b;
export const DEEP_INK_CSS = '#03040b';

/**
 * Depth band for the §14 HUD widgets that do NOT live inside `ui/hud.ts`'s
 * container.
 *
 * `Hud` is one Container at depth 1000 and everything it owns inherits that.
 * The compass, the bag pips and the channel bar are separate top-level objects
 * — `setScrollFactor(0)` pins them to the camera but says NOTHING about draw
 * order, so an unset depth leaves them at 0, i.e. UNDER arena props (6), gate
 * rings (5), relic pickups (7-8), enemies (10), the channel arc (40) and the
 * Collapse ring (45). That is fatal for the channel bar in particular, which
 * exists precisely because the world arc is covered by the bodies contesting
 * the ring.
 *
 * The band therefore sits ABOVE `Hud` (1000) and BELOW the modal stack —
 * cards 2000, pause 2100, coach 2600 — in §14.1 hierarchy order, so an
 * overlap inside the band resolves the way the hierarchy reads it: the bag
 * cluster over a compass chip that drifts up into band B, and the channel bar
 * — the single most important number in the game while it is up — over both.
 * Each component sets its own depth in its constructor; a call site must never
 * have to remember to.
 */
export const HUD_DEPTH = {
  /** `ui/hud.ts`'s own container — the floor of the band. */
  hud: 1000,
  compass: 1010,
  bagPips: 1020,
  channelBar: 1030,
} as const;

/** Panels: dialogs, list rows, HUD plates, cards (§14.4 "Panels"). */
export const PANEL = {
  fill: 0x19212e,
  fillAlpha: 0.92,
  stroke: 0x7e7376,
  strokeAlpha: 0.7,
  strokeWidth: 2,
  /** 12 normally, 16 for full-width panels >= 600 wide. */
  radius: 12,
  radiusWide: 16,
  /** Width at or above which `radiusWide` applies. */
  wideFrom: 600,
} as const;

/**
 * Bar housings: HP, XP, channel, progress (§14.4 "Bar housings"). Internal —
 * `paintBar` below is the surface; a caller that reads the housing spec itself
 * is about to draw a second, drifting copy of it.
 */
const BAR_HOUSING = {
  fill: DEEP_INK,
  fillAlpha: 0.85,
  stroke: 0x7e7376,
  strokeAlpha: 0.6,
  strokeWidth: 2,
  radius: 6,
} as const;

/**
 * Scrim for text-over-art bands (§14.4). ONE value, no per-zone branching —
 * the call must not need to know which zone is loaded.
 *
 * Alpha 0.80 is load-bearing and 0.72 is EXPLICITLY REJECTED: 0.72 holds for
 * the dark and warm zones but drops `inkSoft` to 3.92:1 over a bone-white
 * desert crest and 3.45:1 over pure white. The floor is set by the LIGHTEST
 * backdrop the art can produce (bone-white crest, relative luminance 0.751),
 * not by the brightest warm accent (torch core, 0.468).
 */
export const SCRIM = {
  fill: DEEP_INK,
  alpha: 0.8,
  radius: 12,
  pad: 16,
} as const;

/**
 * Button states (§14.4 "Buttons"), each with the contrast it was signed off
 * at. `primary` and `destructive` are FILLS carrying a deep-ink label: that is
 * the §11 escape hatch for a tone that fails as text.
 *
 * Internal: `BUTTON_STYLE` at the bottom of this file is what callers consume,
 * because a `Button` takes fill/stroke/textColor and nothing else.
 */
const BUTTON = {
  idle: { fill: 0x19212e, fillAlpha: 0.95, stroke: 0x7e7376, strokeAlpha: 0.8 },
  /** Whole button offsets +2px y while held. */
  pressed: { fill: 0x2c3848, fillAlpha: 1, stroke: 0xeae1bf, strokeAlpha: 0.5, offsetY: 2 },
  /** Disabled labels use `ink`, never `inkSoft` (which would land at 4.34:1). */
  disabled: { fill: 0x303e41, fillAlpha: 0.55, strokeWidth: 0 },
  primary: { fill: 0x9bdf9f, fillAlpha: 0.92, stroke: DEEP_INK, label: DEEP_INK_CSS },
  destructive: { fill: 0xff4739, fillAlpha: 0.92, stroke: DEEP_INK, label: DEEP_INK_CSS },
  strokeWidth: 2,
  radius: 12,
} as const;

/**
 * ART-LOCKED gameplay identity literals (§11 colour code). Never
 * palette-swapped: the generated art carries these exact tones, so re-theming
 * them here would desync code from the sprites.
 */
export const IDENTITY = {
  /** Threat glow / telegraph. */
  threat: 0xc0392b,
  /** Reward gilt shimmer on shards/relics/chests. */
  gilt: 0xd9a24b,
  /** Arcane / gate-open violet fill. */
  gateOpen: 0x8546dd,
  /** Gate closed (cooled) — also the closed-pip ring and the dead-arrow tone. */
  cooled: 0x7e7376,
  /** Hazard telegraph amber — and the closing-gate chip (§14.2). */
  hazardAmber: 0xe8c547,
  /** Player / ally rim. */
  allyRim: 0x8a9a5b,
} as const;

/**
 * PER-ZONE GROUND GRADE (game-build Step 5.5, measured).
 *
 * The generated floor tiles came out of the art run LIT, not shadowed: the
 * castle floor measures a mean relative luminance of 0.0848 against the
 * hero's 0.0666, and it is 100% of the frame, so the actors sat ON the ground
 * instead of IN it. This is a LIGHTING pass — a multiply tint on the ground
 * layer (floor tile, flat decals, scenery props) inside `systems/arena.ts` —
 * never a repaint of the art.
 *
 * Each value is a multiply factor derived from the tile's OWN measured mean
 * RGB toward an authored target, and every zone is checked against the
 * canonical pair (`hero/hero-idle`, `enemies-light/enemy-husk-move`) on two
 * criteria:
 *
 * - **C1, foreground ownership** — graded floor p99 <= 0.5 x hero p99
 *   (0.694/2 = 0.347), so the hero's rim light is at least twice the
 *   brightest passage of ground anywhere in the frame.
 * - **C2, ground recession** — graded floor p90 <= hero p90 (0.1934), so no
 *   bright passage of ground out-values the hero's mid-lights.
 *
 * | zone | grade | floor mean L before/after | p90 | p99 | target and why |
 * | --- | --- | --- | --- | --- | --- |
 * | castle | `0xd0b3bf` | 0.0848 -> 0.0437 | 0.071 | 0.102 | lands the tile on `#2c3848` exactly — §11's OWN sampled "wet lit flagstone, vision-1 courtyard floor", i.e. `PALETTE.bgBottom`. The warm-leaning multiply is the §11 "blue-grey stone under torch amber" read and drops the tile's saturation 0.463 -> 0.414. |
 * | outlands | `0x969493` | 0.1884 -> 0.0608 | 0.097 | 0.121 | an open plain under haze reads lighter than a torch-lit interior, so ~1.4x castle — but still under the hero's mean (0.0666). Near-neutral multiply keeps the ochre (sat 0.123 -> 0.139). |
 * | winter | `0xe2e2e8` | 0.1053 -> 0.0817 | 0.122 | 0.165 | §11's "bright cold field" stays the brightest of the three dark zones (1.9x castle). The tint was RE-DERIVED when the zone-art pass re-authored this tile: the new snowfield ships at an authored mean L of 0.1053 (was 0.2902), so the old `0x8f8f94` graded it to 0.0327 — C1 and C2 both still passed, but on screen it read as a NIGHT snowfield rather than a bright cold field, i.e. it passed the criteria and missed the intent. `0xe2e2e8` reproduces the original calibration targets almost exactly (0.0817 against 0.0841, p90 0.122 against 0.127) with C1 and C2 both clear. |
 * | desert | `0xa89ea6` | 0.6874 -> 0.2460 | 0.2616 (p50) | 0.313 | §11's DELIBERATELY INVERTED light field, and the one zone C2 does not apply to: the floor p50 (0.2616) stays ABOVE the hero p90 (0.1934) so every actor pixel but its rim reads as a hole in the sand. C1 still holds (0.313 <= 0.347), so the hero's rim is the brightest thing on screen even here. The tile was re-authored brighter (0.4630 -> 0.6874) and the tint is UNCHANGED: it still lands inside both bounds. |
 *
 * The zone's own `border-<id>` tile is NOT graded: it is already the art run's
 * authored shadow value for that stone (castle mean L 0.0168, 5x darker than
 * its floor), so grading it twice would crush it to black.
 */
export const FLOOR_GRADE: Record<ZoneId, number> = {
  castle: 0xd0b3bf,
  outlands: 0x969493,
  desert: 0xa89ea6,
  winter: 0xe2e2e8,
};

/**
 * Relic tier ladder, ART-LOCKED (§11), matching the generated icon glyphs
 * exactly. Index by `tier - 1`.
 *
 * Tier 2 Burnished sits at 2.91 against `bgTop` — BELOW the 3:1 graphical
 * floor — which is why every tier swatch/pip carries `TIER_RING` (3.54:1
 * against the panel fill). The ring meets the swatch's contrast obligation and
 * the fill is identity-only. Tier NAMES always render in `ink`/`inkSoft` on
 * the tier-coloured surface, never as tier-coloured text.
 */
const TIER_COLOR: readonly [number, number, number, number] = [
  0xa5a38b, // 1 Tarnished
  0x835d2f, // 2 Burnished
  0xf3ca67, // 3 Gilded
  0xad6eef, // 4 Dread
];

/** The 2px ring every tier swatch carries — see `TIER_COLOR`. */
export const TIER_RING = { color: 0x7e7376, width: 2 } as const;

/**
 * Tier colour for a 1-4 tier. Clamped rather than indexed raw so bad data
 * cannot throw or return `undefined` in the middle of a repaint — a HUD that
 * crashes on a malformed tier is worse than one that shows Tarnished.
 */
export function tierColor(tier: number): number {
  const clamped = Phaser.Math.Clamp(Math.round(tier), 1, 4);
  const [t1, t2, t3, t4] = TIER_COLOR;
  return clamped === 4 ? t4 : clamped === 3 ? t3 : clamped === 2 ? t2 : t1;
}

/**
 * The surface a piece of text is drawn onto, for `textToneIsLegal`.
 * `art` covers the generated arena/backdrop art and `bgBottom`, which is where
 * §11's two measured failures live.
 */
export type TextSurface = 'bgTop' | 'panel' | 'scrim' | 'art';

/**
 * `TIER_COLOR` as a CSS string, for a surface that legitimately takes the tier
 * tone — which is why the surface is a REQUIRED argument, not an assumption.
 *
 * Tier 4 Dread IS `secondary #ad6eef`, so this is the one path in the codebase
 * where a §11-restricted tone becomes TEXT by computation rather than by an
 * author typing it. Over art it degrades to `ink`, exactly as the `TIER_COLOR`
 * note requires ("tier NAMES always render in ink"), instead of shipping a
 * relic-name floater below the measured floor.
 */
export function tierColorCss(tier: number, over: TextSurface): string {
  const tone = tierColor(tier);
  if (!textToneIsLegal(tone, over)) return CSS.ink;
  return `#${tone.toString(16).padStart(6, '0')}`;
}

/**
 * The §14.4 panel style, radius picked from the width. Spread it into
 * `drawPanel`/`paintPanel`, or override one field where the contract asks it:
 * `panelStyle(640, { stroke: PALETTE.accent })`.
 */
export function panelStyle(width: number, over: ChromeStyle = {}): ChromeStyle {
  return {
    fill: PANEL.fill,
    fillAlpha: PANEL.fillAlpha,
    stroke: PANEL.stroke,
    strokeAlpha: PANEL.strokeAlpha,
    strokeWidth: PANEL.strokeWidth,
    radius: width >= PANEL.wideFrom ? PANEL.radiusWide : PANEL.radius,
    ...over,
  };
}

/** A §14.4 panel, drawn. It is its own contrast surface, so labels on it go bare. */
export function drawDuskPanel(
  scene: Phaser.Scene,
  width: number,
  height: number,
  over: ChromeStyle = {},
): Phaser.GameObjects.Graphics {
  return drawPanel(scene, width, height, panelStyle(width, over));
}

/**
 * The §14.4 scrim band: a `#03040b` veil at alpha 0.80 behind text that draws
 * over generated backdrop art. `width`/`height` are the TEXT BLOCK's size —
 * `SCRIM.pad` is added on all four sides here, so callers never restate it.
 *
 * Returns the veil `Graphics`, centred on (x, y), so the caller can depth-sort
 * it under its text.
 */
export function paintScrim(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const w = width + SCRIM.pad * 2;
  const h = height + SCRIM.pad * 2;
  g.fillStyle(SCRIM.fill, SCRIM.alpha);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, SCRIM.radius);
  return g;
}

/**
 * Bar housing + fill in one repaint. A progress fill is REDRAWN, never scaled:
 * scaling a rounded shape turns its caps into ellipses and a nearly empty bar
 * into a smear. The fill's radius shrinks with its width, so 5% is a dot and
 * 100% is a capsule.
 */
export function paintBar(
  g: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  progress: number,
  fill: number,
): void {
  const t = Phaser.Math.Clamp(progress, 0, 1);
  const x = -width / 2;
  const y = -height / 2;

  g.clear();
  g.fillStyle(BAR_HOUSING.fill, BAR_HOUSING.fillAlpha);
  g.fillRoundedRect(x, y, width, height, BAR_HOUSING.radius);

  if (t > 0) {
    const inset = BAR_HOUSING.strokeWidth;
    const trackWidth = width - inset * 2;
    const fillWidth = Math.max(1, trackWidth * t);
    const fillHeight = height - inset * 2;
    g.fillStyle(fill, 1);
    g.fillRoundedRect(
      x + inset,
      y + inset,
      fillWidth,
      fillHeight,
      Math.min(BAR_HOUSING.radius, fillWidth / 2, fillHeight / 2),
    );
  }

  g.lineStyle(BAR_HOUSING.strokeWidth, BAR_HOUSING.stroke, BAR_HOUSING.strokeAlpha);
  g.strokeRoundedRect(
    x + BAR_HOUSING.strokeWidth / 2,
    y + BAR_HOUSING.strokeWidth / 2,
    width - BAR_HOUSING.strokeWidth,
    height - BAR_HOUSING.strokeWidth,
    BAR_HOUSING.radius,
  );
}

/**
 * Button options for the §14.4 states, shaped for `ui/button.ts`. The template
 * `Button` derives its pressed state by darkening the fill, which matches the
 * spec's direction for the neutral states; `primary`/`destructive` need the
 * deep-ink label, which is the part a caller must not forget.
 */
export const BUTTON_STYLE = {
  idle: { fill: BUTTON.idle.fill, stroke: BUTTON.idle.stroke, textColor: '#eae1bf' },
  primary: { fill: BUTTON.primary.fill, stroke: BUTTON.primary.stroke, textColor: DEEP_INK_CSS },
  destructive: {
    fill: BUTTON.destructive.fill,
    stroke: BUTTON.destructive.stroke,
    textColor: DEEP_INK_CSS,
  },
  /** WCAG exempts disabled controls, but the LABEL still uses `ink`. */
  disabled: { fill: BUTTON.disabled.fill, stroke: BUTTON.disabled.fill, textColor: '#eae1bf' },
} as const;

/** Alpha a disabled control renders at — prices stay legible (§14b state honesty). */
export const DISABLED_ALPHA = 0.4;

/**
 * §11's two measured text restrictions, executable: `secondary #ad6eef` and
 * `bad #ff4739` FAIL as TEXT against `bgBottom` and against lit backdrop art.
 * True only where the tone is legal as text; anywhere else it must appear as a
 * FILL carrying a deep-ink label instead — which is what `BUTTON_STYLE`
 * (`primary`/`destructive` on `DEEP_INK_CSS`) and `ChannelBar`'s interrupt
 * flash already do by construction.
 *
 * `tierColorCss` is the rule's live caller: tier 4 Dread IS `secondary`, and
 * it is the only tone in the game that reaches a text style by computation.
 */
function textToneIsLegal(tone: number, over: TextSurface): boolean {
  if (tone !== PALETTE.secondary && tone !== PALETTE.bad) return true;
  return over !== 'art';
}
