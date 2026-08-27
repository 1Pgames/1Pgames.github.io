/**
 * Generated-art registry: the only place that knows asset paths and frame
 * geometry. Every sheet under `public/assets/generated/` was produced by the
 * `game-art` skill (native generate_image + sprite-forge export) against
 * `art/style.json`, so the whole set shares one style contract.
 *
 * Re-generating an asset changes exactly one row here. Frame geometry comes
 * from each asset's `sprite-metadata.json` — never guess it.
 *
 * Pure data, no Phaser import.
 */

export interface SpriteAsset {
  /** Phaser texture key; also the animation key when `frames > 1`. */
  key: string;
  /** Path under `public/`. */
  path: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  /** ms per frame; ignored when `frames === 1`. */
  duration: number;
  loop: boolean;
  /**
   * Display-size compensation. Generated actions do not fill their cell to the
   * same height (measured subject heights in the 256px hero cells: idle 171,
   * run 146, attack 162, hurt 165), so switching animation would visibly resize
   * the character. The entity multiplies its tuned size by this factor, which is
   * `idleHeight / thisHeight`. Default 1.
   */
  scale?: number;
  /**
   * Which way the unflipped art faces. The chibi hero art reads as moving LEFT
   * (cloak trails right), so flipping on `velocity.x < 0` faced it backwards.
   * Default true.
   */
  facesRight?: boolean;
}

const BODY = 256;
const FX = 128;

