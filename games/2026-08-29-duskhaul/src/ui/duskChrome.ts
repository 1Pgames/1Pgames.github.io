import Phaser from 'phaser';
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
  /** `ui/minimap.ts` (§14.10) — under the boss plate, over the compass. */
  minimap: 1012,
  /**
   * `ui/bossBar.ts` — the boss plate and its off-screen arrow. ABOVE the
   * compass because the two share the screen edge late in a run and the boss
   * is the beat that window is about; below the bag cluster (band B).
   */
  boss: 1015,
  /** `ui/bagStrip.ts`. */
  bagStrip: 1020,
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
 * PER-ZONE GROUND GRADE — a LIGHTING pass: a multiply tint on the ground layer
 * (floor tiles, flat decals, scenery props) inside `systems/arena.ts`, never a
 * repaint of the art.
 *
 * V2 retune (ArtWorld, via Main): the V2 floors `floor-<zone>-a|b|c` are
 * authored INSIDE PRD-V2 §3.7's value band (L* 18-32, mean 25) already, so the
 * V1 grades — derived for the lit V1 tiles — pushed them below L* 18. The V2
 * grade is a near-neutral 0xd9d9d9 (castle/outlands/desert) and 0xf5f5f5 for
 * winter's "bright cold field", measured by ArtWorld with `xd://art_review`.
 *
 * The zone's own `border-<id>` tile is NOT graded: it is already the art run's
 * authored shadow value for that stone, so grading it twice would crush it.
 */
export const FLOOR_GRADE: Record<ZoneId, number> = {
  castle: 0xd9d9d9,
  outlands: 0xd9d9d9,
  desert: 0xd9d9d9,
  winter: 0xf5f5f5,
};

/** The 2px ring every rarity swatch carries (§11 contrast rule). */
export const TIER_RING = { color: 0x7e7376, width: 2 } as const;

/**
 * V2 gear/valuable rarity ladder (PRD-V2 §5.15.1), ART-LOCKED like
 * `TIER_COLOR`: 1 Tarnished … 6 Hallowed. Every swatch still carries
 * `TIER_RING` — Worn and Burnished sit near the panel fill.
 */
const RARITY_COLOR: readonly number[] = [0xa5a38b, 0x6f8fa6, 0xc07a3a, 0xf3ca67, 0xad6eef, 0xe8f0ff];

/** Rarity words, index `rarity - 1` (§5.15.1). */
const RARITY_NAME: readonly string[] = ['Tarnished', 'Worn', 'Burnished', 'Gilded', 'Dread', 'Hallowed'];

/** Swatch colour for a 1-6 rarity, clamped so malformed data never throws mid-repaint. */
export function rarityColor(r: number): number {
  return RARITY_COLOR[Phaser.Math.Clamp(Math.round(r), 1, 6) - 1] ?? 0xa5a38b;
}

/** Rarity word for a 1-6 rarity (clamped). */
export function rarityName(r: number): string {
  return RARITY_NAME[Phaser.Math.Clamp(Math.round(r), 1, 6) - 1] ?? 'Tarnished';
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

