/** Scene, texture and storage keys. Strings are never duplicated inline. */

export const SCENES = {
  boot: 'Boot',
  preload: 'Preload',
  menu: 'Menu',
  meta: 'Meta',
  game: 'Game',
  gameOver: 'GameOver',
} as const;

export type SceneKey = (typeof SCENES)[keyof typeof SCENES];

/** Procedural textures registered by BootScene. See core/textures.ts. */
export const TEX = {
  disc: 'tex-disc',
  ring: 'tex-ring',
  spike: 'tex-spike',
  star: 'tex-star',
  square: 'tex-square',
  particle: 'tex-particle',
  panel: 'tex-panel',
} as const;

export const STORE = {
  muted: 'muted',
  settings: 'settings',
} as const;