/** Animated sheets: loaded as spritesheets, one animation created per entry. */
export const SPRITES: readonly SpriteAsset[] = [
  // Hero
  { key: 'hero-idle', path: 'assets/generated/hero/hero-idle/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 140, loop: true, facesRight: false },
  { key: 'hero-run', path: 'assets/generated/hero/hero-run/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 8, duration: 110, loop: true, scale: 1.17, facesRight: false },
  { key: 'hero-attack', path: 'assets/generated/hero/hero-attack/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 90, loop: false, scale: 1.06, facesRight: false },
  { key: 'hero-hurt', path: 'assets/generated/hero/hero-hurt/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 90, loop: false, scale: 1.04, facesRight: false },

  // Enemies — light
  { key: 'swarm-move', path: 'assets/generated/enemies-light/swarm-move/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 110, loop: true },
  { key: 'runner-move', path: 'assets/generated/enemies-light/runner-move/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 110, loop: true },
  { key: 'shooter-idle', path: 'assets/generated/enemies-light/shooter-idle/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 140, loop: true },
  { key: 'healer-idle', path: 'assets/generated/enemies-light/healer-idle/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 140, loop: true },

  // Enemies — heavy
  { key: 'tank-move', path: 'assets/generated/enemies-heavy/tank-move/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 130, loop: true },
  { key: 'splitter-move', path: 'assets/generated/enemies-heavy/splitter-move/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 120, loop: true },
  { key: 'elite-move', path: 'assets/generated/enemies-heavy/elite-move/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 110, loop: true },
  { key: 'boss-idle', path: 'assets/generated/enemies-heavy/boss-idle/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 150, loop: true },

  // Pickups and FX
  { key: 'xp-orb', path: 'assets/generated/pickups-fx/xp-orb/sprite-sheet.png', frameWidth: FX, frameHeight: FX, frames: 4, duration: 90, loop: true },
  { key: 'coin', path: 'assets/generated/pickups-fx/coin/sprite-sheet.png', frameWidth: FX, frameHeight: FX, frames: 4, duration: 90, loop: true },
  { key: 'hit-spark', path: 'assets/generated/pickups-fx/hit-spark/sprite-sheet.png', frameWidth: FX, frameHeight: FX, frames: 4, duration: 60, loop: false },
  { key: 'levelup-burst', path: 'assets/generated/pickups-fx/levelup-burst/sprite-sheet.png', frameWidth: FX, frameHeight: FX, frames: 4, duration: 90, loop: false },

  // Icon sheets are static art, but ship as multi-frame sheets: loaded as
  // spritesheets so a frame index can be selected, with no animation created.
  { key: 'icons', path: 'assets/generated/ui/icons/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 0, loop: false },
  { key: 'icons-b', path: 'assets/generated/ui/icons-b/sprite-sheet.png', frameWidth: BODY, frameHeight: BODY, frames: 4, duration: 0, loop: false },
] as const;

/** Single-image textures: no animation, no frame slicing. */
export const IMAGES: readonly SpriteAsset[] = [
  // Arena surface: seamless floor tile plus flat, non-colliding decals.
  { key: 'arena-floor', path: 'assets/generated/arena/floor/sprite.png', frameWidth: 512, frameHeight: 512, frames: 1, duration: 0, loop: false },
  { key: 'arena-cracks', path: 'assets/generated/arena/decal-cracks/sprite.png', frameWidth: BODY, frameHeight: BODY, frames: 1, duration: 0, loop: false },
  { key: 'arena-plate', path: 'assets/generated/arena/decal-plate/sprite.png', frameWidth: BODY, frameHeight: BODY, frames: 1, duration: 0, loop: false },

  // Arena props — impassable obstacles placed by `systems/arena.ts`.
  { key: 'prop-rock', path: 'assets/generated/props/rock/sprite.png', frameWidth: BODY, frameHeight: BODY, frames: 1, duration: 0, loop: false },
  { key: 'prop-crystal', path: 'assets/generated/props/crystal/sprite.png', frameWidth: BODY, frameHeight: BODY, frames: 1, duration: 0, loop: false },
  { key: 'prop-pillar', path: 'assets/generated/props/pillar/sprite.png', frameWidth: BODY, frameHeight: BODY, frames: 1, duration: 0, loop: false },
  { key: 'prop-stump', path: 'assets/generated/props/stump/sprite.png', frameWidth: BODY, frameHeight: BODY, frames: 1, duration: 0, loop: false },
  { key: 'bullet', path: 'assets/generated/pickups-fx/bullet/sprite.png', frameWidth: FX, frameHeight: FX, frames: 1, duration: 0, loop: false },
  // Full-bleed backdrop: the provider returned 1664x2496 (2:3, portrait); the
  // scene stretches it to the 720x1280 frame, so only the aspect matters.
  { key: 'bg-arena', path: 'assets/generated/bg/arena/sprite.png', frameWidth: 1664, frameHeight: 2496, frames: 1, duration: 0, loop: false },
  { key: 'logo', path: 'assets/generated/bg/logo/sprite.png', frameWidth: BODY, frameHeight: BODY, frames: 1, duration: 0, loop: false },
] as const;

const BY_KEY: Record<string, SpriteAsset> = {};
for (const asset of SPRITES) BY_KEY[asset.key] = asset;

/** Display-size factor for an animation key (1 when the asset needs none). */
export function artScale(key: string): number {
  return BY_KEY[key]?.scale ?? 1;
}

/** True when the unflipped art faces right. */
export function artFacesRight(key: string): boolean {
  return BY_KEY[key]?.facesRight ?? true;
}

/** Static texture keys, so gameplay code never types a string literal. */
export const TEXTURE = {
  bullet: 'bullet',
  backdrop: 'bg-arena',
  logo: 'logo',
} as const;

/** Frame index per icon inside the two icon sheets. */
export const ICON = {
  heart: { key: 'icons', frame: 0 },
  star: { key: 'icons', frame: 1 },
  coin: { key: 'icons', frame: 2 },
  bolt: { key: 'icons', frame: 3 },
  shield: { key: 'icons-b', frame: 0 },
  skull: { key: 'icons-b', frame: 1 },
  clock: { key: 'icons-b', frame: 2 },
  levelUp: { key: 'icons-b', frame: 3 },
} as const;

/**
 * UI chrome (panels, buttons, bar housings) is NOT art: it is drawn with
 * primitives in `ui/primitives.ts` so it adapts to any size and re-skins with
 * `PALETTE`. Generated art is used for content that is genuinely drawing —
 * icons, the title emblem, the backdrop and every entity.
 */

/** Animation keys, so gameplay code never types a string literal. */
export const ANIM = {
  heroIdle: 'hero-idle',
  heroRun: 'hero-run',
  heroAttack: 'hero-attack',
  heroHurt: 'hero-hurt',
  hitSpark: 'hit-spark',
  levelUpBurst: 'levelup-burst',
  xpOrb: 'xp-orb',
  coin: 'coin',
} as const;
