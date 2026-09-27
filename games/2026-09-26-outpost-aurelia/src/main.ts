import Phaser from 'phaser';
import { PALETTE, VIEW } from './config';
import { installDevApi } from './core/dev';
import { armLoopVisibility, armWakeLock } from './core/wake';
import { BootScene } from './scenes/boot';
import { PreloadScene } from './scenes/preload';
import { HubScene } from './scenes/hub/hub';
import { GameScene } from './scenes/game';
import { GameOverScene } from './scenes/gameover';

/**
 * Portrait 9:16 game bootstrap. Internal resolution is fixed (VIEW), so every
 * coordinate in the codebase is resolution-independent: Phaser scales the canvas
 * to whatever the device/recording window is.
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: PALETTE.bgDeep,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: VIEW.width,
    height: VIEW.height,
  },
  render: {
    antialias: true,
    powerPreference: 'high-performance',
    // Flip to `pixelArt: true` (and antialias:false) for a chunky retro look.
    pixelArt: false,
    roundPixels: false,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: import.meta.env.DEV && new URLSearchParams(location.search).has('debug'),
    },
  },
  input: {
    activePointers: 3,
    touch: { capture: true },
  },
  fps: { target: 60, forceSetTimeOut: false },
  autoFocus: true,
  disableContextMenu: true,
  // Boot → Preload → Hub (§14b): the Hub settles a pending checkpoint, auto-starts the
  // first-ever Landing, and otherwise opens on LAND.
  scene: [BootScene, PreloadScene, HubScene, GameScene, GameOverScene],
};

const game = new Phaser.Game(config);

// Debug handle: lets a browser console — or an agent driving the page — inspect
// scenes and live entity counts, e.g.
//   __GAME__.scene.getScene('Game').composition()
// Harmless in production: a client-side game exposes nothing private.
(window as unknown as { __GAME__: Phaser.Game }).__GAME__ = game;

// `window.__DEV__` cheats (grant currency, max meta, slice hooks such as
// teleport / skipTime) — installed only when the URL carries `?debug`.
installDevApi(game);

// Hand the screen over from the HTML splash once the first scene is rendering.
game.events.once(Phaser.Core.Events.READY, () => {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('hidden');
  window.setTimeout(() => splash.remove(), 260);
});

// Offline shell (public/sw.js). PROD-only on purpose: a worker caching the dev
// server would serve stale modules and break HMR. `vite preview` on localhost
// is a secure context, so the install path is testable locally. Relative URL
// keeps the scope at `/play/<slug>/` when several games share a host.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* unsupported, blocked by policy or already claimed — game plays online */
  });
}

// Keep the screen awake once the player actually touches the game.
armWakeLock();

// Pause while the tab/app is hidden so recordings never desync — and be able
// to come back. NEVER hand-roll this as a `visibilitychange` -> sleep/wake
// pair: `sleep()` stops the rAF chain, so an edge-triggered restore wedges the
// game forever the moment Chrome coalesces the wake-up event. `wake.ts` owns
// the level-triggered policy and the measurement behind it.
armLoopVisibility(game.loop);
