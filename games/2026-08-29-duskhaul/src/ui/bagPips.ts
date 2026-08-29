import Phaser from 'phaser';
import { CSS, TEXT } from '../config';
import { ICON, TEXTURE } from '../data/art';
import { HUD_DEPTH, IDENTITY, TIER_RING, tierColor } from './duskChrome';

/**
 * Bag pips + casket pip + shard counter — the "how much am I risking" read
 * (§14.1, band B, hierarchy rank 3).
 *
 * Two widgets, one component, because they are one THOUGHT: the pips are the
 * loot you are carrying and the counter is the loot you are carrying. Splitting
 * them across two owners is how the greybox ended up with a procedural
 * "RELICS 0/8 CASKET 1" line colliding with the run clock at y=190.
 *
 * ANCHOR CONTRACT: `(x, y)` is the TOP-LEFT of the pip row and must be
 * (360, 88) — the §14.1 authored position. The shard counter is placed at its
 * own authored (680, 82), right-aligned, as an OFFSET from that anchor, so one
 * component lands both widgets on their contract coordinates and neither can
 * drift from the other.
 *
 * Display-only and non-interactive (§14.1: "display-only, not tappable"). The
 * pause overlay's re-pin pips are a different, tappable surface and are NOT
 * this component.
 *
 * It renders only. It never reads game state.
 */

export interface BagPipsModel {
  /** Bag capacity — 8 by default, up to 12 with the Marrow Sack upgrades. */
  slots: number;
  /** How many of those slots hold a relic. */
  used: number;
  /** Tier (1-4) per carried relic, in bag order. Shorter than `used` is fine. */
  relicTiers: readonly number[];
  /** Casket capacity — 1, or 2 with Widow's Casket. */
  casketSlots: number;
  /**
   * Tier per PINNED relic. The casket is manual-pin-only and starts EMPTY, so
   * an empty array is the common case, not an edge case: an unpinned death
   * loses everything carried, which is the design.
   */
  casketTiers: readonly number[];
  shards: number;
}

/** §14.1: 9 pips at 16px with 4px gaps = 176x16, starting at x=360. */
const PIP = { size: 16, gap: 4 } as const;

/** Extra gap separating the casket pip group from the bag row. */
const CASKET_GAP = 12;
/** Size of the generated casket badge drawn over the casket pip group. */
const CASKET_BADGE_PX = 30;

/** §14.1 shard counter: 130x32 right-aligned to (680, 82). */
const SHARD = { right: 680, y: 82, iconSize: 26, fontSize: '28px' } as const;

/** The anchor this component is contracted to sit at (§14.1). */
const ANCHOR = { x: 360, y: 88 } as const;

/**
 * Element-wise compare of the last painted tiers against the live ones. The
 * arrays are at most 12 + 2 entries, so this is cheaper than the `join` it
 * replaces AND allocates nothing on the frames where nothing changed — which
 * is all but a handful of frames in a run.
 */
function tiersChanged(last: readonly number[], next: readonly number[]): boolean {
  if (last.length !== next.length) return true;
  for (let i = 0; i < last.length; i += 1) {
    if (last[i] !== next[i]) return true;
  }
  return false;
}

/** Snapshot `next` into `last` in place — the caches are never reallocated. */
function copyTiers(last: number[], next: readonly number[]): void {
  last.length = next.length;
  for (let i = 0; i < next.length; i += 1) last[i] = next[i] as number;
}

export class BagPips {
  private readonly pips: Phaser.GameObjects.Graphics;
  private readonly shardIcon: Phaser.GameObjects.Image | null;
  private readonly shardText: Phaser.GameObjects.Text;
  /**
   * The generated casket badge, shown only while something is actually pinned.
   * The pip ROW is chrome and stays procedural (§11 exempts UI chrome), but the
   * casket is the one slot that survives a death, and §11 authors real art for
   * it — a 2f sparkle that reads "kept safe" rather than "loot to grab". Null
   * when the `pickups-fx` group is not loaded.
   */
  private readonly casketBadge: Phaser.GameObjects.Sprite | null;

  /**
   * Diffed state: the pip row is a Graphics redraw, so it must not run per
   * frame — and the DIFF itself must not allocate per frame either. A joined
   * key string was ~120 short-lived strings a second on the one path §15 is
   * protecting, so the comparison runs on primitives plus an element-wise
   * walk of the two tier arrays (≤14 entries, no allocation, no join).
   */
  private lastSlots = -1;
  private lastUsed = -1;
  private lastCasketSlots = -1;
  private readonly lastRelicTiers: number[] = [];
  private readonly lastCasketTiers: number[] = [];
  private lastShards = -1;
  private destroyed = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.pips = scene.add.graphics({ x, y }).setScrollFactor(0).setDepth(HUD_DEPTH.bagPips);

    // Offsets from the anchor, so the counter lands on its own authored
    // coordinate whatever the anchor is — and visibly drifts in review if the
    // anchor is ever wrong, rather than silently re-flowing.
    const shardX = x + (SHARD.right - ANCHOR.x);
    const shardY = y + (SHARD.y - ANCHOR.y);

