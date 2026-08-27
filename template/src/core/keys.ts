/** Scene, event, texture and storage keys. Strings are never duplicated inline. */

export const SCENES = {
  boot: 'Boot',
  preload: 'Preload',
  menu: 'Menu',
  meta: 'Meta',
  game: 'Game',
  gameOver: 'GameOver',
} as const;

export type SceneKey = (typeof SCENES)[keyof typeof SCENES];

/** Cross-scene events emitted on the global bus (`game.events`). */
export const EVENTS = {
  runStarted: 'run:started',
  runEnded: 'run:ended',
  paused: 'run:paused',
  resumed: 'run:resumed',
  levelUp: 'run:levelup',
  phaseChanged: 'run:phase',
  metaChanged: 'meta:changed',
} as const;

/** Procedural textures registered in Preload. See core/textures.ts. */
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
  best: 'best',
  runs: 'runs',
  muted: 'muted',
  settings: 'settings',
} as const;
