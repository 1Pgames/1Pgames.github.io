import Phaser from 'phaser';
import { TUNING } from '../config';
import { TEX } from '../core/keys';
import { safePlay } from '../core/anim';
import { ICON } from '../data/art';
import { pickupDef, PICKUP_ART } from '../data/pickups';
import type { LootItem, PickupId } from '../data/types-v2';
import { itemRarity } from '../systems/bag';
import { rarityColor, TIER_RING } from '../ui/duskChrome';

/**
 * Pooled generic ground loot (PRD-V2 §5.13-5.16; replaces the V1 relic
 * pickup). One class carries every walk-over atom the bag/POI layer drops:
 *  - `item`   — a gear or valuable `LootItem` (icon + rarity aura + §11 ring),
 *  - `pickup` — a §5.13 ground pickup (`pk_bread|bell|flask|salt`),
 *  - `key`    — a Dread Key (opens the Vault instantly, §5.12).
 * `drop` re-skins a pooled instance and `despawn` parks it, so no allocation
 * per drop. Bob is numeric (no tween → nothing leaks on recycle); the magnet
 * engages after an arming beat so swap-dropped items are not re-collected at
 * once, and a `lingerMs` drop (bag swap/refusal, §5.16) rots after its window.
 * Missing art degrades to a rarity-tinted disc, never a crash.
 */
export type LootPayload = { kind: 'item'; item: LootItem } | { kind: 'pickup'; id: PickupId } | { kind: 'key' };

/** What `tick` observed this frame. The owner acts on anything but `idle`. */
export type LootPickupState = 'idle' | 'collected' | 'expired';

const BODY_PX = 56;
const AURA_PX = 92;
const BOB_AMPLITUDE_PX = 7;
const BOB_PERIOD_MS = 1400;
const COLLECT_PX = 30;
/** How far past the pickup radius the hero must step before a linger drop re-arms. */
const LEAVE_MARGIN_PX = 60;
const LOOT_DEPTH = 8;
const AURA_DEPTH = 7;
/** Aura tint for non-item atoms (pickup = bone, key = Dread violet). */
const PICKUP_AURA = 0xeae1bf;
const KEY_AURA = 0xad6eef;

/**
 * Art for a payload: items resolve through the icon atlas registry
 * (`ICON['icon-gear-<base>' | 'icon-uniq-<id>' | 'icon-val-<id>']` → sheet +
 * frame); pickups/keys are their own looping `pk-*` sheets (anim key = id).
 * Null when the registry has no row — the caller falls back to a tinted disc.
 */
function lootArt(p: LootPayload): { key: string; frame: number; anim: string | null } | null {
  if (p.kind !== 'item') {
    const key = p.kind === 'key' ? PICKUP_ART.key : pickupDef(p.id).art;
    return { key, frame: 0, anim: key };
  }
  const item = p.item;
  const id =
    item.kind === 'valuable'
      ? `icon-val-${item.item.id}`
      : item.item.unique !== undefined
        ? `icon-uniq-${item.item.unique}`
        : `icon-gear-${item.item.base}`;
  const icon = (ICON as Readonly<Record<string, { key: string; frame: number }>>)[id];
  return icon === undefined ? null : { key: icon.key, frame: icon.frame, anim: null };
}

export class LootPickup extends Phaser.Physics.Arcade.Sprite {
  /** The payload this pickup carries. Valid only while active. */
  payload!: LootPayload;