    // The shard glyph is generated art; a missing group must degrade to text
    // rather than to a green box.
    this.shardIcon = scene.textures.exists(ICON.shard.key)
      ? scene.add
          .image(shardX - 104, shardY + 16, ICON.shard.key, ICON.shard.frame)
          .setDisplaySize(SHARD.iconSize, SHARD.iconSize)
          .setScrollFactor(0)
          .setDepth(HUD_DEPTH.bagPips)
      : null;

    // Numerals draw straight over the arena, so they KEEP their armour
    // (§14.4: armour applies to HUD numerals). `accent` is 10.97:1 and legal
    // as text anywhere.
    this.shardText = scene.add
      .text(shardX, shardY, '0', { ...TEXT.heading, fontSize: SHARD.fontSize, color: CSS.accent })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.bagPips + 1);

    // Position is set on repaint from the live pip cursor; it starts hidden.
    this.casketBadge = scene.anims.exists(TEXTURE.casket)
      ? scene.add
          .sprite(x, y, TEXTURE.casket)
          .setDisplaySize(CASKET_BADGE_PX, CASKET_BADGE_PX)
          .setScrollFactor(0)
          .setDepth(HUD_DEPTH.bagPips + 1)
          .setVisible(false)
      : null;
    this.casketBadge?.play(TEXTURE.casket);
  }

  update(model: BagPipsModel): void {
    if (this.destroyed) return;

    if (model.shards !== this.lastShards) {
      this.lastShards = model.shards;
      this.shardText.setText(`${model.shards}`);
    }

    // The pip row is a Graphics redraw — the single most expensive mistake
    // available in a HUD — and the bag changes a handful of times per run, so
    // it repaints only on a real change. `tiersChanged` walks the arrays
    // instead of joining them: this runs 60 times a second forever.
    if (
      model.slots === this.lastSlots &&
      model.used === this.lastUsed &&
      model.casketSlots === this.lastCasketSlots &&
      !tiersChanged(this.lastRelicTiers, model.relicTiers) &&
      !tiersChanged(this.lastCasketTiers, model.casketTiers)
    ) {
      return;
    }

    this.lastSlots = model.slots;
    this.lastUsed = model.used;
    this.lastCasketSlots = model.casketSlots;
    copyTiers(this.lastRelicTiers, model.relicTiers);
    copyTiers(this.lastCasketTiers, model.casketTiers);
    this.repaint(model);
  }

  private repaint(model: BagPipsModel): void {
    const g = this.pips;
    g.clear();

    const step = PIP.size + PIP.gap;
    let cursor = 0;

    for (let i = 0; i < model.slots; i += 1) {
      const tier = i < model.used ? model.relicTiers[i] : undefined;
      this.drawPip(g, cursor, tier, false);
      cursor += step;
    }

    // The casket group is separated by a wider gap and ringed in accent when
    // pinned: it is the one slot that survives a death, so it must not read as
    // a tenth bag slot.
    cursor += CASKET_GAP;
    const casketLeft = cursor;
    for (let i = 0; i < model.casketSlots; i += 1) {
      this.drawPip(g, cursor, model.casketTiers[i], true);
      cursor += step;
    }

    // The generated badge marks a PINNED casket only, and rides the live pip
    // cursor rather than a constant: `slots` grows to 12 with Marrow Sack, so a
    // baked offset would drift off the pip it labels.
    if (this.casketBadge !== null) {
      const pinned = model.casketTiers.length > 0;
      this.casketBadge.setVisible(pinned);
      if (pinned) {
        this.casketBadge.setPosition(
          this.pips.x + casketLeft + PIP.size / 2,
          this.pips.y + PIP.size / 2,
        );
      }
    }
  }

  /**
   * One pip. A filled disc when occupied (tier colour, ART-LOCKED), a hollow
   * one when empty. Every pip carries the mandatory 2px `#7e7376` ring: tier 2
   * Burnished is 2.91:1 on its own, below the 3:1 graphical floor, and the
   * ring is what discharges that obligation (§11).
   */
  private drawPip(
    g: Phaser.GameObjects.Graphics,
    left: number,
    tier: number | undefined,
    casket: boolean,
  ): void {
    const r = PIP.size / 2;
    const cx = left + r;
    const cy = r;

    if (tier === undefined) {
      g.fillStyle(IDENTITY.cooled, 0.22);
      g.fillCircle(cx, cy, r - 1);
    } else {
      g.fillStyle(tierColor(tier), 1);
      g.fillCircle(cx, cy, r - 1);
    }

    // A pinned casket pip takes the accent ring; everything else takes the
    // identity ring. Both are 2px, so the row's rhythm is unchanged.
    g.lineStyle(TIER_RING.width, casket && tier !== undefined ? IDENTITY.gilt : TIER_RING.color, 1);
    g.strokeCircle(cx, cy, r - 1);

    // An empty casket slot is drawn as a dashed-feeling open ring: the design
    // wants the player to notice the pin is unused, because an unpinned death
    // loses the whole bag.
    if (casket && tier === undefined) {
      g.lineStyle(TIER_RING.width, IDENTITY.gilt, 0.55);
      g.strokeCircle(cx, cy, r + 2);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pips.destroy();
    this.shardIcon?.destroy();
    this.casketBadge?.destroy();
    this.shardText.destroy();
  }
}
