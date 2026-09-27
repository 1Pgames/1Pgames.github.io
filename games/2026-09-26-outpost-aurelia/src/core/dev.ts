import Phaser from 'phaser';
import { metaCatalogFor } from '../data/metaCatalog';
import { SIM_FAMILY } from '../sim/family';
import { SCENES } from './keys';
import { grantBooster, grantCurrency, loadMeta, resetMeta, saveMeta } from './progression';

/**
 * `window.__DEV__` — the console cheat panel for the playtester and for QA
 * agents, installed by `main.ts` ONLY when the URL carries `?debug` (same
 * presence convention as the Arcade debug overlay). Not gated on
 * `import.meta.env.DEV`: QA drives production preview builds, and a cheat on
 * a client-side save exposes nothing private.
 *
 *   __DEV__.help()                 list everything, incl. hooks this game lacks
 *   __DEV__.grantCurrency(5000)    meta currency
 *   __DEV__.maxMeta()              every capped shop entry to max + 10 of each booster
 *   __DEV__.resetSave()            fresh save (FTUE replay)
 *   __DEV__.teleport()             …any hook a slice registered, by name
 *
 * Built-ins act on the template meta save (`core/progression.ts`) and then
 * restart the active hub scenes so the UI re-reads it (a live run is never
 * restarted). A game whose own meta lives elsewhere EXTENDS a built-in by
 * registering a hook of the same name: it runs right after the built-in.
 *
 * Game-specific cheats are hooks: `registerDevHook(scene, name, fn, help)`.
 * Pass the scene that owns the state so the hook unregisters on its SHUTDOWN
 * (a stale closure over a dead scene is worse than no cheat). `DEV_HOOKS`
 * names the canonical set every game provides where the concept exists;
 * `help()` lists the ones still missing.
 */

export type DevHook = (...args: never[]) => unknown;

/** Canonical hooks: name → what it must do. Register each one your game has the concept for. */
export const DEV_HOOKS = {
  grantXp: 'grantXp(n) — account XP / level',
  unlockAll: 'unlockAll() — every unlockable content id (weapons, heroes, levels)',
  teleport: 'teleport() — move the hero to the current objective (gate, exit, POI)',
  skipTime: 'skipTime(seconds) — advance the run clock / waves',
  spawnBoss: 'spawnBoss() — spawn the next boss now',
} as const;

const DEBUG_PARAM = 'debug';

const enabled = ((): boolean => {
  try {
    // `location` is absent when the sim/CLI imports this module under node.
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has(DEBUG_PARAM);
  } catch {
    return false;
  }
})();

interface HookEntry {
  fn: DevHook;
  help: string;
}
const hooks = new Map<string, HookEntry>();
let game: Phaser.Game | null = null;

/** True when this page load carries `?debug` — build debug-only affordances behind it. */
export function devEnabled(): boolean {
  return enabled;
}

/**
 * Registers a named cheat on `window.__DEV__` (`__DEV__.<name>(...)` and
 * `__DEV__.call(name, ...)`). No-op without `?debug`. With a `scene`, the
 * hook is removed on that scene's SHUTDOWN.
 */
export function registerDevHook(scene: Phaser.Scene | null, name: string, fn: DevHook, help: string): void {
  if (!enabled) return;
  const entry: HookEntry = { fn, help };
  hooks.set(name, entry);
  scene?.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (hooks.get(name) === entry) hooks.delete(name);
  });
}

/** Runs a registered hook; a missing one returns an explanation instead of throwing in the console. */
function callHook(name: string, args: readonly unknown[]): unknown {
  const entry = hooks.get(name);
  if (entry === undefined) return `no "${name}" hook registered by this game/scene — see __DEV__.help()`;
  return (entry.fn as (...a: readonly unknown[]) => unknown)(...args);
}

/** Restarts every running scene except the run itself, so hub UI re-reads the save. */
function refreshHub(): void {
  if (game === null) return;
  for (const scene of game.scene.getScenes(true)) {
    const key = scene.sys.settings.key;
    if (key === SCENES.game || key === SCENES.boot || key === SCENES.preload) continue;
    scene.scene.restart();
  }
}

/** Runs a built-in, then the game's same-named extension hook if any, then refreshes the hub. */
function builtin(name: string, args: readonly unknown[], body: () => string): string {
  const summary = body();
  const ext = hooks.get(name);
  if (ext !== undefined) (ext.fn as (...a: readonly unknown[]) => unknown)(...args);
  refreshHub();
  return ext === undefined ? summary : `${summary} (+ game hook)`;
}

const BUILTINS = {
  help(): string[] {
    const lines = [
      'built-ins: grantCurrency(n=5000) · maxMeta() · resetSave() · hooks() · call(name, ...args) · refresh()',
      ...[...hooks].map(([name, h]) => `hook ${name}: ${h.help}`),
    ];
    for (const [name, what] of Object.entries(DEV_HOOKS)) if (!hooks.has(name)) lines.push(`MISSING ${what}`);
    console.info(lines.join('\n'));
    return lines;
  },
  hooks(): string[] {
    return [...hooks.keys()];
  },
  call(name: string, ...args: unknown[]): unknown {
    return callHook(name, args);
  },
  refresh(): void {
    refreshHub();
  },
  grantCurrency(n = 5000): string {
    return builtin('grantCurrency', [n], () => `currency ${grantCurrency(n).currency}`);
  },
  maxMeta(): string {
    return builtin('maxMeta', [], () => {
      const meta = loadMeta();
      let maxed = 0;
      for (const entry of metaCatalogFor(SIM_FAMILY)) {
        if (!Number.isFinite(entry.maxLevel)) continue;
        meta.upgrades[entry.id] = entry.maxLevel;
        maxed += 1;
      }
      saveMeta(meta);
      let boosters = 0;
      for (const entry of metaCatalogFor(SIM_FAMILY)) {
        if (entry.boosterId === undefined) continue;
        grantBooster(entry.boosterId, 10);
        boosters += 1;
      }
      return `${maxed} entries maxed, ${boosters} booster kinds +10`;
    });
  },
  resetSave(): string {
    return builtin('resetSave', [], () => {
      resetMeta();
      return 'save reset';
    });
  },
};

/**
 * Installs `window.__DEV__` (called once from `main.ts` after the game is
 * created). Without `?debug` nothing is installed. Registered hooks are
 * reachable as methods (`__DEV__.teleport()`), resolved at call time.
 */
export function installDevApi(instance: Phaser.Game): void {
  if (!enabled || typeof window === 'undefined') return;
  game = instance;
  const api = new Proxy(BUILTINS, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target) && hooks.has(prop)) {
        return (...args: unknown[]) => callHook(prop, args);
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      return prop in target || (typeof prop === 'string' && hooks.has(prop));
    },
  });
  // A window WE own, same convention as `__GAME__` / `__AUDIO__`.
  (window as unknown as { __DEV__?: typeof BUILTINS }).__DEV__ = api;
  console.info('[__DEV__] cheats enabled (?debug) — __DEV__.help()');
}