  private readonly aura: Phaser.GameObjects.Image;
  /** Mandatory §11 2 px swatch ring (Worn/Burnished sit under the 3:1 floor). */
  private readonly rim: Phaser.GameObjects.Image;
  private armedAtMs = 0;
  private expiresAtMs: number | null = null;
  private restY = 0;
  private pulling = false;
  /**
   * Swap/refused drops (`lingerMs` set) ignore the hero until they have stepped
   * clear once: otherwise a refused item is re-collected, re-refused and
   * re-toasted every arm cycle while the hero stands on it (BAG FULL spam).
   */
  private waitForLeave = false;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEX.disc);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(LOOT_DEPTH);
    this.aura = scene.add.image(0, 0, TEX.ring).setDisplaySize(AURA_PX, AURA_PX).setDepth(AURA_DEPTH);
    this.rim = scene.add
      .image(0, 0, TEX.ring)
      .setTint(TIER_RING.color)
      .setDisplaySize(BODY_PX + TIER_RING.width * 2, BODY_PX + TIER_RING.width * 2)
      .setDepth(AURA_DEPTH);
    this.despawn();
  }

  /**
   * Puts `payload` on the ground. `nowMs` is SIM time; `armMs` is the beat
   * before the magnet engages; `lingerMs` null = waits forever.
   */
  drop(payload: LootPayload, x: number, y: number, nowMs: number, armMs: number, lingerMs: number | null): void {
    this.payload = payload;
    this.armedAtMs = nowMs + armMs;
    this.expiresAtMs = lingerMs === null ? null : nowMs + lingerMs;
    this.restY = y;
    this.pulling = false;
    this.waitForLeave = lingerMs !== null;

    const tint = payload.kind === 'item' ? rarityColor(itemRarity(payload.item)) : payload.kind === 'key' ? KEY_AURA : PICKUP_AURA;
    const art = lootArt(payload);
    const hasArt = art !== null && this.scene.textures.exists(art.key);
    this.anims.stop();
    if (hasArt) this.setTexture(art.key, art.frame).clearTint();
    else this.setTexture(TEX.disc).setTint(tint);
    this.setDisplaySize(BODY_PX, BODY_PX);

    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
    this.enableBody(false, x, y, true, true);
    this.setVelocity(0, 0);
    this.aura.setPosition(x, y).setTint(tint).setAlpha(0.55).setVisible(true);
    this.rim.setPosition(x, y).setVisible(payload.kind === 'item');
    if (hasArt && art.anim !== null) safePlay(this, art.anim, true);
  }

  /** One frame of ground behaviour (sim time); returns what happened. */
  tick(nowMs: number, playerX: number, playerY: number, radius: number): LootPickupState {
    if (this.expiresAtMs !== null && nowMs >= this.expiresAtMs) return 'expired';
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.hypot(dx, dy);

    if (this.waitForLeave && dist > radius + LEAVE_MARGIN_PX) this.waitForLeave = false;
    if (this.waitForLeave || nowMs < this.armedAtMs || dist > radius) {
      if (this.pulling) {
        this.pulling = false;
        this.setVelocity(0, 0);
        this.restY = this.y;
      }
      const phase = (nowMs % BOB_PERIOD_MS) / BOB_PERIOD_MS;
      this.y = this.restY + Math.sin(phase * Math.PI * 2) * BOB_AMPLITUDE_PX;
      this.aura.setPosition(this.x, this.y);
      this.rim.setPosition(this.x, this.y);
      return 'idle';
    }
    if (dist <= COLLECT_PX) return 'collected';
    this.pulling = true;
    const speed = TUNING.xp.orbSpeed;
    this.setVelocity((dx / dist) * speed, (dy / dist) * speed);
    this.aura.setPosition(this.x, this.y);
    this.rim.setPosition(this.x, this.y);
    return 'idle';
  }

  despawn(): void {
    this.setActive(false).setVisible(false);
    // Truthiness guard: on SHUTDOWN Phaser has already set `body` undefined.
    if (this.body) {
      this.setVelocity(0, 0);
      this.disableBody();
    }
    this.pulling = false;
    this.expiresAtMs = null;
    this.aura.setVisible(false);
    this.rim.setVisible(false);
  }

  /** Scene teardown — aura/rim are siblings, not children. */
  destroyAll(): void {
    this.aura.destroy();
    this.rim.destroy();
    this.destroy();
  }
}
