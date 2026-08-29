/**
 * Golden-path certification driver — the machine playtest every game must pass
 * before release. `scripts/release-check.mjs` (`checkCert`) reads the report it
 * writes and fails the release gate unless `passed === true`.
 *
 * This module is NOT a CLI. It runs INSIDE the `xd://browser` tool's `run`
 * sandbox, which is a full Node context with a live puppeteer `page`/`tab` for
 * the game under test. That is the only place where "drive the real build" and
 * "write a file into the repo" are both possible, so the driver is an importable
 * ESM module rather than a script.
 *
 * ---------------------------------------------------------------------------
 * USAGE — two `xd://browser` calls, against the game under test in games/<slug>
 * ---------------------------------------------------------------------------
 *
 * 0. Serve the game first (any port; keep `url`/`baseUrl` below in sync):
 *    `npm run preview -- --port 5322` inside games/<slug>, or point at the
 *    vite dev server (default 5173). `<repo>` below = the repo root.
 *
 * 1. Open the tab once. Portrait, so the 720x1280 design space maps cleanly:
 *
 *    {"action":"open","name":"cert","url":"http://localhost:5322/",
 *     "viewport":{"width":432,"height":768,"scale":2},
 *     "wait_until":"networkidle2","timeout":60}
 *
 * 2. Run the cert. Paste this into the `code` field, with `timeout` >= 600:
 *
 *    const fs = await import('node:fs');
 *    // The run sandbox caches ESM by resolved path and IGNORES a `?v=` query,
 *    // so a fresh filename is the only way to pick up an edited driver in a
 *    // live session. Harmless on a first run; essential while iterating.
 *    const tmp = `<repo>/scripts/.cert-run-${Date.now()}.mjs`;
 *    fs.copyFileSync('<repo>/scripts/cert-driver.mjs', tmp);
 *    let report;
 *    const log = [];
 *    try {
 *      const mod = await import(`file://${tmp}`);
 *      report = await mod.runCert({
 *        tab, page,
 *        baseUrl: 'http://localhost:5322/',
 *        gameDir: '<repo>/games/<slug>',
 *        slug: '<slug>',
 *        familyAdapter: mod.adapters.board,
 *        logger: (m) => log.push(m),
 *      });
 *    } finally { fs.rmSync(tmp, { force: true }); }
 *    display(log.join('\n'));
 *    display({ passed: report.passed, path: report.reportPath,
 *              blockers: report.blockers, majors: report.majors,
 *              measurements: report.measurements });
 *
 * `runCert` writes `<gameDir>/cert-report.json` itself and returns the report;
 * `writeReport` is exported for callers that want to re-emit it elsewhere. A
 * failing cert RESOLVES with `passed: false` — only a broken harness throws.
 *
 * Observed cost on the board family: ~165s, 4 levels played, 40 screenshots.
 *
 * ---------------------------------------------------------------------------
 * TWO SANDBOX FACTS THAT WILL COST YOU AN HOUR EACH
 * ---------------------------------------------------------------------------
 * - `page.evaluate` runs in an ISOLATED world and cannot see `window.__GAME__`
 *   (it shares the DOM, not the JS globals). Every game introspection here goes
 *   through `tab.evaluate`, which runs in the main world. `page` is used only
 *   for real input (`page.mouse`), `page.screenshot` and `page.on` collectors.
 * - A Phaser `Button` commits on POINTER_UP and only if a POINTER_DOWN landed
 *   on it first, and Phaser does not hit-test an object at `alpha === 0`. A tap
 *   fired the instant a screen appears is therefore correctly ignored while the
 *   screen fades in. `ctx.tapLabel` waits for position AND alpha to settle
 *   before pressing — without that the driver invents dead buttons.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CERTIFIES
 * ---------------------------------------------------------------------------
 * 1. Cold boot on a wiped save, with console/pageerror collectors armed. ANY
 *    console error or uncaught exception is a blocker.
 * 2. The FTUE walk: every coach beat is screenshotted and completed (tap beats
 *    by tapping, gated beats through the adapter), and a beat that shows up
 *    twice in one save is a blocker.
 * 3. The core loop, driven by the adapter's `pick` policy, to BOTH outcomes —
 *    a win session and a loss session (the loss session seeds a hard rung via
 *    the adapter's `prepareLoss` hook and plays anti-goal).
 * 4. The surface tour: results -> PLAY NEXT / RETRY, shop (enter, buy, scrolled
 *    buy, re-enter twice), pre-level picker (select -> tooltip -> X), pause
 *    (RESUME / RESTART / MENU), menu -> back into a level. Every screen is
 *    screenshotted into `<gameDir>/shots/cert/`.
 * 5. The quality budgets from `template/AGENTS.md` — input acknowledgment,
 *    swallowed input, scene transitions, retry-to-playable, fps at the heaviest
 *    driven beat, and tap depth from boot to the core action.
 * 6. The adapter's invariant sweep after every settled action. A violation is a
 *    blocker: it means the view layer and the model have drifted apart.
 *
 * ---------------------------------------------------------------------------
 * WRITING A FAMILY ADAPTER
 * ---------------------------------------------------------------------------
 * The engine is family-agnostic: it only knows scenes, interactive objects,
 * screenshots and clocks. Everything that needs to understand the game is on
 * the adapter. An adapter has two halves:
 *
 *   adapter.page.*   Functions SERIALIZED into the browser and run there via
 *                    `tab.evaluate`. They must be self-contained (no closures
 *                    over module scope) and may only reach the game through
 *                    `window.__GAME__`. They take at most one JSON argument.
 *   adapter.<method> Node-side orchestration (`enterLevel`, `completeGate`,
 *                    `playLevel`, ...) which uses the `ctx` helpers below.
 *   adapter.phases   The ordered tour `runCert` drives after the generic cold
 *                    boot — one async function per phase, each taking `ctx`.
 *                    The engine knows scenes and clocks; the ORDER of a
 *                    family's loop (win path, loss path, shop/meta, re-entry)
 *                    is family knowledge and lives here.
 *
 * `ctx` gives an adapter: `tap`, `drag`, `tapLabel`, `stableControl`, `buttons`,
 * `shot`, `waitFor`, `settle`, `settleUntil`, `sceneKeys`, `state`, `evalPage`,
 * `mark`, `reload`, `blocker`, `major`, `note`, `sweep`, `pumpCoaches` and
 * `navigate`.
 *
 * ---------------------------------------------------------------------------
 * THE REPORT
 * ---------------------------------------------------------------------------
 * `<gameDir>/cert-report.json`:
 *
 *   passed            blockers.length === 0
 *   blockers[]        {id, message, evidence?, seen?} — release-blocking
 *   majors[]          same shape — recorded, not release-blocking
 *   measurements      ack | swallowedInput | transitions | retryToPlayable |
 *                     fps | tapDepth, each with its budget, samples and a
 *                     pass/fail/unmeasured verdict
 *   beats[]           {id, shot, gated} — one per FTUE coach beat walked
 *   surfaces[]        {name, shot} — every screen captured
 *   outcomes          {win, loss} — both must be non-null
 *   consoleErrors[]   every console error / uncaught exception, each a blocker
 *   invariantSweeps   how many settled states were checked
 *   notes             per-phase evidence (purchases, tooltips, epochs, ...)
 *
 * Blocker vs major: a blocker is a broken contract — a console error, a
 * persisting model/view desync, a dead end, a missing outcome, or a quality
 * budget the build is measurably over. A major is a defect that did not stop
 * the golden path (a control needing two taps, a screen with nothing to buy).
 * Findings are deduplicated by `id` and carry a `seen` count.
 *
 * Two ideas keep the report honest and are worth preserving in any edit:
 * transient states are not defects (the invariant sweep only reports a
 * violation that survives three samples 500ms apart, because `busy === false`
 * means the model is at rest, not that the last burst finished painting), and
 * every duration is measured on the PAGE clock between two page-side events —
 * never across the driver's own round trips, which would bill the harness's
 * pacing to the game.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// --- budgets (template/AGENTS.md "Quality budgets") -------------------------

export const BUDGETS = {
  /** Input acknowledgment: a visible reaction within this many ms. */
  ackMs: 100,
  /** Scene transitions: decision tap -> next scene on screen. */
  transitionMs: 400,
  /** Retry/restart: decision tap -> playable again. */
  retryMs: 2000,
  /** 60fps at peak; a sampled median below this fails, a single frame may dip. */
  fpsMedianMin: 55,
  fpsMinMin: 40,
  /** Taps from boot to the core action. */
  tapDepth: 2,
};

const SHOT_DIR = ['shots', 'cert'];
const REPORT_NAME = 'cert-report.json';

// --- page-side instrumentation ----------------------------------------------

/**
 * Installed after every navigation. Idempotent, and re-arms itself: scenes boot
 * asynchronously, so the per-frame hook re-checks the scene list each frame
 * instead of assuming everything exists at install time.
 *
 * Everything it records uses ONE clock (`performance.now()` in the page), so
 * durations composed from a tap timestamp and a frame timestamp are exact
 * rather than round-trip-inflated.
 */
const pgInstall = (arg) => {
  const g = window.__GAME__;
  if (!g) return { ok: false, why: 'no window.__GAME__' };
  if (window.__CERT__ && window.__CERT__.installed) return { ok: true, reused: true };

  const cert = {
    installed: true,
    /**
     * The family's live simulation scene. Its labels change every frame (a run
     * clock, a score, a shard count), so it is the one screen where TEXT is not
     * evidence that a tap was acknowledged.
     */
    gameScene: arg && arg.gameScene ? arg.gameScene : null,
    t0: performance.now(),
    /** Armed ack probe: { label, base, down, ack, changed }. */
    pending: null,
    acks: [],
    fps: [],
    scenes: [],
    marks: [],
    busyProbe: null,
    lastFpsAt: 0,
    frames: 0,
    /**
     * Page-clock windows the fps scan must ignore. A `page.screenshot` stalls
     * the compositor for a few hundred ms and `loop.actualFps` is a SMOOTHED
     * average, so a capture depresses the reading well after the capture is
     * over — measured at a 3s median of 51.5fps across a burst of surface
     * screenshots on a build that held 110fps either side of them. Billing the
     * measuring instrument to the game is the same mistake as measuring a
     * transition across the driver's own round trip.
     */
    blackouts: [],
    /** Page-clock time of the most recent pointerup — the "decision" instant. */
    lastPointerUp: null,
    /** Where the browser actually delivered the last events, in DESIGN space. */
    lastDownPoint: null,
    lastUpPoint: null,
  };
  window.__CERT__ = cert;

  /** CSS client point -> the game's own design coordinates. */
  const toDesign = (e) => {
    const r = g.canvas.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * g.scale.width),
      y: Math.round(((e.clientY - r.top) / r.height) * g.scale.height),
      target: e.target instanceof Element ? e.target.tagName : String(e.target),
    };
  };

  // Capture-phase listeners beat Phaser's own canvas listener, so these are the
  // moments the input entered the page, not the moments the game noticed. Every
  // timing budget is measured from one of them: a button fires on POINTER_UP,
  // so `lastPointerUp` is the instant a decision was made. The design-space
  // point settles the only other question a dropped tap raises: did the event
  // land where the driver aimed, or did the driver miss?
  window.addEventListener(
    'pointerdown',
    (e) => {
      cert.lastDownPoint = toDesign(e);
      if (cert.pending !== null && cert.pending.down === null) cert.pending.down = performance.now();
    },
    { capture: true },
  );
  window.addEventListener(
    'pointerup',
    (e) => {
      cert.lastPointerUp = performance.now();
      cert.lastUpPoint = toDesign(e);
    },
    { capture: true },
  );

  /**
   * Visual signature of the things a tap is allowed to move: interactive
   * objects (buttons scale on their own POINTER_DOWN), the board selector, and
   * the piece views. Ambient background loops are deliberately EXCLUDED — they
   * change every frame and would forge an instant acknowledgment.
   */
  const signature = () => {
    const active = g.scene.scenes.filter((s) => s.scene.isActive());
    let sig = '';
    const walk = (list) => {
      for (const o of list) {
        if (o.input) {
          sig += `|${o.type}:${Math.round(o.x)},${Math.round(o.y)},${(o.scaleX ?? 1).toFixed(3)},${(
            o.alpha ?? 1
          ).toFixed(2)},${o.visible ? 1 : 0}`;
        }
        if (o.list) walk(o.list);
      }
    };
    /**
     * Label content, for every screen that is NOT the live simulation.
     *
     * Half the controls in this template answer a tap by REPAINTING rather
     * than by moving: a gear cell that swaps "TAP TO EQUIP" for a relic name,
     * a shop row whose price becomes a level, a mute toggle. Those repaints
     * rebuild objects at the same coordinates, so a geometry-only signature
     * reads them as "no reaction at all" and the driver invents a dead
     * control. (Measured: the arena cert's gear cell equipped correctly and
     * was still reported as a silent tap.) Excluded on the game scene, where a
     * running clock would forge an instant acknowledgment for every tap.
     */
    const walkText = (list) => {
      for (const o of list) {
        if (typeof o.text === 'string' && o.text.length > 0) sig += `|t:${o.text}`;
        if (o.list) walkText(o.list);
      }
    };
    for (const s of active) {
      sig += `#${s.scene.key}`;
      walk(s.children.list);
      if (s.scene.key !== cert.gameScene) walkText(s.children.list);
      if (s.selector) sig += `|sel:${s.selector.visible ? 1 : 0},${Math.round(s.selector.x)},${Math.round(s.selector.y)}`;
      if (s.selected) sig += `|selc:${s.selected.col},${s.selected.row}`;
      if (Array.isArray(s.views)) {
        for (let i = 0; i < s.views.length; i += 1) {
          const v = s.views[i];
          if (v && v.root) sig += `|v${i}:${Math.round(v.root.x)},${Math.round(v.root.y)},${(v.root.scaleX ?? 1).toFixed(2)}`;
        }
      }
    }
    return sig;
  };
  cert.signature = signature;

  let lastKeys = '';
  g.events.on('poststep', () => {
    const now = performance.now();
    cert.frames += 1;

    // fps track — 100ms buckets, kept for the whole session so any window can
    // be scored after the fact.
    if (now - cert.lastFpsAt >= 100) {
      cert.lastFpsAt = now;
      cert.fps.push({ t: Math.round(now), fps: Math.round(g.loop.actualFps * 10) / 10 });
      if (cert.fps.length > 6000) cert.fps.shift();
    }

    // scene transition log
    const keys = g.scene.scenes
      .filter((s) => s.scene.isActive())
      .map((s) => s.scene.key)
      .join('+');
    if (keys !== lastKeys) {
      lastKeys = keys;
      cert.scenes.push({ t: Math.round(now), keys });
      if (cert.scenes.length > 400) cert.scenes.shift();
    }

    // ack probe
    const p = cert.pending;
    if (p !== null && p.down !== null && p.ack === null) {
      const sig = signature();
      if (sig !== p.base) {
        p.ack = now;
        p.ms = Math.round((now - p.down) * 100) / 100;
        cert.acks.push({ label: p.label, ms: p.ms, frames: cert.frames - p.frame });
        cert.pending = null;
      } else if (now - p.down > 1500) {
        cert.acks.push({ label: p.label, ms: null, frames: cert.frames - p.frame, timedOut: true });
        cert.pending = null;
      }
    }
  });

  return { ok: true, reused: false };
};

/** Arms an ack probe. Baseline is captured BEFORE the pointer goes down. */
const pgArmAck = (label) => {
  const c = window.__CERT__;
  if (!c) return false;
  c.pending = { label, base: c.signature(), down: null, ack: null, frame: c.frames };
  return true;
};

const pgMark = (name) => {
  const c = window.__CERT__;
  if (!c) return false;
  c.marks.push({ t: Math.round(performance.now()), name });
  return true;
};

const pgCollect = () => {
  const c = window.__CERT__;
  if (!c) return null;
  return { acks: c.acks, fps: c.fps, scenes: c.scenes, marks: c.marks, frames: c.frames, blackouts: c.blackouts };
};

/** Opens an fps blackout; the returned page-clock instant closes it. */
const pgBlackoutStart = () => performance.now();

/** Closes one, with a tail long enough for the smoothed fps to recover. */
const pgBlackoutEnd = (from) => {
  const c = window.__CERT__;
  if (!c) return null;
  const window_ = [from, performance.now() + 700];
  c.blackouts.push(window_);
  if (c.blackouts.length > 400) c.blackouts.shift();
  return window_;
};

/** Design-space geometry of the canvas plus the live active-scene key list. */
const pgViewport = () => {
  const g = window.__GAME__;
  const r = g.canvas.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    sx: r.width / g.scale.width,
    sy: r.height / g.scale.height,
    designW: g.scale.width,
    designH: g.scale.height,
    keys: g.scene.scenes.filter((s) => s.scene.isActive()).map((s) => s.scene.key),
  };
};

const pgSceneKeys = () =>
  window.__GAME__.scene.scenes.filter((s) => s.scene.isActive()).map((s) => s.scene.key);

/**
 * Every interactive object in the active scenes, with its label (deepest Text
 * descendant) and design-space centre. Interactive objects are what a player
 * can touch, so this doubles as the "is this screen exitable" inventory.
 */
const pgButtons = () => {
  const g = window.__GAME__;
  const out = [];
  const labelOf = (o) => {
    if (typeof o.text === 'string' && o.text.length > 0) return o.text;
    if (o.list) {
      for (const c of o.list) {
        const t = labelOf(c);
        if (t) return t;
      }
    }
    return '';
  };
  for (const s of g.scene.scenes.filter((sc) => sc.scene.isActive())) {
    const walk = (list) => {
      for (const o of list) {
        if (o.input && o.input.enabled !== false) {
          let x = o.x;
          let y = o.y;
          let p = o.parentContainer;
          while (p) {
            x += p.x;
            y += p.y;
            p = p.parentContainer;
          }
          const hit = o.input.hitArea ?? null;
          out.push({
            scene: s.scene.key,
            label: labelOf(o),
            type: o.type,
            x: Math.round(x),
            y: Math.round(y),
            w: hit ? Math.round(hit.width ?? 0) : Math.round(o.width ?? 0),
            h: hit ? Math.round(hit.height ?? 0) : Math.round(o.height ?? 0),
            visible: o.visible !== false,
            alpha: Math.round((o.alpha ?? 1) * 100) / 100,
            depth: o.depth ?? 0,
          });
        }
        if (o.list) walk(o.list);
      }
    };
    walk(s.children.list);
  }
  return out;
};

/** Wipes the game's own localStorage namespace, unprefixed twins included. */
const pgWipe = (slug) => {
  const prefix = `${slug}:`;
  const keys = Object.keys(localStorage);
  const prefixed = keys.filter((k) => k.startsWith(prefix));
  // Older builds of the same game wrote the same names without the namespace;
  // leaving those behind means "fresh save" is a lie.
  const twins = new Set(prefixed.map((k) => k.slice(prefix.length)));
  const removed = [];
  for (const k of keys) {
    if (k.startsWith(prefix) || twins.has(k)) {
      localStorage.removeItem(k);
      removed.push(k);
    }
  }
  return { removed, left: Object.keys(localStorage) };
};

// --- board family adapter ---------------------------------------------------

/**
 * Match/blast/merge boards (`src/slices/board/`). The picker is the greedy
 * clone-test one: every adjacent pair is probed on a `board.clone()`, a swap
 * scores by what it clears, and special/special pairs outrank everything
 * because a combo is the family's biggest beat.
 */
const boardAdapter = {
  name: 'board',
  gameScene: 'Game',
  /** Names of the beats fps is scored over. */
  heavyBeats: ['combo-cascade', 'win-finale'],
  /** The phase sequence `runCert` drives after the generic cold boot. */
  phases: [phaseWinSession, phaseShop, phaseLossSession, phaseMenuReentry],

  page: {
    state: () => {
      const g = window.__GAME__;
      const active = g.scene.scenes.filter((s) => s.scene.isActive()).map((s) => s.scene.key);
      const s = g.scene.getScene('Game');
      const live = active.includes('Game');
      const d = live && s.started ? (s.director ?? null) : null;
      const goals = [];
      if (d && d.spec && Array.isArray(d.spec.goals)) {
        for (const gl of d.spec.goals) {
          const p = d.goalProgress(gl.id);
          goals.push({ id: gl.id, target: gl.target, current: p ? p.current : 0 });
        }
      }
      return {
        active,
        live,
        started: live ? !!s.started : false,
        busy: !!s.busy,
        paused: !!s.paused,
        ended: !!s.ended,
        coachActive: !!s.coachActive,
        coachId: s.activeCoach ? s.activeCoach.id : null,
        coachQueue: Array.isArray(s.coachQueue) ? s.coachQueue.map((b) => b.id) : [],
        gated: s.gatedSwap ? { a: { ...s.gatedSwap.a }, b: { ...s.gatedSwap.b } } : null,
        picker: !!s.boosterPicker,
        pickerBounds: s.boosterPicker ? { ...s.boosterPicker.bounds } : null,
        sagaMap: !!s.sagaMap,
        // The payload GameScene last booted with. Phaser keeps it across a
        // data-less scene.start, which is exactly the flow bug worth catching.
        sceneData: s.sys && s.sys.settings ? { ...(s.sys.settings.data ?? {}) } : null,
        requestedLevel: s.requestedLevel ?? null,
        replay: !!s.replay,
        pauseOpen: !!s.pauseOverlay,
        trayBounds: s.boosterTray ? { ...s.boosterTray.bounds } : null,
        trayArmed: s.boosterTray ? (s.boosterTray.armed ?? null) : null,
        levelIndex: live ? (s.levelIndex ?? null) : null,
        score: live ? (s.score ?? null) : null,
        movesLeft: d ? d.movesLeft : null,
        directorEnded: d ? d.ended : null,
        outcome: d && d.outcome ? { ...d.outcome } : null,
        goals,
        acceptsInput: !!(live && s.started && !s.busy && !s.paused && !s.ended && !(d && d.ended)),
        geom: live && s.started ? { cols: s.cols, rows: s.rows, cellPx: s.cellPx, originX: s.originX, boardTop: s.boardTop } : null,
      };
    },

    /** Design-space centre of a cell, straight off the scene's own geometry. */
    cellCenter: (cell) => {
      const s = window.__GAME__.scene.getScene('Game');
      return {
        x: s.originX + (cell.col + 0.5) * s.cellPx,
        y: s.boardTop + (cell.row + 0.5) * s.cellPx,
      };
    },

    /**
     * Greedy clone-test swap picker. `anti` inverts the ranking so the driver
     * can burn a move budget without feeding the order — how the loss session
     * is produced without touching game code.
     */
    pick: (anti) => {
      const s = window.__GAME__.scene.getScene('Game');
      const b = s.board ?? null;
      if (!b || !s.started || s.ended) return null;
      const PSEUDO = new Set(['__jar__', '__slime__', '__bottle__']);
      const movable = (p) =>
        p !== null &&
        p !== undefined &&
        !PSEUDO.has(p.kind) &&
        !(p.blocker && (p.blocker.kind === 'vine' || p.blocker.kind === 'ice'));
      const d = s.director ?? null;
      /** Open goals, and how much each still wants — a nearly-met goal is cheap. */
      const openGoals = new Map();
      if (d && d.spec && Array.isArray(d.spec.goals)) {
        for (const gl of d.spec.goals) {
          const p = d.goalProgress(gl.id);
          const current = p ? p.current : 0;
          if (current < gl.target) openGoals.set(gl.id, gl.target - current);
        }
      }
      /**
       * What a swap actually clears, measured on a clone rather than guessed:
       * run lengths per endpoint give both the size of the clear and whether it
       * mints a special (4+ in a row), which is where the family's real damage
       * comes from.
       */
      const clears = (a, c) => {
        const cl = b.clone();
        if (!cl.swap(a, c)) return null;
        let total = 0;
        let longest = 0;
        const kinds = [];
        for (const cell of [a, c]) {
          const kind = cl.matchKindAt(cell);
          if (kind === null) continue;
          const h = cl.runThrough(cell, kind, 1, 0);
          const v = cl.runThrough(cell, kind, 0, 1);
          let hit = 0;
          if (h >= 3) hit += h;
          if (v >= 3) hit += v;
          if (h >= 3 && v >= 3) hit -= 1; // the shared cell is counted once
          if (hit === 0) continue;
          total += hit;
          longest = Math.max(longest, h, v);
          kinds.push(kind);
        }
        return total === 0 ? null : { kinds, total, longest };
      };
      const cands = [];
      for (let row = 0; row < b.rows; row += 1) {
        for (let col = 0; col < b.cols; col += 1) {
          const a = { col, row };
          if (b.isBlocked(a)) continue;
          const pa = b.get(a);
          if (!movable(pa)) continue;
          for (const [dc, dr] of [
            [1, 0],
            [0, 1],
          ]) {
            const c = { col: col + dc, row: row + dr };
            if (!b.inBounds(c) || b.isBlocked(c)) continue;
            const pc = b.get(c);
            if (!movable(pc)) continue;
            const sa = pa.special ?? null;
            const sc = pc.special ?? null;
            // Two specials side by side is the biggest beat the family has, and
            // a philter takes a whole colour off the board.
            if (sa !== null && sc !== null) {
              cands.push({ a, b: c, score: 900, why: `combo:${sa}+${sc}` });
              continue;
            }
            if (sa === 'philter' || sc === 'philter') {
              cands.push({ a, b: c, score: 700, why: 'philter-swap' });
              continue;
            }
            // A lone line/bomb special is ALWAYS a legal swap in-game
            // (isResolvedSwap: a special endpoint detonates regardless of
            // runs). Without this rung the picker goes blind on a board
            // whose only remaining moves are special fires — the game keeps
            // accepting input, nothing is dead, and the driver falsely
            // reports board:no-move (observed on the w-30 loss run).
            if (sa !== null || sc !== null) {
              const hit = clears(a, c);
              if (hit === null) {
                cands.push({ a, b: c, score: 500, why: `special-fire:${sa ?? sc}` });
                continue;
              }
            }
            const hit = clears(a, c);
            if (hit === null) continue;
            const goalKinds = hit.kinds.filter((k) => openGoals.has(k));
            const score =
              hit.total * 4 +
              goalKinds.length * 40 +
              (goalKinds.length > 0 ? hit.total * 12 : 0) +
              (hit.longest >= 5 ? 120 : hit.longest === 4 ? 60 : 0) +
              (sa !== null || sc !== null ? 30 : 0);
            cands.push({
              a,
              b: c,
              score,
              why: `${goalKinds.length > 0 ? 'goal' : 'plain'}:${hit.kinds.join('/')}x${hit.total}${
                hit.longest >= 4 ? `+run${hit.longest}` : ''
              }`,
            });
          }
        }
      }
      if (cands.length === 0) return null;
      cands.sort((x, y) => (anti ? x.score - y.score : y.score - x.score));
      const p = cands[0];
      return { a: p.a, b: p.b, why: p.why, score: p.score, options: cands.length, anti: !!anti };
    },

    /**
     * View/model coherence sweep. Every one of these has a real failure mode
     * behind it: a recycled view left in two slots, a special badge surviving a
     * clear, a container orphaned in `boardLayer` after a cascade.
     *
     * ONLY valid on a settled board. Mid-cascade the two sides legitimately
     * disagree — a cleared cell's view is released before the refill drops its
     * replacement in, and the outgoing container is still in `boardLayer`
     * playing its burst. Sweeping then reports the animation, not a defect.
     */
    invariants: () => {
      const s = window.__GAME__.scene.getScene('Game');
      if (!s || !s.started || !s.board || !Array.isArray(s.views)) return { skipped: true, reason: 'no board', violations: [] };
      if (s.busy) return { skipped: true, reason: 'board in flight', violations: [] };
      const b = s.board;
      const v = s.views;
      const out = [];
      const PSEUDO = new Set(['__jar__', '__slime__', '__bottle__']);
      const idx = (col, row) => row * s.cols + col;
      const settled = true;

      // 1. occupancy — model and view agree on which cells hold a piece.
      for (let row = 0; row < b.rows; row += 1) {
        for (let col = 0; col < b.cols; col += 1) {
          const cell = { col, row };
          const blocked = b.isBlocked(cell);
          const piece = blocked ? null : b.get(cell);
          const view = v[idx(col, row)] ?? null;
          if (blocked && view !== null) out.push(`occupancy: blocked cell ${col},${row} has a view`);
          else if (!blocked && piece === null && view !== null) out.push(`occupancy: empty cell ${col},${row} has a view`);
          else if (!blocked && piece !== null && view === null) out.push(`occupancy: piece at ${col},${row} has no view`);
          if (!blocked && settled && piece === null) out.push(`occupancy: settled board has a hole at ${col},${row}`);
        }
      }

      // 2. shared views — one container may never back two cells.
      const seen = new Map();
      for (let i = 0; i < v.length; i += 1) {
        const view = v[i];
        if (!view || !view.root) continue;
        if (seen.has(view.root)) out.push(`shared-view: slots ${seen.get(view.root)} and ${i} share one container`);
        else seen.set(view.root, i);
      }

      // 3. badge / blocker decoration matches the piece it decorates.
      for (let row = 0; row < b.rows; row += 1) {
        for (let col = 0; col < b.cols; col += 1) {
          const cell = { col, row };
          if (b.isBlocked(cell)) continue;
          const piece = b.get(cell);
          const view = v[idx(col, row)] ?? null;
          if (piece === null || view === null) continue;
          if (PSEUDO.has(piece.kind)) continue;
          const special = (piece.special ?? null) !== null;
          if (special !== (view.badge !== null && view.badge !== undefined)) {
            out.push(`badge-mismatch: ${col},${row} special=${piece.special ?? 'null'} badge=${view.badge ? 'yes' : 'no'}`);
          }
          const vined = !!(piece.blocker && piece.blocker.kind === 'vine');
          if (vined !== (view.vine !== null && view.vine !== undefined)) {
            out.push(`badge-mismatch: ${col},${row} vine model=${vined} view=${!!view.vine}`);
          }
          const iced = !!(piece.blocker && piece.blocker.kind === 'ice');
          if (iced !== (view.ice !== null && view.ice !== undefined)) {
            out.push(`badge-mismatch: ${col},${row} ice model=${iced} view=${!!view.ice}`);
          }
        }
      }

      // 4. orphans — boardLayer holds exactly the live view roots, and every
      //    root still belongs to it.
      const live = [...seen.keys()];
      const layer = s.boardLayer ? s.boardLayer.list : [];
      if (layer.length !== live.length) {
        out.push(`orphan: boardLayer holds ${layer.length} containers for ${live.length} live views`);
      }
      const liveSet = new Set(live);
      for (const child of layer) if (!liveSet.has(child)) out.push('orphan: boardLayer child is referenced by no cell');
      for (const root of live) {
        if (root.parentContainer !== s.boardLayer) out.push('orphan: view root is not parented to boardLayer');
        if (root.scene === null || root.scene === undefined) out.push('orphan: view root was destroyed but is still referenced');
      }

      // 5. at rest, every view sits on its cell (the desync a shared or stale
      //    view produces shows up here even when counts line up).
      if (settled) {
        for (let row = 0; row < b.rows; row += 1) {
          for (let col = 0; col < b.cols; col += 1) {
            const view = v[idx(col, row)] ?? null;
            if (!view || !view.root) continue;
            const wantX = col * s.cellPx + s.cellPx / 2;
            const wantY = row * s.cellPx + s.cellPx / 2;
            if (Math.abs(view.root.x - wantX) > 3 || Math.abs(view.root.y - wantY) > 3) {
              out.push(
                `desync: view for ${col},${row} rests at ${Math.round(view.root.x)},${Math.round(view.root.y)} not ${Math.round(wantX)},${Math.round(wantY)}`,
              );
            }
          }
        }
      }

      return { skipped: false, settled, violations: out.slice(0, 12), count: out.length };
    },

    /** Seeds the save so a hard rung is reachable through the real saga map. */
    prepareLoss: (arg) => {
      localStorage.setItem(`${arg.slug}:board:level`, JSON.stringify(arg.levelIndex));
      return { unlockedThrough: arg.levelIndex };
    },

    /**
     * Arms the swallowed-input probe. It picks its OWN cell — one holding a
     * movable piece that nothing is currently animating — because a tap on a
     * hole or on a jar is refused by design and would forge a violation. The
     * container reference is kept, not the slot index: a cascade recycles views,
     * and comparing "tweens on slot i" across a refill compares two objects.
     *
     * It refuses to arm unless the board zone is the ONLY thing that can take
     * the tap: a coach card, the pause overlay or the map/picker legitimately
     * swallow input, and a probe fired under one of them proves nothing.
     */
    busyProbeArm: () => {
      const s = window.__GAME__.scene.getScene('Game');
      const b = s.board;
      if (s.activeCoach || s.pauseOverlay || s.sagaMap || s.boosterPicker) return null;
      if (s.boosterTray && s.boosterTray.armed !== null) return null;
      const PSEUDO = new Set(['__jar__', '__slime__', '__bottle__']);
      const tweensOn = (root) =>
        s.tweens.getTweens().filter((t) => Array.isArray(t.targets) && t.targets.includes(root)).length;
      for (let row = b.rows - 1; row >= 0; row -= 1) {
        for (let col = 0; col < b.cols; col += 1) {
          const cell = { col, row };
          if (b.isBlocked(cell)) continue;
          const piece = b.get(cell);
          if (piece === null) continue;
          if (PSEUDO.has(piece.kind)) continue;
          if (piece.blocker && (piece.blocker.kind === 'vine' || piece.blocker.kind === 'ice')) continue;
          const view = s.views[row * s.cols + col] ?? null;
          if (view === null || !view.root) continue;
          if (tweensOn(view.root) > 0) continue;
          // The tap must land inside the board's own input zone, or "no
          // reaction" would just mean "no listener".
          const x = s.originX + (col + 0.5) * s.cellPx;
          const y = s.boardTop + (row + 0.5) * s.cellPx;
          const inZone =
            x > s.originX && x < s.originX + s.boardWidth && y > s.boardTop && y < s.boardTop + s.boardHeight;
          if (!inZone) continue;
          window.__CERT__.busyProbe = {
            cell,
            root: view.root,
            busy: !!s.busy,
            tweens: 0,
            selected: s.selected ? `${s.selected.col},${s.selected.row}` : null,
            down: s.downCell ? `${s.downCell.col},${s.downCell.row}` : null,
            tweensRunning: s.tweens.getTweens().length,
            // Scene-level ack signals: a refusal MAY answer with a transient
            // effect that never touches the tapped piece (a ring pulse at the
            // finger, a throttled ack timestamp). Capture both so the reader
            // can see any of the three reaction shapes.
            sceneTweens: s.tweens.getTweens().length,
            busyAckAt: typeof s.lastBusyAckAt === 'number' ? s.lastBusyAckAt : null,
          };
          return { cell, busy: !!s.busy, kind: piece.kind, tapPoint: { x, y } };
        }
      }
      return null;
    },

    busyProbeRead: () => {
      const s = window.__GAME__.scene.getScene('Game');
      const p = window.__CERT__.busyProbe;
      if (!p) return null;
      const targeting = s.tweens
        .getTweens()
        .filter((t) => Array.isArray(t.targets) && t.targets.includes(p.root)).length;
      return {
        cell: p.cell,
        armedBusy: p.busy,
        stillBusy: !!s.busy,
        tweensBefore: p.tweens,
        tweensAfter: targeting,
        selectedBefore: p.selected,
        selectedAfter: s.selected ? `${s.selected.col},${s.selected.row}` : null,
        downBefore: p.down,
        downAfter: s.downCell ? `${s.downCell.col},${s.downCell.row}` : null,
        sceneTweensBefore: p.sceneTweens,
        sceneTweensAfter: s.tweens.getTweens().length,
        busyAckBefore: p.busyAckAt,
        busyAckAfter: typeof s.lastBusyAckAt === 'number' ? s.lastBusyAckAt : null,
      };
    },

    /** Shop rows, in design space, with affordability straight off the scene. */
    shop: () => {
      const s = window.__GAME__.scene.getScene('Meta');
      if (!s || !s.scene.isActive()) return null;
      const rows = (s.rows ?? []).map((r, i) => ({
        id: r.def.id,
        name: r.def.name,
        kind: r.def.kind,
        priceLabel: r.buyButton.label ? r.buyButton.label.text : '',
        alpha: Math.round(r.buyButton.alpha * 100) / 100,
        level: r.levelText ? r.levelText.text : '',
        y: Math.round(s.viewportTop - s.scrollY + i * 198 + 88),
      }));
      return {
        currency: Number(s.currencyText ? s.currencyText.text : 0),
        scrollY: Math.round(s.scrollY),
        maxScroll: Math.round(s.maxScroll),
        viewportTop: s.viewportTop,
        rows,
      };
    },

    /** Booster stock — the pre-level picker only opens when something is owned. */
    boosters: (slug) => {
      const raw = localStorage.getItem(`${slug}:meta`);
      if (raw === null) return { currency: 0, boosters: {} };
      const meta = JSON.parse(raw);
      return { currency: meta.currency ?? 0, boosters: meta.boosters ?? {} };
    },
  },

  // --- node-side orchestration ---------------------------------------------

  /**
   * Menu -> saga map -> (picker) -> a dealt board, through the real UI. Returns
   * the tap count it took, which is what the tap-depth budget is measured on.
   *
   * `attempt` guards the one recovery it allows itself: if PLAY skips the map
   * entirely (a defect this driver reports, see `flow:map-bypassed`), the level
   * the cert actually needs is unreachable through the UI, so it reloads once to
   * get a clean slate and tries again. The finding is already filed by then.
   */
  async enterLevel(ctx, { levelIndex = 0, tourPicker = false, attempt = 0 } = {}) {
    let taps = 0;
    await ctx.navigate('PLAY', 'Game', { label: 'menu->game' });
    taps += 1;

    const opened = await ctx.settleUntil(async () => {
      const st = await ctx.state();
      return st.sagaMap || st.started || st.picker;
    }, { label: 'saga map (or whatever PLAY opened)' });

    if (!opened.sagaMap) {
      ctx.blocker(
        'flow:map-bypassed',
        'PLAY on the menu dropped straight into a level instead of opening the level map',
        {
          landedOnLevelIndex: opened.levelIndex,
          wantedLevelIndex: levelIndex,
          sceneData: opened.sceneData,
          note:
            'MenuScene starts the game scene with no data, so Phaser keeps the data from the previous start ' +
            '(PLAY NEXT sends {levelIndex}, RETRY and pause RESTART send {seed}). GameScene.init reads the stale ' +
            'payload and skips openSagaMap, so once the player has been in a level the map is unreachable for the ' +
            'rest of the session.',
        },
      );
      if (opened.levelIndex === levelIndex && opened.started) return taps;
      if (attempt > 0) throw new Error('level map unreachable after a reload');
      await ctx.reload('map-bypass recovery');
      return this.enterLevel(ctx, { levelIndex, tourPicker, attempt: attempt + 1 });
    }

    await ctx.shot('saga-map');
    await this.tapLevelNode(ctx, levelIndex);
    taps += 1;

    // The picker is skipped outright when the player owns no pre-level booster,
    // so "no picker" is a legitimate state, not a failure.
    const picked = await ctx.settleUntil(async () => {
      const st = await ctx.state();
      return st.picker || st.started;
    }, { label: 'picker or board' });
    if (picked.picker) {
      // The picker's own coach beat has to be walked BEFORE the tour, or the
      // tour's first tap is eaten by the card and the beat goes unrecorded.
      await ctx.pumpCoaches();
      await ctx.shot('picker');
      if (tourPicker) await this.tourPicker(ctx, levelIndex);
      await ctx.tapLabel('START', { label: 'picker START' });
      taps += 1;
    }
    await ctx.waitFor(async () => (await ctx.state()).started, { label: 'board dealt' });
    return taps;
  },

  /** Drag-scrolls the saga map until the wanted node is in the band, then taps it. */
  async tapLevelNode(ctx, levelIndex) {
    const label = String(levelIndex + 1);
    const inBand = (b) => b.label === label && b.type === 'Container' && b.y > 180 && b.y < 970;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const { match, btns } = await ctx.stableControl((list) => list.find(inBand), { tries: 4 });
      if (match) {
        await ctx.tap(match.x, match.y, { label: `saga node ${label}` });
        return;
      }
      // Scroll toward the frontier: nodes run top (level 1) to bottom.
      const present = btns.filter((b) => /^\d+$/.test(b.label)).map((b) => Number(b.label));
      const down = present.length === 0 || Math.max(...present) < levelIndex + 1;
      const from = down ? 820 : 300;
      const to = down ? 300 : 820;
      await ctx.drag(360, from, 360, to);
      await ctx.sleep(220);
    }
    ctx.blocker('saga:node-unreachable', `saga map never showed level node ${label}`, {
      buttons: (await ctx.buttons()).map((b) => b.label),
    });
    throw new Error(`saga node ${label} unreachable`);
  },

  /** select -> tooltip -> X, the three states the picker owes the player. */
  async tourPicker(ctx, levelIndex) {
    const isChip = (b) => b.type === 'Container' && b.label !== 'START' && b.label !== 'X' && b.y > 300;
    const { match: chip, btns } = await ctx.stableControl((list) => list.find(isChip));
    if (!chip) {
      ctx.major('picker:no-chip', 'booster picker showed no ownable chip to select', { buttons: btns.map((b) => b.label) });
      return;
    }
    await ctx.tap(chip.x, chip.y, { label: 'picker chip select', measureAck: true });
    await ctx.sleep(320);
    const tip = await ctx.evalPage(() => {
      const s = window.__GAME__.scene.getScene('Game');
      const texts = [];
      const walk = (l) => {
        for (const o of l) {
          if (typeof o.text === 'string' && o.text.length) texts.push(o.text);
          if (o.list) walk(o.list);
        }
      };
      walk(s.children.list);
      return texts;
    });
    await ctx.shot('picker-tooltip');
    ctx.note('picker-tooltip-texts', tip.slice(0, 24));

    // X closes the picker back to the map — the exitable-screen rule.
    if (!(await ctx.buttons()).some((b) => b.label === 'X')) {
      ctx.blocker('picker:no-close', 'booster picker has no X — the screen is a dead end');
      return;
    }
    await ctx.tapLabel('X', { label: 'picker X' });
    await ctx.waitFor(async () => (await ctx.state()).sagaMap, { label: 'picker X returns to map' });
    await ctx.shot('picker-closed-to-map');
    await this.tapLevelNode(ctx, levelIndex);
    await ctx.waitFor(async () => (await ctx.state()).picker, { label: 'picker reopened' });
  },

  /** The FTUE swap gate: tap the two cells the scene will accept, in order. */
  async completeGate(ctx, gated) {
    for (const cell of [gated.a, gated.b]) {
      const p = await ctx.evalPage(this.page.cellCenter, cell);
      await ctx.tap(p.x, p.y, { label: `gated swap ${cell.col},${cell.row}`, measureAck: cell === gated.a });
      await ctx.sleep(160);
    }
  },

  /**
   * Drives one level to its outcome. `anti` plays against the order so the
   * move budget runs out — the loss half of the cert.
   */
  async playLevel(ctx, { anti = false, label = 'level', maxMoves = 80 } = {}) {
    let moves = 0;
    let reshuffles = 0;
    ctx.mark(`${label}:start`);
    for (let guard = 0; guard < maxMoves * 4; guard += 1) {
      await ctx.pumpCoaches();
      const st = await ctx.settle({ label: `${label} settle` });
      if (st.ended || st.directorEnded || !st.active.includes('Game')) break;
      if (!st.started) break;
      await ctx.sweep();

      const move = await ctx.evalPage(this.page.pick, anti);
      if (move === null) {
        // A dead board is the game's problem to solve (reshuffle); give it time.
        reshuffles += 1;
        if (reshuffles > 6) {
          ctx.blocker('board:no-move', `${label}: no legal move and no reshuffle after 6 waits`, { state: st });
          break;
        }
        await ctx.sleep(900);
        continue;
      }
      if (moves === 0 && !anti) ctx.mark(`${label}:first-move`);
      // The family's heaviest beats: a special/special combo, a colour bomb, or
      // any clear big enough to cascade. fps is scored over these windows.
      if (move.why.startsWith('combo') || move.why === 'philter-swap' || move.score >= 200) {
        ctx.mark('combo-cascade');
      }

      const from = await ctx.evalPage(this.page.cellCenter, move.a);
      const to = await ctx.evalPage(this.page.cellCenter, move.b);
      const first = moves === 0;
      await ctx.tap(from.x, from.y, { label: `${label} select ${move.a.col},${move.a.row}`, measureAck: first });
      await ctx.sleep(70);
      await ctx.tap(to.x, to.y, { label: `${label} swap -> ${move.b.col},${move.b.row}` });
      moves += 1;

      // Swallowed input is measured ONCE, on a real cascade rather than a
      // forced flag: tap a cell while the board is mid-resolve and see whether
      // the game reacts at all.
      if (!ctx.report.measurements.swallowedInput.probed && moves >= 2) {
        await this.probeSwallowedInput(ctx);
      }
      await ctx.sleep(120);
    }
    ctx.mark(`${label}:end`);
    const st = await ctx.state();
    return { moves, reshuffles, state: st };
  },

  async probeSwallowedInput(ctx) {
    const m = ctx.report.measurements.swallowedInput;
    const st = await ctx.state();
    if (!st.busy || !st.geom) return;
    const armed = await ctx.evalPage(this.page.busyProbeArm);
    if (armed === null || !armed.busy) return;
    const p = await ctx.evalPage(this.page.cellCenter, armed.cell);
    m.probed = true;
    m.cell = armed.cell;
    await ctx.tap(p.x, p.y, { label: 'busy-board-tap' });
    await ctx.sleep(BUDGETS.ackMs + 30);
    const res = await ctx.evalPage(this.page.busyProbeRead);
    m.detail = res;
    // A reaction is ANY of: a tween landing on the tapped piece, a selection
    // or press-state change, a transient scene-level effect (ring pulse at
    // the finger adds a tween somewhere), or the game's own throttled ack
    // timestamp advancing. The piece-local signals alone missed a perfectly
    // audible/visible refusal that never touched the piece.
    const reacted =
      res.tweensAfter > res.tweensBefore ||
      res.selectedAfter !== res.selectedBefore ||
      res.downAfter !== res.downBefore ||
      res.sceneTweensAfter > res.sceneTweensBefore ||
      (res.busyAckBefore !== null && res.busyAckAfter !== res.busyAckBefore);
    m.reacted = reacted;
    m.verdict = reacted ? 'pass' : 'fail';
    if (!reacted) {
      ctx.blocker(
        'budget:swallowed-input',
        `a board tap at ${armed.cell.col},${armed.cell.row} during a cascade produced no feedback within ${BUDGETS.ackMs}ms: no piece/selection/press change, no scene-level effect, no ack timestamp`,
        res,
      );
    }
  },
};

// --- arena family adapter ---------------------------------------------------

/**
 * Survivor/extraction arenas (`src/slices/arena/`, family A). Written against
 * Duskhaul, whose loop is the family's hardest shape to certify: a real-time
 * horde with an 8-slot bag, three scheduled extraction gates, a hold-to-extract
 * channel and a 480s Collapse. A run ends ONLY by extraction or by death.
 *
 * WHAT THE DRIVING POLICY IS
 * The arena sim's skilled bot policy is "head for the gate you decided on,
 * otherwise kite the crowd" (`src/sim/families/arena.ts`). `steerTo` mirrors
 * the first half through the game's own documented keyboard axis (§3 WASD /
 * arrows, `core/controls.ts`) — real input, never a teleport.
 *
 * WHAT IS FAST-FORWARDED, AND WHY THAT IS HONEST
 * Gate A opens at 120s, Gate B at 240s, Gate C plus the Warden at 420s and the
 * Collapse at 480s. A cert that waited for those organically would be an
 * eight-minute lethality test whose outcome is a balance question — and balance
 * is the SIM's job, which already gates it with 25/27 arena gates. So the
 * clocks are driven and the player's hp is sustained:
 *
 *   - `page.fastForward` moves the director's and the extraction system's own
 *     elapsed clocks and then RESYNCS the director's pending spawn slots. The
 *     resync is not cosmetic: `RunDirector.tickPendingSpawns` catches a slot up
 *     with `while (nextFireAtMs <= elapsedMs)`, so a clock jump over a live
 *     drip would spawn the whole skipped interval in one frame and wedge the
 *     page. Endless drips are re-based to "now" and finite backlogs are
 *     retired, so the field the late beats are photographed on is THINNER than
 *     a real 480s run, never denser.
 *   - `page.sustain` tops the player's hp up from the game loop's own poststep.
 *
 * Everything those two enable — the gate windows, the channel, the Warden's
 * entrance, the Collapse ignition, the two settlements — is certified as
 * PRESENTATION and STATE TRANSITIONS: does the state machine reach the state,
 * does the view agree with the model when it gets there, does the screen say
 * the right thing, is the frame budget held. Neither lethality nor economy
 * balance is asserted anywhere in this adapter.
 */
const arenaAdapter = {
  name: 'arena',
  gameScene: 'Game',
  /**
   * PRD §13's two named peak beats plus the draft, which is the ceremony the
   * player meets most often. fps is scored over a 3s window from each.
   */
  heavyBeats: ['warden-spawn', 'collapse-ignition', 'draft-open'],
  phases: [
    arenaPhaseFirstRun,
    arenaPhasePause,
    arenaPhaseExtraction,
    arenaPhaseLateGameDeath,
    arenaPhaseSurfaces,
  ],

  page: {
    /**
     * The engine's contract fields plus the arena's own. `busy` is false by
     * construction: a board has a resolve cascade to wait out, an arena does
     * not — every frame reconciles the whole model into the view, so any frame
     * is a legal moment to sweep. The states where the HUD feed is
     * DELIBERATELY not running (draft, pause, coach beat, ended) are reported
     * so `invariants` can skip them rather than read a frozen mirror.
     */
    state: () => {
      const g = window.__GAME__;
      const active = g.scene.scenes.filter((s) => s.scene.isActive()).map((s) => s.scene.key);
      const s = g.scene.getScene('Game');
      const live = active.includes('Game');
      const started = live && !!s.combat && !!s.extraction && !!s.director;
      if (!started) {
        return {
          active,
          live,
          started: false,
          busy: false,
          paused: false,
          ended: false,
          coachActive: false,
          coachId: null,
          gated: null,
          acceptsInput: false,
        };
      }
      const x = s.extraction;
      const p = s.combat.player;
      // A beat is identified by WHICH handle is live, not by a scene field the
      // slice does not keep: `ui/coachBeats.ts` runs goal -> stick as one
      // handle and `coachStickLive` is the handover flag between them.
      let coachId = null;
      if (s.gateCoach) coachId = 'gate';
      else if (s.openingCoach) coachId = s.coachStickLive ? 'stick' : 'goal';
      const collapse = x.collapse;
      return {
        active,
        live,
        started: true,
        busy: false,
        paused: !!s.paused,
        ended: !!s.ended,
        drafting: !!s.drafting,
        pauseOpen: !!s.pauseOverlay,
        coachActive: !!s.coachHold,
        coachId,
        // The stick beat ends on the taught MOVE and on nothing else, which is
        // exactly the engine's "gated beat" shape.
        gated: coachId === 'stick' ? { kind: 'move' } : null,
        runS: Math.round(s.director.elapsedSeconds * 100) / 100,
        extractionS: Math.round(x.elapsedS * 100) / 100,
        phase: s.director.phase ? s.director.phase.name : null,
        level: p.level,
        hp: Math.round(p.health.hp * 10) / 10,
        hpMax: p.health.max,
        kills: s.kills,
        taken: s.taken.length,
        enemies: s.combat.aliveEnemies(),
        bossActive: !!s.bossActive,
        bag: {
          slots: s.bag.slots,
          used: s.bag.relics.length,
          casketSlots: s.bag.casketSlots,
          casket: s.bag.casket.map((r) => r.id),
          shards: s.bag.shards,
        },
        gates: s.zoneGates.map((gt) => x.gateState(gt.id)).join(''),
        channel: {
          gate: x.channelingGate,
          progress: Math.round(x.channelProgress * 1000) / 1000,
          accumMs: Math.round(x.channelMsAccum),
          effectiveMs: x.channelMsEffective,
          rate: x.channelRate,
        },
        collapsing: collapse !== null && collapse.active === true,
        extracted: !!x.extracted,
        pendingDrafts: s.pendingDrafts,
        acceptsInput: !!(live && !s.paused && !s.ended && !s.drafting && !s.coachHold),
      };
    },

    /** Player, gates and the arena bounds — everything `steerTo` needs. */
    field: () => {
      const s = window.__GAME__.scene.getScene('Game');
      if (!s || !s.combat || !s.extraction) return null;
      const p = s.combat.player;
      const x = s.extraction;
      return {
        player: { x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.health.hp) },
        gates: s.zoneGates.map((gt) => ({
          id: gt.id,
          x: Math.round(gt.x),
          y: Math.round(gt.y),
          state: x.gateState(gt.id),
          opensS: gt.opensS,
          closesS: gt.closesS,
          dist: Math.round(Math.hypot(p.x - gt.x, p.y - gt.y)),
        })),
        channelRadius: x.suppressRadius,
        arena: { w: s.arena.width, h: s.arena.height },
        collapse:
          x.collapse === null
            ? null
            : {
                active: x.collapse.active,
                radius: Math.round(x.collapse.ringRadius),
                x: Math.round(x.collapseRingCenter.x),
                y: Math.round(x.collapseRingCenter.y),
              },
        ended: !!s.ended,
      };
    },

    /**
     * LAST RESORT for the walk to a gate, and never silent: the caller files a
     * major with the obstacle field first. Places the hero on the gate's own
     * ring through the arena's clamp so the CHANNEL beats — the thing this
     * phase exists to certify — are still exercised when the driver's pathing
     * loses to a prop pocket. Reachability is a distance question the arena SIM
     * owns and already gates; nothing here asserts it.
     */
    placeAtGate: (arg) => {
      const s = window.__GAME__.scene.getScene('Game');
      const gate = s.zoneGates.find((g) => g.id === arg.id);
      if (gate === undefined) return null;
      const out = { x: 0, y: 0 };
      s.arena.clamp(gate.x, gate.y, 60, out);
      // `setPosition` alone is undone on the next physics step: Arcade writes
      // the GameObject back from the BODY every frame, so the hero snapped
      // straight back to the prop he was stuck on and no channel ever started.
      s.combat.player.body.reset(out.x, out.y);
      return { placedAt: { x: Math.round(out.x), y: Math.round(out.y) }, gate: arg.id };
    },

    /**
     * A heading toward a world point that steers AROUND the arena's props.
     *
     * The sim's skilled policy is geometry-free — it moves a point at a target
     * on an empty plane — but the browser build scatters impassable circular
     * props, and a straight hold walks the hero into one and holds him there.
     * Measured: two of four cert runs pinned on a prop ~330px short of Gate A
     * and burned the whole travel budget shuffling against it. So the blocker
     * nearest along the line gets the heading rotated away from it, which is
     * the smallest honest amount of pathing this needs: it changes WHERE the
     * driver walks, never what the game does.
     */
    heading: (arg) => {
      const s = window.__GAME__.scene.getScene('Game');
      const p = s.combat.player;
      const dx = arg.x - p.x;
      const dy = arg.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      let hx = dx / dist;
      let hy = dy / dist;
      const look = Math.min(320, dist);
      const clearance = 58; // the hero's own half-width plus a margin
      let nearest = null;
      for (const obj of s.arena.obstacles.getChildren()) {
        const b = obj.body;
        if (!b) continue;
        // Border walls are long rectangles the hero never has to round; only
        // the scattered props are treated as blockers.
        if (Math.max(b.width, b.height) > 400) continue;
        const r = (b.isCircle ? b.radius : Math.max(b.halfWidth, b.halfHeight)) + clearance;
        const relx = b.center.x - p.x;
        const rely = b.center.y - p.y;
        const along = relx * hx + rely * hy;
        if (along < -r || along > look) continue;
        const side = -relx * hy + rely * hx;
        if (Math.abs(side) > r) continue;
        if (nearest === null || along < nearest.along) nearest = { along, side };
      }
      const cert = window.__CERT__;
      if (nearest !== null) {
        // Commit to a side for a beat. Re-deciding every tick against a prop
        // PAIR flips the heading left, right, left and the hero oscillates in
        // the pocket between them — measured as a walk that stalled 468px short
        // of an open gate with the whole travel budget spent.
        const now = performance.now();
        if (!cert.avoidSide || now > cert.avoidSide.until) {
          cert.avoidSide = { side: nearest.side > 0 ? -1 : 1, until: now + 1400 };
        }
        const angle = Math.atan2(hy, hx) + cert.avoidSide.side * 1.2;
        hx = Math.cos(angle);
        hy = Math.sin(angle);
      } else {
        cert.avoidSide = null;
      }
      return {
        hx: Math.round(hx * 1000) / 1000,
        hy: Math.round(hy * 1000) / 1000,
        dist: Math.round(dist),
        blocked: nearest !== null,
        player: { x: Math.round(p.x), y: Math.round(p.y) },
        ended: !!s.ended,
      };
    },

    /**
     * View/model coherence sweep. Every entry has a shipped failure mode
     * behind it: a gate arch left on the wrong state art after a close, a bag
     * pip row that stopped repainting, a channel bar housing loitering in the
     * band with nothing channelling, a pooled enemy handed out twice, and the
     * pause affordance promising a tap the scene refuses.
     *
     * Skipped whenever the HUD feed is deliberately halted (draft, pause,
     * coach beat, ended run): the mirror is frozen ON PURPOSE there, and
     * reading it would report the design.
     */
    invariants: () => {
      const s = window.__GAME__.scene.getScene('Game');
      if (!s || !s.scene.isActive() || !s.combat || !s.extraction) {
        return { skipped: true, reason: 'game scene not live', violations: [] };
      }
      if (s.drafting || s.paused || s.coachHold || s.ended) {
        return { skipped: true, reason: 'hud feed intentionally halted', violations: [] };
      }
      const x = s.extraction;
      const out = [];

      // 1. gate visuals mirror the gate state machine.
      for (const gate of s.zoneGates) {
        const model = x.gateState(gate.id);
        const shown = s.gateRingState ? s.gateRingState[gate.id] : null;
        if (shown !== null && shown !== model) {
          out.push(`gate-visual: ${gate.id} model=${model} drawn=${shown}`);
        }
        const sprite = s.gateSprites ? s.gateSprites[gate.id] : null;
        if (sprite && (sprite.scene === null || sprite.scene === undefined)) {
          out.push(`gate-visual: ${gate.id} arch was destroyed but is still referenced`);
        }
      }

      // 2. the compass is fed only live gates, each with its true state.
      const ids = new Set(s.zoneGates.map((g) => g.id));
      for (const fed of s.compassGates) {
        if (!ids.has(fed.id)) out.push(`compass: fed unknown gate ${fed.id}`);
        else if (fed.state !== x.gateState(fed.id)) {
          out.push(`compass: ${fed.id} fed as ${fed.state}, model says ${x.gateState(fed.id)}`);
        }
      }

      // 3. the bag pips painted what the bag holds.
      const pips = s.bagPips;
      if (pips) {
        if (pips.lastUsed !== s.bag.relics.length) {
          out.push(`bag-pips: painted ${pips.lastUsed} used, bag holds ${s.bag.relics.length}`);
        }
        if (pips.lastSlots !== s.bag.slots) {
          out.push(`bag-pips: painted ${pips.lastSlots} slots, bag has ${s.bag.slots}`);
        }
        if (pips.lastShards !== s.bag.shards) {
          out.push(`bag-pips: shard readout ${pips.lastShards}, bag holds ${s.bag.shards}`);
        }
      }

      // 4. the channel bar exists exactly while a channel is bound.
      const bar = s.channelBar;
      if (bar) {
        const wanted = !x.extracted && x.channelingGate !== null;
        if (bar.visible !== wanted) {
          out.push(`channel-bar: visible=${bar.visible} but channellingGate=${x.channelingGate}`);
        }
      }

      // 5. the enemy pool never hands the same body out twice, and never
      //    leaves a despawned one in the live list.
      const seen = new Set();
      for (const enemy of s.combat.enemies) {
        if (seen.has(enemy)) out.push('enemy-pool: one Enemy instance is in the live list twice');
        seen.add(enemy);
        if (enemy.active === false) out.push('enemy-pool: an inactive Enemy is still in the live list');
      }

      // 6. same for ground relics and shard caches.
      const relicSeen = new Set();
      for (const pickup of s.relics) {
        if (relicSeen.has(pickup)) out.push('relic-pool: one RelicPickup is on the field twice');
        relicSeen.add(pickup);
      }
      for (const cache of s.caches) {
        if (!cache.img || cache.img.scene === null || cache.img.scene === undefined) {
          out.push('cache: a destroyed image is still in the cache list');
        }
      }

      // 7. the Collapse curtain only exists during the Collapse.
      const collapsing = x.collapse !== null && x.collapse.active === true;
      if (!collapsing) {
        const lit = s.collapseSegments.filter((seg) => seg.visible).length;
        if (lit > 0) out.push(`collapse: ${lit} curtain segment(s) visible with no Collapse running`);
      }

      // 8. §14b overlay exclusivity — exactly one overlay owns the screen.
      if (s.cards && s.pauseOverlay) out.push('overlay: a draft and the pause overlay are both up');
      if (s.pauseOverlay && s.coachHold) out.push('overlay: the pause overlay is up over a coach beat');

      // 9. the pause affordance is as tappable as pausing is legal.
      const legal = !s.drafting && !s.coachHold && !s.ended;
      if (s.pauseAffordanceLive !== legal) {
        out.push(`pause-affordance: mirror=${s.pauseAffordanceLive} legal=${legal}`);
      }
      const btn = s.pauseButton;
      if (btn) {
        const interactive = !!(btn.input && btn.input.enabled !== false);
        if (interactive !== legal) {
          out.push(`pause-affordance: interactive=${interactive} but pausing is ${legal ? '' : 'not '}legal`);
        }
        if (legal && btn.alpha < 0.99) out.push(`pause-affordance: legal but drawn at alpha ${btn.alpha}`);
        if (!legal && btn.alpha > 0.5) out.push(`pause-affordance: refused but drawn at alpha ${btn.alpha}`);
      }

      // 10. tween leak guard — an arena runs thousands of one-shots a run and
      //     an unremoved infinite loop is how a scene dies quietly.
      const tweens = s.tweens.getTweens().length;
      if (tweens > 400) out.push(`tween-leak: ${tweens} live tweens on the game scene`);

      return { skipped: false, settled: true, violations: out.slice(0, 12), count: out.length, tweens };
    },

    /**
     * Drives the run clock forward WITHOUT replaying the skipped minutes as one
     * spawn burst. See the adapter header for why this is a legitimate cert
     * move and what it does and does not claim.
     */
    fastForward: (arg) => {
      const s = window.__GAME__.scene.getScene('Game');
      const d = s.director;
      const x = s.extraction;
      const toMs = arg.toS * 1000;
      if (toMs <= d.elapsedMs) return { skipped: true, atS: d.elapsedSeconds };
      const fromMs = d.elapsedMs;

      // Scripted one-shots inside the skipped window are consumed, not fired:
      // three chest drafts arriving in one frame is a harness artefact, not a
      // beat the game would ever produce.
      let events = 0;
      while (d.nextEventIndex < d.events.length && d.events[d.nextEventIndex].at <= arg.toS) {
        d.nextEventIndex += 1;
        events += 1;
      }

      d.elapsedMs = toMs;

      // Register the waves whose start time we skipped so their endless drips
      // exist, then retire every finite backlog and re-base every drip to now.
      while (d.nextWaveIndex < d.waves.length && d.waves[d.nextWaveIndex].at <= arg.toS) {
        const wave = d.waves[d.nextWaveIndex];
        for (let i = 0; i < wave.spawns.length; i += 1) {
          d.pending.push({ wave, spawnIndex: i, spawned: 0, nextFireAtMs: toMs });
        }
        d.nextWaveIndex += 1;
      }
      let drips = 0;
      let retired = 0;
      for (let i = d.pending.length - 1; i >= 0; i -= 1) {
        const entry = d.pending[i];
        const spec = entry.wave.spawns[entry.spawnIndex];
        const endless = entry.wave.until !== undefined && (spec.everyMs ?? 0) > 0;
        if (endless && entry.wave.until > arg.toS) {
          entry.nextFireAtMs = toMs;
          drips += 1;
        } else {
          d.pending.splice(i, 1);
          retired += 1;
        }
      }

      x.elapsedMs = toMs;
      // The damage clock is sim time; leaving it behind would freeze i-frames
      // and expiry windows relative to a clock that just moved ten minutes.
      s.simTimeMs += toMs - fromMs;
      return {
        atS: d.elapsedSeconds,
        jumpedS: Math.round((toMs - fromMs) / 100) / 10,
        eventsSkipped: events,
        dripsRebased: drips,
        backlogRetired: retired,
      };
    },

    /**
     * Keeps the player alive from the game loop's own poststep so the late
     * beats can be photographed. Never touches max hp, damage or i-frames — it
     * refills, it does not armour.
     */
    sustain: (arg) => {
      const g = window.__GAME__;
      const c = window.__CERT__;
      if (c.hpHook) {
        g.events.off('poststep', c.hpHook);
        c.hpHook = null;
      }
      if (!arg.on) return { on: false };
      c.hpHook = () => {
        const s = g.scene.getScene('Game');
        if (!s || !s.scene.isActive() || !s.combat || s.ended) return;
        const h = s.combat.player.health;
        if (h.hp < h.max) h.hp = h.max;
      };
      g.events.on('poststep', c.hpHook);
      return { on: true };
    },

    /** The draft overlay's real geometry and contents, off the scene tree. */
    draft: () => {
      const s = window.__GAME__.scene.getScene('Game');
      if (!s || !s.cards) return null;
      const root = s.children.list.find((o) => o.depth === 2000 && Array.isArray(o.list));
      if (!root) return { cards: [], reroll: null, drafting: !!s.drafting, missingRoot: true };
      const textsOf = (o) => {
        const acc = [];
        const walk = (list) => {
          for (const child of list) {
            if (typeof child.text === 'string' && child.text.length > 0) acc.push(child.text);
            if (child.list) walk(child.list);
          }
        };
        walk(o.list ?? []);
        return acc;
      };
      const cards = [];
      let reroll = null;
      for (const child of root.list) {
        if (!Array.isArray(child.list)) continue;
        const label = child.getData ? child.getData('label') : undefined;
        if (label !== undefined && label !== null) {
          reroll = {
            x: Math.round(child.x),
            y: Math.round(child.y),
            text: label.text,
            alpha: Math.round(child.alpha * 100) / 100,
          };
          continue;
        }
        if (!child.input) continue;
        cards.push({
          x: Math.round(child.x),
          y: Math.round(child.y),
          w: Math.round(child.width ?? 0),
          h: Math.round(child.height ?? 0),
          texts: textsOf(child),
        });
      }
      return {
        cards,
        reroll,
        drafting: !!s.drafting,
        rerollsUsed: s.rerollsUsedThisDraft,
        rerollsAllowed: s.loadout ? s.loadout.rerollsPerDraft : null,
        taken: s.taken.slice(),
        pending: s.pendingDrafts,
      };
    },

    /**
     * Arms the channel-setback probe INSIDE the page, because the assertion is
     * a per-frame one: a hit costs `extract.hitSetbackMs` off the accrual and
     * stalls it, and must NEVER reset it to zero (PRD §7's completability law).
     * The hit is injected at the same seam `onPlayerHit` writes — the scene's
     * one-frame `tookHitSinceTick` flag — so the system under test sees exactly
     * what a real contact produces.
     */
    armChannelHit: (arg) => {
      const g = window.__GAME__;
      const c = window.__CERT__;
      const s = g.scene.getScene('Game');
      if (c.channelHook) g.events.off('poststep', c.channelHook);
      c.channelProbe = { armed: true, at: arg.atProgress, before: null, after: null, fired: false, peak: 0 };
      c.channelHook = () => {
        const p = c.channelProbe;
        const x = s.extraction;
        if (!x || s.ended) return;
        p.peak = Math.max(p.peak, x.channelProgress);
        if (p.fired) {
          if (p.after === null) {
            p.after = {
              accumMs: x.channelMsAccum,
              progress: x.channelProgress,
              stallMs: x.channelStallMs,
              interrupted: x.channelInterrupted,
            };
            g.events.off('poststep', c.channelHook);
            c.channelHook = null;
          }
          return;
        }
        if (x.channelingGate === null || x.channelProgress < p.at) return;
        p.before = { accumMs: x.channelMsAccum, progress: x.channelProgress };
        // One frame of contact, delivered through the scene's own hit seam.
        s.tookHitSinceTick = true;
        p.fired = true;
      };
      g.events.on('poststep', c.channelHook);
      return { armed: true, atProgress: arg.atProgress };
    },

    readChannelHit: () => {
      const c = window.__CERT__;
      return c.channelProbe ?? null;
    },

    /**
     * Arms the "input during a ceremony" probe. The arena's ceremony is the
     * level-up draft, and the control a player will aim at during one is the
     * pause icon. `syncPauseAffordance` is supposed to have dimmed and deafened
     * it BEFORE the tap — a legible refusal rather than a silent drop.
     */
    pauseProbeArm: () => {
      const s = window.__GAME__.scene.getScene('Game');
      if (!s.drafting) return null;
      const b = s.pauseButton;
      return {
        drafting: true,
        alpha: Math.round(b.alpha * 100) / 100,
        interactive: !!(b.input && b.input.enabled !== false),
        affordanceLive: !!s.pauseAffordanceLive,
        pauseOpen: !!s.pauseOverlay,
        cardTexts: s.cards ? 1 : 0,
      };
    },

    pauseProbeRead: () => {
      const s = window.__GAME__.scene.getScene('Game');
      const b = s.pauseButton;
      return {
        stillDrafting: !!s.drafting,
        pauseOpen: !!s.pauseOverlay,
        paused: !!s.paused,
        alpha: Math.round(b.alpha * 100) / 100,
        interactive: !!(b.input && b.input.enabled !== false),
      };
    },

    /**
     * Lands `count` relics at the player's feet through the game's own drop
     * path (`dropRelics`, the same call the Shrine and the chest use), so the
     * casket-pin and the death-settlement beats do not depend on the ambient
     * drip's timing. The ROLL is the game's; only the moment is the cert's.
     */
    dropRelicsAtFeet: (arg) => {
      const s = window.__GAME__.scene.getScene('Game');
      const p = s.combat.player;
      s.dropRelics(p.x, p.y, arg.count, 0, arg.minTier ?? 0);
      return { dropped: arg.count, onField: s.relics.length };
    },

    /** The pause overlay's bag row, as the player sees it. */
    bagRow: () => {
      const s = window.__GAME__.scene.getScene('Game');
      if (!s.pauseOverlay) return null;
      const row = s.readBagRow().map((r) => ({ id: r.id, name: r.name, tier: r.tier, pinned: r.pinned }));
      // §14.5 geometry, read back from the same rule the overlay draws with.
      const pitch = Math.min(88, 640 / Math.max(1, row.length));
      const left = 360 - (pitch * (row.length - 1)) / 2;
      return {
        casketSlots: s.bag.casketSlots,
        relics: row.map((r, i) => ({ ...r, x: Math.round(left + i * pitch), y: 1004 })),
      };
    },

    /**
     * Ends the run the way the Collapse ends an idler's: one frame of dusk fire,
     * delivered at the scene's OWN hazard seam (`onHazardDrain`, the call
     * `tickCollapse` makes every frame the hero stands outside the ring). That
     * seam drains hp directly, still offers Last Gasp its refusal, and calls
     * `die()` — so the settlement this certifies is the shipped one.
     *
     * Injected rather than walked into: the ring's start radius is derived from
     * the hero's own distance to Gate C and can exceed the arena's remaining
     * width, so "walk out of the ring" is not always geometrically available
     * (measured: two runs in four never got outside it). Lethality is the sim's
     * gate; this cert only needs the LOSS SETTLEMENT to happen.
     */
    duskFireKill: () => {
      const s = window.__GAME__.scene.getScene('Game');
      const before = Math.round(s.combat.player.health.hp);
      s.onHazardDrain(before + 1);
      return { hpBefore: before, ended: !!s.ended, collapsing: s.extraction.collapse?.active === true };
    },

    /** The results payload, verbatim. */
    results: () => {
      const s = window.__GAME__.scene.getScene('GameOver');
      if (!s || !s.scene.isActive()) return null;
      const texts = [];
      const walk = (list) => {
        for (const o of list) {
          if (typeof o.text === 'string' && o.text.length > 0) texts.push(o.text);
          if (o.list) walk(o.list);
        }
      };
      walk(s.children.list);
      return { result: { ...s.result }, texts: texts.slice(0, 20) };
    },

    /** The meta save, straight out of storage — the bank the haul lands in. */
    meta: (slug) => {
      const raw = localStorage.getItem(`${slug}:meta`);
      if (raw === null) return null;
      const meta = JSON.parse(raw);
      return {
        currency: meta.currency ?? 0,
        stash: meta.stash ?? [],
        gear: meta.gear ?? null,
        upgrades: meta.upgrades ?? {},
        stats: meta.stats ?? null,
      };
    },

    /** Stash/gear/upgrade rows in design space, with the list band they live in. */
    stash: () => {
      const s = window.__GAME__.scene.getScene('Meta');
      if (!s || !s.scene.isActive() || !s.content) return null;
      const absolute = (o) => {
        let x = o.x;
        let y = o.y;
        let p = o.parentContainer;
        while (p) {
          x += p.x;
          y += p.y;
          p = p.parentContainer;
        }
        return { x: Math.round(x), y: Math.round(y) };
      };
      const gear = [];
      for (const child of s.content.list) {
        if (!Array.isArray(child.list)) continue;
        const label = child.list.find((o) => typeof o.text === 'string' && /^(BLADE|SHROUD|TRINKET)$/.test(o.text));
        if (!label) continue;
        const texts = child.list.filter((o) => typeof o.text === 'string' && o.text.length > 0).map((o) => o.text);
        // §14b gives an empty cell two DIFFERENT copies, and the difference is
        // the whole answer to "should a tap here do anything": nothing banked
        // that fits this slot, or one tap away from equipping.
        const offersEquip = texts.some((t) => t.includes('TAP TO'));
        const nothingFits = texts.some((t) => t.includes('NO RELIC'));
        gear.push({ slot: label.text, texts, offersEquip, nothingFits, equipped: !offersEquip && !nothingFits, ...absolute(child) });
      }
      const rows = s.upgradeRows.map((r) => ({
        id: r.def.id,
        name: r.def.name,
        price: r.buyButton.label ? r.buyButton.label.text : '',
        alpha: Math.round(r.buyButton.alpha * 100) / 100,
        level: r.levelText ? r.levelText.text : '',
        ...absolute(r.buyButton),
      }));
      return {
        currency: Number(s.shardText ? s.shardText.text : 0),
        scrollY: Math.round(s.scrollY),
        maxScroll: Math.round(s.maxScroll),
        band: { top: s.viewportTop, bottom: s.viewportTop + s.viewportHeight },
        gear,
        rows,
      };
    },
  },

  // --- node-side orchestration ---------------------------------------------

  /**
   * The stick beat's gate is the taught MOVE (`swap-gate` mode dismisses on
   * nothing else), and §3 makes the keyboard axis a first-class input, so this
   * presses a real key rather than faking a joystick vector.
   */
  async completeGate(ctx, gated) {
    if (!gated || gated.kind !== 'move') return;
    await ctx.page.keyboard.down('KeyD');
    await ctx.sleep(420);
    await ctx.page.keyboard.up('KeyD');
  },

  /** Releases anything `steerTo` might still be holding. Safe to over-call. */
  async releaseKeys(ctx) {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      await ctx.page.keyboard.up(code).catch(() => {});
    }
  },

  /**
   * Walks the player to a world point with the documented movement keys — the
   * sim's "head for the gate" policy, driven through real input.
   *
   * `stuck` recovery is not decoration: the arena has walls and props, and a
   * straight-line hold can pin the hero on a corner forever. Two seconds of no
   * progress buys a 500ms strafe, which is what a player does.
   */
  async steerTo(ctx, pick, { withinPx = 80, timeoutMs = 40000, label = 'steer' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let held = new Set();
    let best = Infinity;
    let stuckSince = Date.now();
    /** While `now < recoverUntil`, `recoverKey` is held instead of the line. */
    let recoverUntil = 0;
    let recoverKey = null;
    const hold = async (want) => {
      for (const code of held) if (!want.has(code)) await ctx.page.keyboard.up(code);
      for (const code of want) if (!held.has(code)) await ctx.page.keyboard.down(code);
      held = want;
    };
    const opening = await ctx.evalPage(this.page.field);
    if (opening === null) return { arrived: false, reason: 'no field' };
    const target = pick(opening);
    if (target === null || target === undefined) return { arrived: false, reason: 'no target' };
    let blocked = 0;
    try {
      for (;;) {
        const head = await ctx.evalPage(this.page.heading, { x: target.x, y: target.y });
        if (head === null || head.ended) return { arrived: false, reason: 'run ended' };
        if (head.dist <= withinPx) {
          await hold(new Set());
          return { arrived: true, dist: head.dist, player: head.player, avoided: blocked };
        }
        if (head.blocked) blocked += 1;
        const now = Date.now();
        if (head.dist < best - 20) {
          best = head.dist;
          stuckSince = now;
        }
        const want = new Set();
        if (now < recoverUntil) {
          // Mid-strafe: hold the recovery key for the whole burst. Re-deciding
          // every tick is what turns a recovery into a permanent shimmy — the
          // first draft of this loop re-armed itself every 500ms and walked the
          // hero sideways for the full 40s budget without ever resuming the line.
          want.add(recoverKey);
        } else if (now - stuckSince > 2500) {
          // Wedged despite the avoidance heading (a prop pocket, two props in a
          // row): back out sideways for one bounded burst, alternating the side
          // so a symmetric trap cannot hold the hero forever.
          const across = Math.abs(head.hx) > Math.abs(head.hy);
          const options = across ? ['KeyW', 'KeyS'] : ['KeyA', 'KeyD'];
          recoverKey = options[blocked % 2];
          recoverUntil = now + 900;
          stuckSince = now + 900;
          want.add(recoverKey);
        } else {
          if (head.hx > 0.35) want.add('KeyD');
          else if (head.hx < -0.35) want.add('KeyA');
          if (head.hy > 0.35) want.add('KeyS');
          else if (head.hy < -0.35) want.add('KeyW');
        }
        await hold(want);
        if (now > deadline) {
          await hold(new Set());
          const field = await ctx.evalPage(this.page.field);
          ctx.major('arena:unreachable', `${label}: never came within ${withinPx}px in ${timeoutMs}ms`, {
            closest: Math.round(best),
            avoidedProps: blocked,
            target,
            field,
          });
          return { arrived: false, reason: 'timeout', closest: Math.round(best) };
        }
        await ctx.sleep(140);
      }
    } finally {
      await this.releaseKeys(ctx);
    }
  },

  /**
   * Kites in a slow orbit while waiting for something the run has to produce on
   * its own (the first level-up). Movement is what keeps the hero alive, so
   * "wait" in an arena has to be an ACTION.
   */
  async kiteUntil(ctx, done, { timeoutMs = 90000, label = 'kite' } = {}) {
    const ring = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
    const deadline = Date.now() + timeoutMs;
    let i = 0;
    try {
      for (;;) {
        const st = await ctx.state();
        if (await done(st)) return st;
        if (!st.live || st.ended) return st;
        if (st.acceptsInput) {
          const code = ring[i % ring.length];
          i += 1;
          await ctx.page.keyboard.down(code);
          await ctx.sleep(520);
          await ctx.page.keyboard.up(code);
        } else {
          await ctx.sleep(160);
        }
        if (Date.now() > deadline) {
          ctx.blocker('arena:loop-stalled', `${label}: the run never produced the awaited state in ${timeoutMs}ms`, { state: st });
          return st;
        }
      }
    } finally {
      await this.releaseKeys(ctx);
    }
  },

  /** Turns the hp sustain on or off, re-arming it after a reload if needed. */
  async sustain(ctx, on) {
    const r = await ctx.evalPage(this.page.sustain, { on });
    ctx.note(`sustain:${on ? 'on' : 'off'}`, r);
    return r;
  },

  /**
   * The level-up draft: pick-1-of-3 with one reroll. Certifies that the reroll
   * really redraws (and then refuses a second use), that a pick applies and
   * hands the field back, and that the pause icon refuses legibly while the
   * cards are up.
   */
  /**
   * The draft's geometry, SETTLED.
   *
   * Cards and the reroll chip enter through `enterPinningHitArea`: the hit rect
   * is live at the FINAL position from frame one while the drawn position is
   * still sliding in. A coordinate read mid-entrance and then tapped therefore
   * lands somewhere else entirely — measured, it put a "reroll" tap 60px low,
   * onto the first card, which picked it and closed the draft. Two identical
   * samples mean the entrance is done and drawn == tappable.
   */
  async settledDraft(ctx, { tries = 16, settleMs = 120 } = {}) {
    let lastKey = null;
    let last = null;
    for (let i = 0; i < tries; i += 1) {
      const now = await ctx.evalPage(this.page.draft);
      if (now === null) return null;
      const key = JSON.stringify([
        now.cards.map((c) => [c.x, c.y]),
        now.reroll === null ? null : [now.reroll.x, now.reroll.y, now.reroll.alpha],
      ]);
      if (lastKey === key) return now;
      lastKey = key;
      last = now;
      await ctx.sleep(settleMs);
    }
    ctx.major('draft:never-settles', 'the draft overlay was still moving after its entrance budget', last);
    return last;
  },

  /**
   * Picks through any draft that is currently open, without touring it.
   *
   * A draft PAUSES the director, the combat and the extraction clock, so a
   * level-up that lands while the driver is waiting on a run-state change
   * stalls that change forever. Measured: the hero stood dead centre in an open
   * Gate A with the cards up and the channel never started, three cert runs in
   * ten. Every later wait therefore pumps drafts the way the engine pumps
   * coach beats.
   */
  async clearDraft(ctx, { max = 5 } = {}) {
    for (let i = 0; i < max; i += 1) {
      const st = await ctx.state();
      if (!st.live || !st.drafting) return st;
      const draft = await this.settledDraft(ctx);
      if (draft === null || draft.cards.length === 0) return st;
      await ctx.tap(draft.cards[0].x, draft.cards[0].y, { label: 'draft pick (clearing)' });
      await ctx.sleep(340);
    }
    ctx.major('draft:will-not-clear', `${max} picks did not close the draft stack`, await ctx.state());
    return ctx.state();
  },

  /**
   * Waits for a run-state predicate while KEEPING THE RUN RUNNING — the arena's
   * answer to the engine's `settleUntil`, which only knows how to wait.
   */
  async waitRunning(ctx, pred, { label = 'run state', timeout = 45000 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const st = await ctx.state();
      if (await pred(st)) return st;
      if (!st.live) return st;
      if (st.drafting) await this.clearDraft(ctx);
      else if (st.coachActive) await ctx.pumpCoaches();
      else await ctx.sleep(200);
      if (Date.now() > deadline) {
        ctx.blocker('harness:timeout', `timed out waiting for ${label} (${timeout}ms)`, { state: st });
        throw new Error(`timeout waiting for ${label}`);
      }
    }
  },

  async tourDraft(ctx) {
    const before = await this.settledDraft(ctx);
    if (before === null) {
      ctx.blocker('draft:absent', 'the scene reported drafting but no card overlay was on screen');
      return;
    }
    ctx.mark('draft-open');
    await ctx.shot('draft');
    if (before.cards.length !== 3) {
      ctx.blocker('draft:card-count', `the draft offered ${before.cards.length} card(s), not 3`, before);
      return;
    }
    ctx.note('draftCards', before.cards.map((c) => c.texts.join(' / ')));

    // Input during the ceremony, measured once.
    if (!ctx.report.measurements.swallowedInput.probed) await this.probeSwallowedInput(ctx);

    // The reroll: one per draft, and it must actually redraw.
    // Re-settle: the probe above spent time on the overlay, and the chip is the
    // last thing to arrive.
    const armed = await this.settledDraft(ctx);
    if (armed === null || armed.reroll === null) {
      ctx.blocker('draft:no-reroll', 'the draft offered no reroll chip', armed ?? before);
    } else {
      await ctx.tap(armed.reroll.x, armed.reroll.y, { label: 'draft reroll', measureAck: true });
      await ctx.sleep(420);
      const after = await this.settledDraft(ctx);
      if (after === null) {
        ctx.blocker('draft:reroll-closed-the-draft', 'the reroll chip resolved the draft instead of redrawing it', armed);
        return;
      }
      await ctx.shot('draft-rerolled');
      const same = JSON.stringify(before.cards.map((c) => c.texts)) === JSON.stringify(after.cards.map((c) => c.texts));
      if (same) {
        ctx.blocker('draft:reroll-noop', 'the reroll redrew the same three cards', {
          before: before.cards.map((c) => c.texts.join(' / ')),
          after: after.cards.map((c) => c.texts.join(' / ')),
        });
      } else {
        ctx.note('draftReroll', {
          used: after.rerollsUsed,
          allowed: after.rerollsAllowed,
          chip: after.reroll ? after.reroll.text : null,
          after: after.cards.map((c) => c.texts.join(' / ')),
        });
      }
      if (after.reroll !== null && after.rerollsUsed >= after.rerollsAllowed && after.reroll.text !== 'REROLLED') {
        ctx.major('draft:reroll-label', `the spent reroll chip still reads "${after.reroll.text}"`, after.reroll);
      }
    }

    // The pick. Card centres come off the scene tree, never a remembered
    // coordinate: this layout moved twice during the build.
    const now = await this.settledDraft(ctx);
    if (now === null) {
      ctx.blocker('draft:vanished', 'the draft overlay disappeared before a card could be picked');
      return;
    }
    const card = now.cards[0];
    const takenBefore = now.taken.length;
    await ctx.tap(card.x, card.y, { label: 'draft pick card 1', measureAck: true });
    const settled = await ctx.settleUntil(async () => {
      const st = await ctx.state();
      return !st.drafting;
    }, { label: 'draft closes on a pick' });
    if (settled.taken !== takenBefore + 1) {
      ctx.blocker('draft:pick-lost', `picking a card left ${settled.taken} upgrade(s) taken, expected ${takenBefore + 1}`, settled);
    }
    await ctx.waitFor(async () => (await ctx.state()).acceptsInput, { label: 'field resumes after the draft' });
    await ctx.shot('after-draft');
    ctx.note('draftPick', { taken: settled.taken, level: settled.level, card: card.texts.join(' / ') });
  },

  /**
   * "Input during animation" for an arena. The ceremony is the draft; the
   * control a player aims at during one is the pause icon; and the contract
   * (`syncPauseAffordance`) is that the refusal is READABLE BEFORE THE TAP —
   * dimmed to 0.28 and with its hit area dropped — rather than a lit button
   * that silently eats the press.
   */
  async probeSwallowedInput(ctx) {
    const m = ctx.report.measurements.swallowedInput;
    const armed = await ctx.evalPage(this.page.pauseProbeArm);
    if (armed === null) return;
    m.probed = true;
    m.surface = 'pause icon during the level-up draft';
    await ctx.tap(636, 44, { label: 'pause tap during draft' });
    await ctx.sleep(BUDGETS.ackMs + 60);
    const after = await ctx.evalPage(this.page.pauseProbeRead);
    m.detail = { armed, after };
    // A legible refusal: the affordance was already dim and deaf, the draft
    // still owns the screen, and no second overlay stacked.
    const legible = armed.alpha <= 0.5 && !armed.interactive && !armed.affordanceLive;
    const heldTheLine = after.stillDrafting && !after.pauseOpen && !after.paused;
    m.reacted = legible && heldTheLine;
    m.verdict = m.reacted ? 'pass' : 'fail';
    if (!m.reacted) {
      ctx.blocker(
        'budget:swallowed-input',
        legible
          ? 'a pause tap during the draft was accepted anyway — two overlays can stack'
          : `the pause icon was lit (alpha ${armed.alpha}, interactive ${armed.interactive}) during a draft that refuses it: the tap is silently dropped`,
        m.detail,
      );
    }
  },

  /**
   * Opens the pause overlay and proves the DIRECTOR clock stops while the wall
   * clock does not — the distinction the whole run economy rests on.
   */
  async assertClockHeld(ctx, { label, dwellMs = 1600, expectFrozen = true }) {
    const before = await ctx.state();
    const wall0 = Date.now();
    await ctx.sleep(dwellMs);
    const after = await ctx.state();
    const wall = Date.now() - wall0;
    const drift = Math.round((after.runS - before.runS) * 1000);
    ctx.note(`clock:${label}`, { fromS: before.runS, toS: after.runS, driftMs: drift, wallMs: wall });
    if (expectFrozen && drift > 120) {
      ctx.blocker('clock:not-held', `${label}: the director advanced ${drift}ms while the run was supposed to be held`, {
        before: before.runS,
        after: after.runS,
        wallMs: wall,
      });
    }
    if (!expectFrozen && drift < 300) {
      ctx.blocker('clock:not-running', `${label}: the director advanced only ${drift}ms over ${wall}ms of wall clock`, {
        before: before.runS,
        after: after.runS,
      });
    }
    return { drift, wall };
  },
};

// --- arena phases ------------------------------------------------------------

/**
 * Cold boot on a wiped save -> zone select -> the three FTUE beats -> the first
 * level-up draft. This is the only phase that may see a coach beat: a repeat in
 * any later phase is the engine's `ftue:repeat` blocker.
 */
async function arenaPhaseFirstRun(ctx) {
  const { adapter, report } = ctx;
  ctx.log('phase: FTUE + first run');
  await ctx.shot('menu-zone-select');
  const buttons = await ctx.buttons();
  ctx.note('menuControls', buttons.map((b) => `${b.label}@${b.x},${b.y}`));

  // PLAY is one tap from boot — the zone is pre-selected, so tap depth is 1.
  await ctx.navigate('PLAY', 'Game', { label: 'menu->run' });
  report.measurements.tapDepth.taps = 1;
  await ctx.waitFor(async () => (await ctx.state()).started, { label: 'the arena boots' });

  // The opening beats hold the DIRECTOR, not just the spawner: a gate window
  // that ticked away under the tutorial would be the tutorial killing the run.
  const held = await ctx.state();
  if (!held.coachActive || held.coachId !== 'goal') {
    ctx.blocker('ftue:missing', `run 1 on a wiped save opened with coachId=${held.coachId} (hold=${held.coachActive})`, held);
  } else {
    await adapter.assertClockHeld(ctx, { label: 'coach beat holds the director' });
  }
  await ctx.pumpCoaches();
  if (!ctx.seenBeats.has('goal') || !ctx.seenBeats.has('stick')) {
    ctx.blocker('ftue:incomplete', 'the opening sequence did not deliver both goal and stick beats', {
      seen: [...ctx.seenBeats],
    });
  }
  await ctx.waitFor(async () => (await ctx.state()).acceptsInput, { label: 'the run starts after the FTUE' });
  await adapter.assertClockHeld(ctx, { label: 'director runs once the FTUE is done', expectFrozen: false });
  await ctx.shot('arena-field');
  await ctx.sweep('field after the FTUE');

  // The first level-up is the run's own product: kite until it lands.
  await adapter.sustain(ctx, true);
  const drafted = await adapter.kiteUntil(ctx, async (st) => st.drafting, { label: 'first level-up' });
  if (drafted.drafting) await adapter.tourDraft(ctx);
  await ctx.sweep('after the first draft');
  ctx.note('firstRunState', await ctx.state());
}

/** RESUME / RESTART / MENU — every exit the pause overlay owes the player. */
async function arenaPhasePause(ctx) {
  const { adapter } = ctx;
  ctx.log('phase: pause tour');

  await ctx.tapLabel('II', { label: 'pause open', measureAck: true });
  await ctx.waitFor(async () => (await ctx.state()).pauseOpen, { label: 'pause overlay' });
  await ctx.shot('pause');
  // The run's clock stops; the wall clock plainly does not.
  await adapter.assertClockHeld(ctx, { label: 'pause holds the director' });
  ctx.note('pauseBagRow', await ctx.evalPage(adapter.page.bagRow));

  await ctx.tapLabel('RESUME', { label: 'pause RESUME' });
  const resumeAt = await ctx.lastUpAt();
  await ctx.waitFor(async () => !(await ctx.state()).pauseOpen, { label: 'RESUME closes the overlay' });
  const playable = await ctx.waitFor(async () => {
    const st = await ctx.state();
    return st.acceptsInput ? ctx.evalPage(() => performance.now()) : false;
  }, { label: 'playable after RESUME' });
  ctx.report.measurements.retryToPlayable.samples.push({ label: 'pause RESUME -> playable', ms: Math.round(playable - resumeAt) });
  await adapter.assertClockHeld(ctx, { label: 'director runs again after RESUME', expectFrozen: false });
  await ctx.sweep('after RESUME');

  // RESTART: the same run, from zero, inside the retry budget.
  await ctx.tapLabel('II', { label: 'pause open #2' });
  await ctx.waitFor(async () => (await ctx.state()).pauseOpen, { label: 'pause overlay #2' });
  await ctx.tapLabel('RESTART', { label: 'pause RESTART' });
  const restartAt = await ctx.lastUpAt();
  const restarted = await ctx.waitFor(async () => {
    const st = await ctx.state();
    return st.acceptsInput && !st.pauseOpen && st.runS < 5 ? ctx.evalPage(() => performance.now()) : false;
  }, { label: 'RESTART reaches a playable run' });
  ctx.report.measurements.retryToPlayable.samples.push({ label: 'pause RESTART -> playable', ms: Math.round(restarted - restartAt) });
  await ctx.shot('after-restart');
  const fresh = await ctx.state();
  if (fresh.coachId !== null) {
    ctx.blocker('ftue:repeat', `coach beat "${fresh.coachId}" came back on a restart in the same save`, fresh);
  }
  await ctx.sweep('after RESTART');

  // MENU: the pause path always reaches the menu, and the menu goes back in.
  await ctx.tapLabel('II', { label: 'pause open #3' });
  await ctx.waitFor(async () => (await ctx.state()).pauseOpen, { label: 'pause overlay #3' });
  await ctx.navigate('MENU', 'Menu', { label: 'pause MENU' });
  await ctx.shot('menu-from-pause');
  await ctx.navigate('PLAY', 'Game', { label: 'menu->run #2' });
  await ctx.waitFor(async () => (await ctx.state()).acceptsInput, { label: 'the second run is playable' });
  await ctx.sweep('run re-entered from the menu');
}

/**
 * The extraction half of the loop: Gate A opens, the channel runs, a hit sets
 * it BACK rather than resetting it, and the completed rite banks the haul.
 *
 * The gate window is reached by driving the clocks (see the adapter header):
 * Gate A opens at 120s and a cert that kited there organically would be
 * measuring lethality, which the sim owns.
 */
async function arenaPhaseExtraction(ctx) {
  const { adapter, report } = ctx;
  ctx.log('phase: extraction through Gate A');
  await adapter.sustain(ctx, true);

  const jumped = await ctx.evalPage(adapter.page.fastForward, { toS: 116 });
  ctx.note('fastForward:gateA', jumped);
  const opened = await ctx.settleUntil(async () => {
    const st = await ctx.state();
    return st.gates.startsWith('open') || st.gates.startsWith('closing');
  }, { label: 'Gate A opens on its own schedule', timeout: 30000 });
  ctx.note('gateAOpen', { runS: opened.runS, gates: opened.gates });
  await ctx.shot('gate-a-open');
  // The first open gate teaches `tut:gate`; it holds the run like the others.
  await ctx.pumpCoaches();

  // Gate A's window is 120s-210s and the hero crosses the whole arena in ten
  // seconds, so the walk gets 30 of them. The budget is deliberately a third of
  // the window rather than most of it: a walk that eats the window leaves the
  // fallback below standing on a gate that has already gone spent, which is a
  // harness failure dressed up as a game one (measured, once).
  const walked = await adapter.steerTo(ctx, (f) => f.gates.find((g) => g.id === 'a'), {
    withinPx: 70,
    timeoutMs: 30000,
    label: 'walk to Gate A',
  });
  ctx.note('walkToGateA', walked);
  if (!walked.arrived) {
    // The walk is already filed as `arena:unreachable` with the obstacle field
    // that beat it. It is NOT promoted to a blocker here: gate reachability is
    // a distance question the arena sim owns and gates, and failing the whole
    // cert on the driver's own pathing would stop it certifying the channel,
    // the settlement and the late-game states — which nothing else covers.
    const placed = await ctx.evalPage(adapter.page.placeAtGate, { id: 'a' });
    ctx.note('gateAFallbackPlacement', placed);
    const stillOpen = await ctx.state();
    if (!/^(open|closing)/.test(stillOpen.gates)) {
      ctx.blocker('extract:window-missed', 'the cert reached Gate A only after its window had closed', {
        gates: stillOpen.gates,
        runS: stillOpen.runS,
      });
    }
    ctx.log('walk to Gate A lost to the prop field; placed on the ring to certify the channel');
  }

  // The setback law: a hit costs `extract.hitSetbackMs` and stalls accrual, and
  // NEVER resets the channel (PRD §7 completability invariant).
  await adapter.clearDraft(ctx);
  await ctx.evalPage(adapter.page.armChannelHit, { atProgress: 0.45 });
  const channelling = await adapter.waitRunning(ctx, (st) => st.channel.gate !== null && st.channel.progress > 0.05, {
    label: 'the channel starts in the ring',
    timeout: 25000,
  });
  ctx.note('channelStart', channelling.channel);
  await ctx.shot('channel-running');

  await ctx.waitFor(async () => {
    const probe = await ctx.evalPage(adapter.page.readChannelHit);
    return probe !== null && probe.after !== null;
  }, { label: 'the channel takes a hit', timeout: 25000 });
  const hit = await ctx.evalPage(adapter.page.readChannelHit);
  ctx.note('channelHit', hit);
  await ctx.shot('channel-after-hit');
  if (hit.after.accumMs >= hit.before.accumMs) {
    ctx.blocker('extract:no-setback', 'a hit during the channel cost nothing', hit);
  } else if (hit.after.accumMs <= 0) {
    ctx.blocker(
      'extract:channel-reset',
      `a hit RESET the channel to ${hit.after.accumMs}ms instead of setting it back from ${Math.round(hit.before.accumMs)}ms`,
      hit,
    );
  } else {
    ctx.note('channelSetbackMs', Math.round(hit.before.accumMs - hit.after.accumMs));
  }

  const extracted = await adapter.waitRunning(ctx, (st) => st.extracted || !st.active.includes('Game'), {
    label: 'the channel completes and the run ends',
    timeout: 40000,
  });
  ctx.note('extractedAt', { runS: extracted.runS, channel: extracted.channel });

  await ctx.waitFor(async () => (await ctx.sceneKeys()).includes('GameOver'), { label: 'the results screen' });
  const res = await ctx.evalPage(adapter.page.results);
  await ctx.shot('results-extracted');
  if (!res.result.won) {
    ctx.blocker('extract:not-a-win', 'a completed channel did not resolve as an extraction', res.result);
    return;
  }
  if (!res.texts.includes('HAULED OUT')) {
    ctx.blocker('extract:wrong-headline', 'the extraction results screen never says HAULED OUT', res.texts);
  }
  const meta = await ctx.evalPage(adapter.page.meta, ctx.slug);
  if (res.result.bankedShards > 0 && meta.currency < res.result.bankedShards) {
    ctx.blocker('extract:haul-not-banked', `banked ${res.result.bankedShards} shards but the stash holds ${meta.currency}`, {
      result: res.result,
      meta,
    });
  }
  report.outcomes.win = {
    via: 'extraction',
    gate: res.result.gateUsed,
    timeMs: res.result.timeMs,
    bankedShards: res.result.bankedShards,
    relics: res.result.banked.length,
    headline: res.texts[0] ?? null,
  };
  ctx.note('stashAfterExtraction', meta);
  await adapter.sustain(ctx, false);
}

/**
 * The late game and the other settlement. The Warden's 420s entrance and the
 * 480s Collapse ignition are the PRD §13 peak beats fps is scored over; the
 * casket pin and the death are the loss half of the loop.
 */
async function arenaPhaseLateGameDeath(ctx) {
  const { adapter, report } = ctx;
  ctx.log('phase: late game + death settlement');

  // RUN AGAIN is the extraction screen's CTA: same zone, fresh seed.
  const nav = await ctx.navigate('RUN AGAIN', 'Game', { label: 'results RUN AGAIN' });
  const playableAt = await ctx.waitFor(async () => {
    const st = await ctx.state();
    return st.acceptsInput ? ctx.evalPage(() => performance.now()) : false;
  }, { label: 'RUN AGAIN reaches a playable run' });
  report.measurements.retryToPlayable.samples.push({ label: 'results RUN AGAIN -> playable', ms: Math.round(playableAt - nav.t0) });
  const reentered = await ctx.state();
  if (reentered.coachId !== null) {
    ctx.blocker('ftue:repeat', `coach beat "${reentered.coachId}" came back on run 3 of the same save`, reentered);
  }
  await adapter.sustain(ctx, true);

  // Two relics on the ground: one to pin, one to lose. The roll is the game's.
  await ctx.evalPage(adapter.page.dropRelicsAtFeet, { count: 2 });
  const carried = await adapter.waitRunning(ctx, (st) => st.bag.used >= 2, {
    label: 'the hero picks the relics up',
    timeout: 25000,
  });
  ctx.note('bagBeforePin', carried.bag);

  // The casket is the only thing a death banks, and it is manual-pin-only.
  await adapter.clearDraft(ctx);
  await ctx.tapLabel('II', { label: 'pause open for the casket' });
  await ctx.waitFor(async () => (await ctx.state()).pauseOpen, { label: 'pause overlay for the casket' });
  const row = await ctx.evalPage(adapter.page.bagRow);
  await ctx.shot('pause-bag-row');
  if (row === null || row.relics.length === 0) {
    ctx.blocker('bag:no-row', 'the pause overlay showed no bag row for a bag holding relics', { row, bag: carried.bag });
  } else {
    const pip = row.relics.find((r) => !r.pinned);
    await ctx.tap(pip.x, pip.y, { label: `pin relic ${pip.id}`, measureAck: true });
    await ctx.sleep(420);
    const pinned = await ctx.state();
    await ctx.shot('pause-bag-pinned');
    if (!pinned.bag.casket.includes(pip.id)) {
      ctx.blocker('bag:pin-noop', `tapping ${pip.id} in the bag row did not pin it to the casket`, {
        casket: pinned.bag.casket,
        row,
      });
    } else {
      ctx.note('casketPinned', { id: pip.id, casket: pinned.bag.casket, carried: pinned.bag.used });
    }
  }
  await ctx.tapLabel('RESUME', { label: 'pause RESUME after the pin' });
  await ctx.waitFor(async () => (await ctx.state()).acceptsInput, { label: 'playable after the pin' });
  await ctx.sweep('after the casket pin');

  // --- the Warden, at 420s ---------------------------------------------------
  ctx.note('fastForward:warden', await ctx.evalPage(adapter.page.fastForward, { toS: 415 }));
  const warden = await adapter.waitRunning(ctx, (st) => st.bossActive, {
    label: 'the Warden takes Gate C',
    timeout: 40000,
  });
  ctx.mark('warden-spawn');
  ctx.note('wardenSpawn', { runS: warden.runS, enemies: warden.enemies, gates: warden.gates });
  await ctx.sleep(3200); // let the fps window fill on the beat itself
  await adapter.clearDraft(ctx);
  await ctx.shot('warden-spawned');
  await ctx.sweep('the Warden beat');

  // --- the Collapse, at 480s -------------------------------------------------
  ctx.note('fastForward:collapse', await ctx.evalPage(adapter.page.fastForward, { toS: 476 }));
  const collapse = await adapter.waitRunning(ctx, (st) => st.collapsing, {
    label: 'the Collapse ignites',
    timeout: 40000,
  });
  ctx.mark('collapse-ignition');
  ctx.note('collapseIgnition', { runS: collapse.runS, enemies: collapse.enemies, gates: collapse.gates });
  await ctx.sleep(3200);
  await adapter.clearDraft(ctx);
  await ctx.shot('collapse');
  await ctx.sweep('the Collapse beat');

  // --- the death settlement --------------------------------------------------
  // Lethality is the sim's gate, not this one's: the cert brings the hero to
  // the brink through the game's own health and lets the real damage path
  // finish it, so the settlement it certifies is the shipped one.
  await adapter.sustain(ctx, false);
  const bagAtDeath = await ctx.state();
  ctx.note('duskFire', await ctx.evalPage(adapter.page.duskFireKill));
  await ctx.waitFor(async () => (await ctx.sceneKeys()).includes('GameOver'), {
    label: 'the death results screen',
    timeout: 60000,
  });
  const res = await ctx.evalPage(adapter.page.results);
  await ctx.shot('results-death');
  if (res.result.won) {
    ctx.blocker('death:resolved-as-win', 'the run that ended in death settled as an extraction', res.result);
    return;
  }
  if (!res.texts.includes('SWALLOWED BY THE DARK')) {
    ctx.blocker('death:wrong-headline', 'the death results screen never says SWALLOWED BY THE DARK', res.texts);
  }
  const pinnedIds = bagAtDeath.bag.casket;
  const savedIds = res.result.casketSaved.map((r) => r.id);
  for (const id of pinnedIds) {
    if (!savedIds.includes(id)) {
      ctx.blocker('death:casket-lost', `the pinned casket relic ${id} did not survive the death`, {
        casket: pinnedIds,
        saved: savedIds,
        banked: res.result.banked.map((r) => r.id),
      });
    }
  }
  if (res.result.lost.length === 0 && res.result.carriedShards <= res.result.bankedShards) {
    ctx.major('death:nothing-lost', 'a death cost the run nothing it was carrying', res.result);
  }
  report.outcomes.loss = {
    via: 'death',
    timeMs: res.result.timeMs,
    bankedShards: res.result.bankedShards,
    carriedShards: res.result.carriedShards,
    lost: res.result.lost.map((r) => r.id),
    casketSaved: savedIds,
    headline: res.texts[0] ?? null,
  };
}

/**
 * The meta surfaces the loop feeds — stash, gear, upgrades — plus the road back
 * into a fresh run. Re-entered twice, because a screen that only survives its
 * first visit is the template's oldest trap.
 */
async function arenaPhaseSurfaces(ctx) {
  const { adapter, report } = ctx;
  ctx.log('phase: stash / gear / upgrades tour');

  await ctx.navigate('STASH', 'Meta', { label: 'results STASH' });
  await ctx.shot('stash');
  const first = await ctx.evalPage(adapter.page.stash);
  if (first === null) {
    ctx.blocker('stash:absent', 'STASH did not open a Meta scene with a list');
    return;
  }
  ctx.note('stashOpening', first);

  // GEAR: a tap cycles the slot, reversibly and with no modal (§14.5).
  const metaBefore = await ctx.evalPage(adapter.page.meta, ctx.slug);
  const inBandCell = (g) => g.y > first.band.top + 60 && g.y < first.band.bottom - 60;
  // Prefer a cell the game itself says is one tap from equipping; a slot with
  // nothing banked that FITS it is correctly inert, and asserting otherwise
  // would report the design.
  const cell =
    first.gear.find((g) => inBandCell(g) && (g.offersEquip || g.equipped)) ?? first.gear.find(inBandCell);
  if (cell) {
    await ctx.tap(cell.x, cell.y, { label: `gear cycle ${cell.slot}`, measureAck: true });
    await ctx.sleep(420);
    const metaAfter = await ctx.evalPage(adapter.page.meta, ctx.slug);
    await ctx.shot('stash-gear-cycled');
    const slot = cell.slot.toLowerCase();
    const changed = metaBefore.gear[slot] !== metaAfter.gear[slot];
    ctx.note('gearCycle', {
      slot,
      cell: { offersEquip: cell.offersEquip, nothingFits: cell.nothingFits, equipped: cell.equipped, texts: cell.texts },
      before: metaBefore.gear[slot],
      after: metaAfter.gear[slot],
      stash: metaAfter.stash,
    });
    if (!changed && (cell.offersEquip || cell.equipped)) {
      ctx.major('gear:cycle-noop', `the ${cell.slot} cell advertised a one-tap equip and the tap changed nothing`, {
        cell: cell.texts,
        before: metaBefore.gear,
        after: metaAfter.gear,
      });
    }
  } else {
    ctx.note('gearNoCellInBand', first.gear);
  }

  // UPGRADES: buy at the boundary the wallet actually sits on.
  await ctx.drag(360, first.band.bottom - 60, 360, first.band.top + 60);
  await ctx.sleep(360);
  const scrolled = await ctx.evalPage(adapter.page.stash);
  if (scrolled.scrollY <= first.scrollY && first.maxScroll > 0) {
    ctx.major('stash:no-scroll', 'the stash list did not move on a drag', { before: first.scrollY, after: scrolled.scrollY });
  }
  await ctx.shot('stash-scrolled');
  const inBand = scrolled.rows.filter((r) => r.y > scrolled.band.top + 50 && r.y < scrolled.band.bottom - 50 && r.price !== 'MAX');
  const row = inBand.find((r) => r.alpha === 1) ?? inBand[0];
  if (row) {
    const before = scrolled.currency;
    await ctx.tap(row.x, row.y, { label: `stash buy ${row.id}`, measureAck: true });
    await ctx.sleep(460);
    const post = await ctx.evalPage(adapter.page.stash);
    await ctx.shot('stash-after-buy');
    ctx.note('stashPurchase', {
      id: row.id,
      price: row.price,
      affordable: row.alpha === 1,
      currencyBefore: before,
      currencyAfter: post.currency,
      level: post.rows.find((r) => r.id === row.id)?.level ?? null,
    });
    if (row.alpha === 1 && post.currency >= before) {
      ctx.blocker('stash:buy-noop', `buying ${row.id} at ${row.price} spent nothing`, { before, after: post.currency });
    }
    if (row.alpha < 1) {
      // The empty-wallet state is a real surface: §14b keeps an unaffordable
      // price LEGIBLE at 40% so the goal still reads, and the tap answers with
      // NOT ENOUGH SHARDS rather than nothing. A row that looked affordable and
      // then charged nothing would be the silent version of the same tap.
      ctx.note('stashRefusal', { id: row.id, price: row.price, alpha: row.alpha, currency: before });
      if (row.alpha > 0.6) {
        ctx.major('stash:refusal-not-legible', `${row.id} costs ${row.price} the player cannot pay but is drawn at alpha ${row.alpha}`, row);
      }
    }
  } else {
    ctx.note('stashNoRowInBand', scrolled.rows.length);
  }

  // Re-entry, twice.
  for (let i = 1; i <= 2; i += 1) {
    await ctx.navigate('BACK', 'Menu', { label: `stash BACK #${i}` });
    await ctx.navigate('STASH', 'Meta', { label: `stash re-enter #${i}` });
    const again = await ctx.evalPage(adapter.page.stash);
    if (again === null || again.rows.length !== first.rows.length) {
      ctx.blocker('stash:reentry', `stash re-entry #${i} did not rebuild its rows`, { again });
    }
    await ctx.shot(`stash-reentry-${i}`);
  }
  await ctx.navigate('BACK', 'Menu', { label: 'stash BACK final' });

  // ...and back into a fresh run, which is where the loop closes.
  await ctx.navigate('PLAY', 'Game', { label: 'menu->run (final)' });
  const final = await ctx.waitFor(async () => {
    const st = await ctx.state();
    return st.acceptsInput ? st : false;
  }, { label: 'the final run is playable' });
  if (final.coachId !== null) {
    ctx.blocker('ftue:repeat', `coach beat "${final.coachId}" came back on the last run of the save`, final);
  }
  await ctx.shot('final-run-playable');
  await ctx.sweep('final run');
  report.notes.finalRunState = { runS: final.runS, level: final.level, bag: final.bag, gates: final.gates };
  report.notes.metaAtEnd = await ctx.evalPage(adapter.page.meta, ctx.slug);
  await adapter.releaseKeys(ctx);
}

// --- engine -----------------------------------------------------------------

export const adapters = { board: boardAdapter, arena: arenaAdapter };

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};

/** Writes the machine report release-check reads. Returns the path written. */
export function writeReport(gameDir, report) {
  const out = path.join(gameDir, REPORT_NAME);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return out;
}

/**
 * Runs the golden-path cert. Resolves with the report (already written to
 * `<gameDir>/cert-report.json`) even when the cert fails — a failed cert is a
 * result, not an exception. It only throws when the harness itself cannot run.
 */
export async function runCert({
  tab,
  page,
  baseUrl,
  gameDir,
  slug,
  familyAdapter = adapters.board,
  logger = null,
} = {}) {
  if (!tab || !page) throw new Error('runCert needs the browser tool `tab` and `page`');
  for (const [k, v] of Object.entries({ baseUrl, gameDir, slug })) {
    if (typeof v !== 'string' || v.length === 0) throw new Error(`runCert needs a ${k}`);
  }
  const adapter = familyAdapter;
  const startedAt = Date.now();
  const shotsDir = path.join(gameDir, ...SHOT_DIR);
  mkdirSync(shotsDir, { recursive: true });

  const report = {
    passed: false,
    slug,
    family: adapter.name,
    baseUrl,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    durationMs: null,
    blockers: [],
    majors: [],
    measurements: {
      ack: { budgetMs: BUDGETS.ackMs, worstMs: null, samples: [], verdict: 'unmeasured' },
      swallowedInput: { budgetMs: BUDGETS.ackMs, probed: false, reacted: null, verdict: 'unmeasured', detail: null },
      transitions: { budgetMs: BUDGETS.transitionMs, worstMs: null, samples: [], verdict: 'unmeasured' },
      retryToPlayable: { budgetMs: BUDGETS.retryMs, worstMs: null, samples: [], verdict: 'unmeasured' },
      fps: { medianMin: BUDGETS.fpsMedianMin, windows: [], verdict: 'unmeasured' },
      tapDepth: { budget: BUDGETS.tapDepth, taps: null, verdict: 'unmeasured' },
    },
    beats: [],
    surfaces: [],
    outcomes: { win: null, loss: null },
    invariantSweeps: 0,
    consoleErrors: [],
    notes: {},
    phases: [],
  };

  const log = (msg) => {
    if (logger) logger(msg);
    report.phases.push({ t: Date.now() - startedAt, msg });
  };

  // --- console / pageerror collectors (armed before the first navigation) ---
  const onConsole = (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Chrome reports a failed favicon/asset fetch as a console error too; those
    // are real and worth failing on, so nothing is filtered here.
    report.consoleErrors.push({ kind: 'console', text, url: page.url() });
  };
  const onPageError = (err) => {
    report.consoleErrors.push({ kind: 'pageerror', text: String(err && err.message ? err.message : err), stack: String(err && err.stack ? err.stack : '') });
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  const ctx = makeCtx({ tab, page, slug, baseUrl, shotsDir, report, adapter, log });

  try {
    await phaseBoot(ctx);
    // The cold boot is family-agnostic; everything after it is the adapter's
    // own tour of the loop it understands.
    for (const phase of adapter.phases) await phase(ctx);
  } catch (err) {
    ctx.blocker('harness:aborted', `cert aborted: ${String(err && err.message ? err.message : err)}`, {
      stack: String(err && err.stack ? err.stack : ''),
    });
  } finally {
    try {
      await scoreMeasurements(ctx);
    } catch (err) {
      ctx.major('harness:scoring', `could not score measurements: ${String(err && err.message ? err.message : err)}`);
    }
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  for (const e of report.consoleErrors) {
    report.blockers.push({ id: 'console:error', message: `${e.kind}: ${e.text}`, evidence: e });
  }
  if (report.outcomes.win === null) report.blockers.push({ id: 'loop:no-win', message: 'no winning session was certified' });
  if (report.outcomes.loss === null) report.blockers.push({ id: 'loop:no-loss', message: 'no losing session was certified' });
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAt;
  report.passed = report.blockers.length === 0;
  report.reportPath = writeReport(gameDir, report);
  return report;
}

// --- ctx --------------------------------------------------------------------

function makeCtx({ tab, page, slug, baseUrl, shotsDir, report, adapter, log }) {
  const ctx = {
    tab,
    page,
    slug,
    baseUrl,
    shotsDir,
    report,
    adapter,
    log,
    view: null,
    seenBeats: new Set(),
    shotSeq: 0,
    /**
     * A reload wipes the page clock and the recorders with it, so every load is
     * its own epoch and measurements are harvested before the page goes away.
     */
    epochs: [],
    /** Scene keys already entered once, so a cold-start cost can be named. */
    warmScenes: new Set(),

    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

    /**
     * One entry per finding id: the same defect met on three screens is one
     * defect with a count, not three blockers that bury everything else.
     */
    blocker(id, message, evidence = null) {
      const seen = report.blockers.find((f) => f.id === id);
      if (seen) {
        seen.seen = (seen.seen ?? 1) + 1;
        return;
      }
      report.blockers.push({ id, message, ...(evidence ? { evidence } : {}) });
      log(`BLOCKER ${id}: ${message}`);
    },
    major(id, message, evidence = null) {
      const seen = report.majors.find((f) => f.id === id);
      if (seen) {
        seen.seen = (seen.seen ?? 1) + 1;
        if (Array.isArray(seen.also)) seen.also.push(message);
        else seen.also = [message];
        return;
      }
      report.majors.push({ id, message, ...(evidence ? { evidence } : {}) });
      log(`major ${id}: ${message}`);
    },
    note(key, value) {
      report.notes[key] = value;
    },

    evalPage: (fn, arg) => (arg === undefined ? tab.evaluate(fn) : tab.evaluate(fn, arg)),

    async refreshView() {
      ctx.view = await tab.evaluate(pgViewport);
      return ctx.view;
    },

    async install() {
      const r = await tab.evaluate(pgInstall, { gameScene: adapter.gameScene });
      if (!r || !r.ok) throw new Error(`instrumentation failed: ${r ? r.why : 'no result'}`);
      await ctx.refreshView();
      return r;
    },

    /** Drains the page recorders into a new epoch. Safe to call repeatedly. */
    async harvest(label) {
      const data = await tab.evaluate(pgCollect).catch(() => null);
      if (data === null) return null;
      ctx.epochs.push({ label: `until:${label}`, ...data });
      return data;
    },

    /** Reloads the build, harvesting first and re-arming instrumentation after. */
    async reload(label) {
      await ctx.harvest(label);
      await tab.goto(ctx.baseUrl, { waitUntil: 'networkidle2' });
      await ctx.waitFor(() => tab.evaluate(() => typeof window.__GAME__ === 'object' && window.__GAME__ !== null), {
        label: `game object after ${label}`,
      });
      await ctx.install();
      await ctx.waitFor(async () => (await ctx.sceneKeys()).includes('Menu'), { label: `menu after ${label}` });
    },

    sceneKeys: () => tab.evaluate(pgSceneKeys),
    buttons: () => tab.evaluate(pgButtons),
    state: () => tab.evaluate(adapter.page.state),
    mark: (name) => tab.evaluate(pgMark, name),

    /**
     * Design-space -> CSS-pixel tap, delivered as a real down/up pair.
     *
     * The canvas rect is read FRESH every time. Caching it is a trap: a
     * screenshot, a devtools metrics override or a Scale.FIT resize moves the
     * canvas, and a stale rect silently taps the wrong control — which reads as
     * "the game ignored my input" rather than "the harness missed".
     */
    async tap(dx, dy, { label = 'tap', measureAck = false, hoverMs = 190 } = {}) {
      const v = await ctx.refreshView();
      const x = v.left + dx * v.sx;
      const y = v.top + dy * v.sy;
      // Hover first and let any POINTER_OVER tween finish, so the ack baseline
      // is not polluted by the pointer merely arriving.
      await page.mouse.move(x, y);
      if (measureAck) await ctx.sleep(hoverMs);
      if (measureAck) await tab.evaluate(pgArmAck, label);
      await page.mouse.down();
      await ctx.sleep(30);
      await page.mouse.up();
      return { x, y, dx, dy, label };
    },

    async drag(dx0, dy0, dx1, dy1, steps = 14) {
      const v = await ctx.refreshView();
      const p = (dx, dy) => ({ x: v.left + dx * v.sx, y: v.top + dy * v.sy });
      const a = p(dx0, dy0);
      const b = p(dx1, dy1);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= steps; i += 1) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
        await ctx.sleep(16);
      }
      await page.mouse.up();
    },

    /**
     * Resolves an interactive control through a caller-supplied matcher and
     * waits until it has stopped moving/fading and can be hit-tested. Shared by
     * every tap that aims at coordinates read out of the scene tree.
     */
    async stableControl(pick, { settleMs = 120, tries = 12 } = {}) {
      let btns = await ctx.buttons();
      let match = pick(btns);
      const stable = (a, b) => a.x === b.x && a.y === b.y && a.alpha === b.alpha;
      const pressable = (b) => b.visible && b.alpha > 0.02;
      for (let i = 0; i < tries; i += 1) {
        await ctx.sleep(settleMs);
        const next = await ctx.buttons();
        const again = pick(next);
        btns = next;
        if (!again) {
          if (match) break;
          match = again;
          continue;
        }
        const done = match && stable(match, again) && pressable(again);
        match = again;
        if (done) break;
      }
      return { match: match ?? null, btns, pressable: match ? pressable(match) : false };
    },

    /**
     * Finds an interactive control by label, waits until a player could
     * actually press it, and taps its centre.
     *
     * "Could actually press it" is not decoration. This template animates its
     * screens in — buttons slide up and fade from alpha 0 — and Phaser does not
     * hit-test an object at alpha 0 (`willRender` clears on the alpha flag). A
     * tap delivered during that intro is correctly ignored by the game, so a
     * driver that fires immediately reports a phantom dead button. The bar is
     * "settled", not "opaque": a shop row the player cannot afford stays dimmed
     * for good and must still be tappable so its refusal gets exercised.
     */
    async tapLabel(label, { label: tag = null, measureAck = false, exact = true, settleMs = 120, tries = 12 } = {}) {
      const pick = (btns) =>
        btns.find((b) => (exact ? b.label === label : typeof b.label === 'string' && b.label.includes(label)));
      const first = await ctx.buttons();
      if (!pick(first)) {
        ctx.blocker('ui:missing-button', `expected a "${label}" control on ${(await ctx.sceneKeys()).join('+')}`, {
          available: first.map((b) => b.label),
        });
        throw new Error(`no interactive object labelled "${label}"`);
      }
      const { match, btns, pressable } = await ctx.stableControl(pick, { settleMs, tries });
      if (!match) throw new Error(`"${label}" vanished while settling`);
      if (!pressable) {
        ctx.major('ui:unpressable-control', `"${label}" never became pressable (visible=${match.visible} alpha=${match.alpha})`, match);
      }
      // Topmost interactive control actually covering the point we are about to
      // hit. Phaser sorts by depth, so the last match wins.
      const covering = btns.filter(
        (b) =>
          b.visible &&
          b.alpha > 0.02 &&
          b.w > 0 &&
          b.h > 0 &&
          Math.abs(b.x - match.x) <= b.w / 2 &&
          Math.abs(b.y - match.y) <= b.h / 2,
      );
      const top = covering.length > 0 ? covering[covering.length - 1] : null;
      ctx.lastTapTarget = {
        ...match,
        wanted: label,
        resolvesTo: top ? `${top.scene}:${top.label}` : null,
        inventory: btns.map((b) => `${b.scene}:${b.label}@${b.x},${b.y} ${b.w}x${b.h} a${b.alpha}`),
      };
      if (top !== null && top.label !== match.label) {
        ctx.major('ui:overlapped-control', `"${label}" is covered by "${top.label}" at the point a player would tap`, ctx.lastTapTarget);
      }
      ctx.lastTapTarget.tap = await ctx.tap(match.x, match.y, { label: tag ?? `tap ${label}`, measureAck });
      return ctx.lastTapTarget;
    },

    /** Page-clock instant of the last pointerup — where a decision was made. */
    lastUpAt: () => tab.evaluate(() => window.__CERT__.lastPointerUp),

    /**
     * Taps a control and times the scene change it triggers, on the page clock.
     * Measured from the POINTERUP that fired the control (a Button in this
     * template commits on release), not from before the driver's hover settle —
     * otherwise the harness's own pacing lands in the game's budget.
     */
    async navigate(label, expectKey, { label: tag = null, timeout = 8000, retap = true } = {}) {
      const before = await ctx.evalPage(() => ({
        keys: window.__GAME__.scene.scenes.filter((s) => s.scene.isActive()).map((s) => s.scene.key),
        n: window.__CERT__.scenes.length,
      }));
      let target = await ctx.tapLabel(label, { label: tag ?? `nav ${label}`, measureAck: true });
      let t0 = await ctx.lastUpAt();
      const arrived = async () => (await ctx.sceneKeys()).includes(expectKey);
      let ok = false;
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        if (await arrived()) {
          ok = true;
          break;
        }
        await ctx.sleep(90);
      }
      if (!ok && retap) {
        // One diagnosed second attempt: the first tap changed nothing, so a
        // repeat cannot double-advance. It IS reported — a control that needs
        // two taps is a defect, not a workaround.
        ctx.major('ui:retap-needed', `"${label}" did not act on the first tap; retapping`, {
          tapped: target,
          // Where the browser really delivered it, in the game's own
          // coordinates: this separates "the game dropped the tap" from
          // "the driver missed the control".
          deliveredAt: await ctx.evalPage(() => ({
            down: window.__CERT__.lastDownPoint,
            up: window.__CERT__.lastUpPoint,
          })),
          scenesNow: await ctx.sceneKeys(),
        });
        target = await ctx.tapLabel(label, { label: `${tag ?? label} (retap)`, measureAck: false });
        t0 = await ctx.lastUpAt();
      }
      try {
        if (!ok) {
          await ctx.waitFor(arrived, { label: `${label} -> ${expectKey}`, timeout });
          ok = true;
        }
      } catch (err) {
        ctx.note(`navFailed:${tag ?? label}`, {
          wanted: expectKey,
          tapped: target,
          scenesBefore: before.keys,
          scenesNow: await ctx.sceneKeys().catch(() => null),
          trail: await ctx
            .evalPage((n) => window.__CERT__.scenes.slice(n).map((s) => s.keys), before.n)
            .catch(() => null),
        });
        throw err;
      }
      const trail = await ctx.evalPage(
        (n) => window.__CERT__.scenes.slice(n).map((s) => ({ t: s.t, keys: s.keys })),
        before.n,
      );
      const arrival = trail.find((s) => s.keys.split('+').includes(expectKey));
      const ms = arrival ? Math.round(arrival.t - t0) : null;
      // A scene's FIRST entry pays for its procedural textures and layout; the
      // budget still applies, but a cold sample and a warm one are different
      // findings, so the report says which it is.
      const cold = !ctx.warmScenes.has(expectKey);
      ctx.warmScenes.add(expectKey);
      report.measurements.transitions.samples.push({
        from: tag ?? label,
        to: expectKey,
        ms,
        cold,
        trail: trail.map((s) => s.keys),
      });
      await ctx.refreshView();
      return { ok, ms, t0, cold };
    },

    async waitFor(fn, { label = 'condition', timeout = 15000, interval = 90 } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        let v;
        try {
          v = await fn();
        } catch {
          v = false;
        }
        if (v) return v;
        if (Date.now() > deadline) {
          ctx.blocker('harness:timeout', `timed out waiting for ${label} (${timeout}ms)`, {
            scenes: await ctx.sceneKeys().catch(() => null),
          });
          throw new Error(`timeout waiting for ${label}`);
        }
        await ctx.sleep(interval);
      }
    },

    /** Waits for the board to stop animating and returns the settled state. */
    async settle({ label = 'settle', timeout = 25000 } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const st = await ctx.state();
        if (!st.active.includes(adapter.gameScene)) return st;
        if (!st.busy) return st;
        if (Date.now() > deadline) {
          ctx.blocker('harness:stuck-busy', `board never settled during ${label}`, { state: st });
          return st;
        }
        await ctx.sleep(110);
      }
    },

    async settleUntil(fn, { label = 'state', timeout = 15000 } = {}) {
      await ctx.waitFor(fn, { label, timeout });
      return ctx.state();
    },

    async shot(name) {
      ctx.shotSeq += 1;
      const file = `${String(ctx.shotSeq).padStart(2, '0')}-${name.replace(/[^a-z0-9._-]+/gi, '-')}.png`;
      const out = path.join(shotsDir, file);
      // Fence the capture out of the fps record: see `blackouts` in pgInstall.
      const from = await tab.evaluate(pgBlackoutStart).catch(() => null);
      await page.screenshot({ path: out });
      if (from !== null) await tab.evaluate(pgBlackoutEnd, from).catch(() => null);
      // A capture can emulate viewport metrics for a moment; give Scale.FIT a
      // couple of frames to land back on the real canvas size before the next
      // tap reads the rect.
      await ctx.sleep(60);
      report.surfaces.push({ name, shot: path.join(...SHOT_DIR, file) });
      return out;
    },

    /**
     * Settles the board, then runs the adapter's invariant sweep. Violations are
     * blockers: the view layer and the model having drifted apart is the class
     * of bug that ships as "the board looks wrong sometimes".
     *
     * A violation must PERSIST to count. `busy === false` means the model is at
     * rest, not that the last burst has finished painting: for a few frames the
     * outgoing containers are still in the layer and the cells they left are
     * already refilled. A real desync survives three samples half a second
     * apart; a burst does not.
     */
    async sweep(tag = 'sweep') {
      await ctx.settle({ label: `sweep ${tag}` });
      const samples = [];
      for (let i = 0; i < 3; i += 1) {
        if (i > 0) await ctx.sleep(500);
        const r = await ctx.evalPage(adapter.page.invariants);
        if (!r || r.skipped) return r;
        samples.push(r);
        if (r.count === 0) break;
      }
      report.invariantSweeps += 1;
      const last = samples[samples.length - 1];
      if (last.count > 0) {
        ctx.blocker('invariant', `${last.count} invariant violation(s) persisted at ${tag}`, {
          samples: samples.map((s) => ({ count: s.count, violations: s.violations })),
        });
      } else if (samples.length > 1) {
        ctx.note(`transientAt:${tag}`, samples[0].violations);
      }
      return last;
    },

    /**
     * Screenshots and completes every coach beat that is on screen. Called from
     * the core loop too: this family drops teaching beats mid-level, so the FTUE
     * walk is not a phase, it is a pump.
     */
    async pumpCoaches({ max = 24 } = {}) {
      for (let i = 0; i < max; i += 1) {
        const st = await ctx.state();
        if (!st.active.includes(adapter.gameScene)) return;
        if (st.coachId === null) {
          if (!st.coachActive) return;
          await ctx.sleep(160);
          continue;
        }
        const id = st.coachId;
        if (ctx.seenBeats.has(id)) {
          ctx.blocker('ftue:repeat', `coach beat "${id}" appeared twice in one save`, {
            beats: [...ctx.seenBeats],
          });
        }
        ctx.seenBeats.add(id);
        await ctx.sleep(340); // the tap catcher arms 260ms after the card lands
        const shot = await ctx.shot(`ftue-${id}`);
        report.beats.push({ id, shot: path.relative(path.dirname(path.dirname(shotsDir)), shot), gated: st.gated !== null });
        log(`FTUE beat "${id}"${st.gated ? ' (gated)' : ''}`);

        if (st.gated !== null) {
          await adapter.completeGate(ctx, st.gated);
        } else {
          await ctx.tap(360, 640, { label: `coach ${id} continue`, measureAck: i === 0 });
        }
        await ctx.waitFor(async () => (await ctx.state()).coachId !== id, {
          label: `coach beat ${id} dismissed`,
          timeout: 12000,
        });
      }
    },
  };
  return ctx;
}

// --- phases -----------------------------------------------------------------

async function phaseBoot(ctx) {
  ctx.log('phase: boot on a wiped save');
  await ctx.tab.goto(ctx.baseUrl, { waitUntil: 'networkidle2' });
  await ctx.waitFor(() => ctx.tab.evaluate(() => typeof window.__GAME__ === 'object' && window.__GAME__ !== null), {
    label: 'game object',
  });
  const wiped = await ctx.evalPage(pgWipe, ctx.slug);
  ctx.note('wipedKeys', wiped.removed);
  if (wiped.left.length > 0) ctx.note('foreignStorageKeys', wiped.left);

  // A previous game (or an older build of this one) served on this
  // origin:port may have left a service worker + cache behind — the template
  // sw.js registers in PROD builds, and preview ports get reused between
  // runs. Purge both so the cold boot below is served from the network, not
  // from another game's cached sheets.
  const sw = await ctx.tab.evaluate(async () => {
    let workers = 0;
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      workers = regs.length;
      await Promise.all(regs.map((r) => r.unregister()));
    }
    let cachesCleared = 0;
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      cachesCleared = keys.length;
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    return { workers, cachesCleared };
  });
  if (sw.workers > 0 || sw.cachesCleared > 0) ctx.note('swPurged', sw);

  // Reload so the game boots against the wiped save rather than its in-memory copy.
  await ctx.reload('cold boot');
  const post = await ctx.evalPage((slug) => Object.keys(localStorage).filter((k) => k.startsWith(`${slug}:`)), ctx.slug);
  ctx.note('storageAfterColdBoot', post);
  await ctx.shot('menu-cold-boot');
}

async function phaseWinSession(ctx) {
  const { adapter, report } = ctx;
  ctx.log('phase: FTUE + win session');

  const taps = await adapter.enterLevel(ctx, { levelIndex: 0 });
  report.measurements.tapDepth.taps = taps;
  await ctx.pumpCoaches();
  await ctx.shot('level-1-dealt');
  await ctx.sweep('level-1 dealt');

  // Win at least one level, always take the results screen's PLAY NEXT once,
  // and keep playing while the shop is still out of reach: the picker only
  // exists once a pre-level booster is owned, and the scrolled-buy check needs
  // enough banked coins to actually transact on a second row.
  const SHOP_TARGET = 150;
  let levelsPlayed = 0;
  let sawWin = false;
  let playNextDone = false;
  let stock = { currency: 0, boosters: {} };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const played = await adapter.playLevel(ctx, { anti: false, label: `win-l${levelsPlayed + 1}` });
    levelsPlayed += 1;
    await ctx.waitFor(async () => (await ctx.sceneKeys()).includes('GameOver'), { label: 'results screen' });
    const res = await ctx.evalPage(() => {
      const s = window.__GAME__.scene.getScene('GameOver');
      return { ...s.result };
    });
    await ctx.shot(res.won ? 'results-win' : 'results-loss');
    ctx.log(`level ${res.level} ${res.won ? 'WON' : 'lost'} — score ${res.score}, coins +${res.currencyEarned}`);

    if (res.won) {
      if (!sawWin) {
        ctx.mark('win-finale');
        report.outcomes.win = { level: res.level, score: res.score, moves: played.moves, coins: res.currencyEarned, headline: res.headline };
        sawWin = true;
      }
    } else if (report.outcomes.loss === null) {
      report.outcomes.loss = { level: res.level, score: res.score, moves: played.moves, headline: res.headline, via: 'greedy-play' };
    }

    stock = await ctx.evalPage(adapter.page.boosters, ctx.slug);
    ctx.note('bankAfterLevels', { levelsPlayed, ...stock });
    const funded = stock.currency >= SHOP_TARGET;
    if (sawWin && playNextDone && (funded || levelsPlayed >= 4)) break;

    // PLAY NEXT on a win, RETRY on a loss: both are the results screen's
    // primary decision, and both must land back on a playable board.
    const primary = res.won && res.next ? 'PLAY NEXT' : 'RETRY';
    const nav = await ctx.navigate(primary, 'Game', { label: `results ${primary}` });
    if (primary === 'PLAY NEXT') playNextDone = true;
    await ctx.waitFor(async () => (await ctx.state()).started, { label: 'next board dealt' });
    const playable = await ctx.waitFor(async () => {
      const st = await ctx.state();
      return st.acceptsInput ? ctx.evalPage(() => performance.now()) : false;
    }, { label: 'next board accepts input' });
    report.measurements.retryToPlayable.samples.push({
      label: `results ${primary} -> playable`,
      ms: Math.round(playable - nav.t0),
    });
    await ctx.pumpCoaches();
    await ctx.sweep(`after ${primary}`);
  }

  if (!sawWin) ctx.blocker('loop:win-unreachable', `greedy play never won a level in ${levelsPlayed} attempt(s)`);
  if (!playNextDone) ctx.major('flow:play-next-unexercised', 'never reached a win with a next level to certify PLAY NEXT');
  if (stock.currency < SHOP_TARGET) ctx.note('shopUnderfunded', { target: SHOP_TARGET, ...stock });

  // The results screen must be exitable to the menu, not only forward.
  await ctx.waitFor(async () => (await ctx.sceneKeys()).includes('GameOver'), { label: 'results screen for exit tour' });
  await ctx.navigate('MENU', 'Menu', { label: 'results MENU' });
  await ctx.shot('menu-after-win');
}

async function phaseShop(ctx) {
  const { adapter, report } = ctx;
  ctx.log('phase: shop tour');
  await ctx.navigate('SHOP', 'Meta', { label: 'menu SHOP' });
  await ctx.shot('shop');
  const first = await ctx.evalPage(adapter.page.shop);
  if (first === null) {
    ctx.blocker('shop:absent', 'SHOP did not open a Meta scene with rows');
    return;
  }
  ctx.note('shopOpening', first);

  // 1. buy the top affordable row.
  const affordable = first.rows.find((r) => r.alpha === 1 && r.priceLabel !== 'MAXED' && r.y > 264 && r.y < 964);
  if (affordable) {
    await ctx.tap(576, affordable.y, { label: `shop buy ${affordable.id}`, measureAck: true });
    await ctx.sleep(420);
    const after = await ctx.evalPage(adapter.page.shop);
    const spent = first.currency - after.currency;
    await ctx.shot('shop-after-buy');
    if (spent <= 0) {
      ctx.blocker('shop:buy-noop', `buying ${affordable.id} at ${affordable.priceLabel} did not spend currency`, {
        before: first.currency,
        after: after.currency,
      });
    } else {
      ctx.note('shopPurchase', { id: affordable.id, price: affordable.priceLabel, spent, currencyLeft: after.currency });
    }
  } else {
    ctx.note('shopNoAffordableRow', { currency: first.currency, rows: first.rows.map((r) => r.priceLabel) });
    // Empty-wallet state honesty: an unaffordable tap must refuse visibly.
    const target = first.rows.find((r) => r.y > 264 && r.y < 964);
    if (target) {
      await ctx.tap(576, target.y, { label: 'shop unaffordable buy', measureAck: true });
      await ctx.sleep(300);
      await ctx.shot('shop-refusal');
    }
  }

  // 2. scrolled buy — drag the list and transact on a row that started off-screen.
  if (first.maxScroll > 0) {
    await ctx.drag(360, 860, 360, 300);
    await ctx.sleep(320);
    const scrolled = await ctx.evalPage(adapter.page.shop);
    if (scrolled.scrollY <= first.scrollY) {
      ctx.major('shop:no-scroll', 'shop list did not move on a drag', { before: first.scrollY, after: scrolled.scrollY });
    } else {
      await ctx.shot('shop-scrolled');
      // An affordable row proves the scrolled transaction really transacts; an
      // unaffordable one only proves the refusal. Prefer the former.
      const inBand = scrolled.rows.filter((r) => r.y > 300 && r.y < 940 && r.priceLabel !== 'MAXED');
      const row = inBand.find((r) => r.alpha === 1) ?? inBand[0];
      if (row) {
        const before = scrolled.currency;
        await ctx.tap(576, row.y, { label: `shop scrolled buy ${row.id}`, measureAck: true });
        await ctx.sleep(420);
        const post = await ctx.evalPage(adapter.page.shop);
        await ctx.shot('shop-scrolled-buy');
        ctx.note('shopScrolledBuy', {
          id: row.id,
          price: row.priceLabel,
          affordable: row.alpha === 1,
          currencyBefore: before,
          currencyAfter: post.currency,
        });
        if (row.alpha === 1 && post.currency >= before) {
          ctx.blocker('shop:scrolled-buy-noop', `scrolled buy of ${row.id} charged nothing`, { before, after: post.currency });
        }
      }
    }
  } else {
    ctx.note('shopNotScrollable', { maxScroll: first.maxScroll });
  }

  // 3. re-enter twice — a shop that only survives its first visit is a defect.
  for (let i = 1; i <= 2; i += 1) {
    await ctx.navigate('BACK', 'Menu', { label: `shop BACK #${i}` });
    await ctx.navigate('SHOP', 'Meta', { label: `shop re-enter #${i}` });
    const again = await ctx.evalPage(adapter.page.shop);
    if (again === null || again.rows.length !== first.rows.length) {
      ctx.blocker('shop:reentry', `shop re-entry #${i} did not rebuild its rows`, { again });
    }
    await ctx.shot(`shop-reentry-${i}`);
  }
  await ctx.navigate('BACK', 'Menu', { label: 'shop BACK final' });
  report.notes.shopStock = await ctx.evalPage(adapter.page.boosters, ctx.slug);
}

async function phaseLossSession(ctx) {
  const { adapter, report } = ctx;
  ctx.log('phase: picker tour + loss session on a hard rung');
  const hard = 29; // w-30: the ladder's finale, 24 moves and every obstacle
  await ctx.evalPage(adapter.page.prepareLoss, { slug: ctx.slug, levelIndex: hard });
  await ctx.reload('loss-seed');

  await adapter.enterLevel(ctx, { levelIndex: hard, tourPicker: true });
  await ctx.pumpCoaches();
  await ctx.shot('hard-level-dealt');
  await ctx.sweep('hard level dealt');

  // Pause tour lives here: a level in progress is the only place it exists.
  await phasePause(ctx);

  const played = await adapter.playLevel(ctx, { anti: true, label: 'loss-run', maxMoves: 60 });
  await ctx.waitFor(async () => (await ctx.sceneKeys()).includes('GameOver'), { label: 'results after loss run' });
  const res = await ctx.evalPage(() => ({ ...window.__GAME__.scene.getScene('GameOver').result }));
  await ctx.shot(res.won ? 'hard-results-win' : 'hard-results-loss');
  if (res.won) {
    ctx.major('loop:anti-goal-won', 'anti-goal play still cleared the hard rung; loss not certified here', res);
  } else {
    report.outcomes.loss = { level: res.level, score: res.score, moves: played.moves, headline: res.headline, via: 'anti-goal' };
  }

  // RETRY is the loss screen's contract: decision tap -> playable within 2s.
  const nav = await ctx.navigate(res.won ? 'PLAY NEXT' : 'RETRY', 'Game', { label: 'results RETRY' });
  const playableAt = await ctx.waitFor(async () => {
    const st = await ctx.state();
    return st.acceptsInput ? ctx.evalPage(() => performance.now()) : false;
  }, { label: 'retry reaches a playable board' });
  report.measurements.retryToPlayable.samples.push({ label: 'loss RETRY -> playable', ms: Math.round(playableAt - nav.t0) });
  await ctx.shot('after-retry');
  await ctx.sweep('after retry');
}

async function phasePause(ctx) {
  ctx.log('phase: pause tour');
  const { adapter } = ctx;
  // RESUME
  await ctx.tapLabel('II', { label: 'pause open', measureAck: true });
  await ctx.waitFor(async () => (await ctx.state()).pauseOpen, { label: 'pause overlay' });
  await ctx.shot('pause');
  await ctx.tapLabel('RESUME', { label: 'pause RESUME' });
  await ctx.waitFor(async () => !(await ctx.state()).pauseOpen, { label: 'pause closed by RESUME' });
  await ctx.waitFor(async () => (await ctx.state()).acceptsInput, { label: 'playable after RESUME' });

  // RESTART
  await ctx.tapLabel('II', { label: 'pause open #2' });
  await ctx.waitFor(async () => (await ctx.state()).pauseOpen, { label: 'pause overlay #2' });
  await ctx.tapLabel('RESTART', { label: 'pause RESTART' });
  const t0 = await ctx.lastUpAt();
  const playableAt = await ctx.waitFor(async () => {
    const st = await ctx.state();
    return st.acceptsInput && !st.pauseOpen ? ctx.evalPage(() => performance.now()) : false;
  }, { label: 'RESTART reaches a playable board' });
  ctx.report.measurements.retryToPlayable.samples.push({ label: 'pause RESTART -> playable', ms: Math.round(playableAt - t0) });
  await ctx.shot('after-restart');
  await ctx.pumpCoaches();
  await ctx.sweep('after restart');

  // MENU — the pause path always reaches the menu.
  await ctx.tapLabel('II', { label: 'pause open #3' });
  await ctx.waitFor(async () => (await ctx.state()).pauseOpen, { label: 'pause overlay #3' });
  await ctx.navigate('MENU', 'Menu', { label: 'pause MENU' });
  await ctx.shot('menu-from-pause');

  // ...and back into the level the loss session needs.
  await adapter.enterLevel(ctx, { levelIndex: 29 });
  await ctx.pumpCoaches();
}

async function phaseMenuReentry(ctx) {
  ctx.log('phase: menu -> back into a level');
  const { adapter } = ctx;
  const st = await ctx.state();
  if (st.active.includes('Game') && st.started) {
    await ctx.tapLabel('II', { label: 'pause open for exit' });
    await ctx.waitFor(async () => (await ctx.state()).pauseOpen, { label: 'pause overlay for exit' });
    await ctx.navigate('MENU', 'Menu', { label: 'exit to menu' });
  } else if (!(await ctx.sceneKeys()).includes('Menu')) {
    await ctx.navigate('MENU', 'Menu', { label: 'exit to menu' });
  }
  await adapter.enterLevel(ctx, { levelIndex: 0 });
  await ctx.pumpCoaches();
  const final = await ctx.waitFor(async () => {
    const s = await ctx.state();
    return s.acceptsInput ? s : false;
  }, { label: 'menu re-entry reaches a playable board' });
  await ctx.shot('menu-reentry-playable');
  await ctx.sweep('menu re-entry');
  ctx.note('menuReentryState', { level: final.levelIndex, movesLeft: final.movesLeft, goals: final.goals });
}

// --- scoring ----------------------------------------------------------------

async function scoreMeasurements(ctx) {
  const { report } = ctx;
  const m = report.measurements;
  await ctx.harvest('end of run');
  const epochs = ctx.epochs;
  if (epochs.length === 0) {
    ctx.major('measure:no-data', 'instrumentation never recorded a sample');
    return;
  }
  const acksAll = epochs.flatMap((e) => e.acks.map((a) => ({ ...a, epoch: e.label })));
  const marksAll = epochs.flatMap((e, i) => e.marks.map((k) => ({ ...k, epoch: i })));
  // ack
  const acks = acksAll.filter((a) => a.ms !== null);
  m.ack.samples = acksAll;
  if (acks.length === 0) {
    m.ack.verdict = 'unmeasured';
    ctx.major('measure:no-ack', 'no input acknowledgment sample was captured');
  } else {
    const worst = acks.reduce((a, b) => (b.ms > a.ms ? b : a));
    m.ack.worstMs = worst.ms;
    m.ack.worstLabel = worst.label;
    m.ack.verdict = worst.ms <= BUDGETS.ackMs ? 'pass' : 'fail';
    if (m.ack.verdict === 'fail') {
      ctx.blocker('budget:ack', `worst input acknowledgment ${worst.ms}ms > ${BUDGETS.ackMs}ms budget on "${worst.label}"`, worst);
    }
  }
  const timedOut = acksAll.filter((a) => a.timedOut);
  if (timedOut.length > 0) {
    ctx.blocker('budget:ack-silent', `${timedOut.length} tap(s) produced no visible reaction at all`, timedOut);
  }

  // transitions
  const ts = m.transitions.samples.filter((s) => s.ms !== null);
  if (ts.length > 0) {
    const worst = ts.reduce((a, b) => (b.ms > a.ms ? b : a));
    m.transitions.worstMs = worst.ms;
    m.transitions.worstLabel = `${worst.from} -> ${worst.to}`;
    const over = ts.filter((s) => s.ms > BUDGETS.transitionMs);
    m.transitions.verdict = over.length === 0 ? 'pass' : 'fail';
    if (over.length > 0) {
      ctx.blocker('budget:transition', `${over.length} scene transition(s) over ${BUDGETS.transitionMs}ms`, over);
    }
  }

  // retry-to-playable
  const rs = m.retryToPlayable.samples.filter((s) => s.ms !== null);
  if (rs.length > 0) {
    const worst = rs.reduce((a, b) => (b.ms > a.ms ? b : a));
    m.retryToPlayable.worstMs = worst.ms;
    m.retryToPlayable.worstLabel = worst.label;
    const over = rs.filter((s) => s.ms > BUDGETS.retryMs);
    m.retryToPlayable.verdict = over.length === 0 ? 'pass' : 'fail';
    if (over.length > 0) {
      ctx.blocker('budget:retry', `${over.length} retry/restart path(s) over ${BUDGETS.retryMs}ms to playable`, over);
    }
  }

  // fps: score each named heavy beat's 3s window, plus the worst 3s window of
  // every epoch so a heavy beat the adapter forgot to name still gets seen.
  const heavy = new Set(ctx.adapter.heavyBeats ?? []);
  epochs.forEach((epoch, ei) => {
    const blackouts = epoch.blackouts ?? [];
    // Samples taken while the harness was capturing a screenshot measure the
    // capture, not the build.
    const fps = epoch.fps.filter((sample) => !blackouts.some(([a, b]) => sample.t >= a && sample.t <= b));
    const stats = (label, t0) => {
      const xs = fps.filter((s) => s.t >= t0 && s.t <= t0 + 3000).map((s) => s.fps);
      if (xs.length < 10) return null;
      return {
        label,
        epoch: epoch.label,
        samples: xs.length,
        min: Math.min(...xs),
        median: median(xs),
        fromMs: Math.round(t0),
      };
    };
    for (const mark of marksAll.filter((k) => k.epoch === ei)) {
      if (!heavy.has(mark.name)) continue;
      const w = stats(mark.name, mark.t);
      if (w) m.fps.windows.push(w);
    }
    let worst = null;
    for (let i = 0; i < fps.length; i += 1) {
      const w = stats('worst-3s-window', fps[i].t);
      if (w !== null && (worst === null || w.min < worst.min)) worst = w;
    }
    if (worst) m.fps.windows.push(worst);
  });
  if (m.fps.windows.length === 0) {
    m.fps.verdict = 'unmeasured';
  } else {
    const bad = m.fps.windows.filter((w) => w.median < BUDGETS.fpsMedianMin || w.min < BUDGETS.fpsMinMin);
    m.fps.verdict = bad.length === 0 ? 'pass' : 'fail';
    if (bad.length > 0) {
      ctx.blocker('budget:fps', `${bad.length} sampled window(s) under the 60fps budget`, bad);
    }
  }

  // tap depth
  if (m.tapDepth.taps !== null) {
    m.tapDepth.verdict = m.tapDepth.taps <= BUDGETS.tapDepth ? 'pass' : 'fail';
    if (m.tapDepth.verdict === 'fail') {
      ctx.major('budget:tap-depth', `${m.tapDepth.taps} taps from boot to the core action (budget ${BUDGETS.tapDepth})`);
    }
  }

  if (!m.swallowedInput.probed) {
    m.swallowedInput.verdict = 'unmeasured';
    ctx.major('measure:no-swallow-probe', 'never caught the board mid-cascade to probe swallowed input');
  }

  report.notes.epochs = epochs.map((e) => ({
    label: e.label,
    frames: e.frames,
    fpsSamples: e.fps.length,
    marks: e.marks.map((k) => k.name),
    sceneTrail: e.scenes.map((s) => `${s.t}:${s.keys}`),
  }));
}

/**
 * Family-agnostic monkey test — needs NO adapter, so it runs for EVERY game,
 * including families whose cert adapter has not been written yet. It hammers
 * random input over the live canvas while watching the invariants that hold
 * for any family:
 *   - no console error / uncaught exception at any point,
 *   - `window.__GAME__` alive with at least one active scene,
 *   - the game loop keeps advancing (renderer not wedged),
 *   - after the storm, a reload boots clean (the save was not corrupted).
 *
 * Runs in the same `xd://browser` `run` sandbox as `runCert` (same import
 * dance from the USAGE header):
 *
 *   const fuzz = await mod.runFuzz({ tab, page,
 *     baseUrl: 'http://localhost:5322/',
 *     gameDir: '<repo>/games/<slug>', seconds: 45 });
 *
 * Writes `<gameDir>/fuzz-report.json` and screenshots the first failure into
 * `<gameDir>/shots/cert/`. A failing fuzz RESOLVES with `passed: false` —
 * only a broken harness throws. Deterministic for a given `seed` up to page
 * timing.
 */
export async function runFuzz({ tab, page, baseUrl, gameDir, seconds = 45, seed = 1, logger = () => {} }) {
  // Small LCG so a repro can replay the same action stream.
  let rngState = (seed >>> 0) || 1;
  const rng = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 0x100000000;
  };
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const errors = [];
  const failures = [];
  const sceneTrail = [];
  let actions = 0;
  let shotSaved = false;

  const shotDir = path.join(gameDir, ...SHOT_DIR);
  const failShot = async (label) => {
    if (shotSaved) return; // first failure is the interesting one
    shotSaved = true;
    try {
      mkdirSync(shotDir, { recursive: true });
      await page.screenshot({ path: path.join(shotDir, `fuzz-fail-${label}.png`) });
    } catch {
      /* screenshot is best-effort */
    }
  };

  const onConsole = (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  };
  const onPageError = (err) => {
    errors.push(`pageerror: ${err?.message ?? String(err)}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  /** Main-world probe: alive + active scenes + a loop-progress stamp. */
  const probe = () =>
    tab.evaluate(() => {
      const g = window.__GAME__;
      if (!g) return null;
      return {
        scenes: g.scene.scenes.filter((s) => s.scene.isActive()).map((s) => s.scene.key),
        loopTime: g.loop.time,
      };
    });

  const waitForBoot = async (label) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const p = await probe().catch(() => null);
      if (p && p.scenes.length > 0) return true;
      await sleep(250);
    }
    failures.push(`${label}: no active scene within 20s of navigation`);
    await failShot(label);
    return false;
  };

  try {
    await tab.goto(baseUrl, { waitUntil: 'networkidle2' });
    // Purge any service worker + caches a previous game left on this
    // origin:port (template sw.js registers in PROD builds), then reload so
    // the boot under test is served from the network.
    await tab
      .evaluate(async () => {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      })
      .catch(() => {});
    await tab.goto(baseUrl, { waitUntil: 'networkidle2' });
    const booted = await waitForBoot('boot');

    if (booted) {
      const rect = await tab.evaluate(() => {
        const c = document.querySelector('canvas');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (!rect) {
        failures.push('boot: no canvas element on the page');
        await failShot('no-canvas');
      } else {
        const KEYS = ['Escape', 'KeyP', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
        const px = () => rect.x + rect.w * (0.05 + rng() * 0.9);
        const py = () => rect.y + rect.h * (0.05 + rng() * 0.9);
        const deadline = Date.now() + seconds * 1000;
        let lastProbe = { at: 0, loopTime: -1 };

        while (Date.now() < deadline) {
          const roll = rng();
          try {
            if (roll < 0.62) {
              await page.mouse.click(px(), py());
            } else if (roll < 0.78) {
              const x0 = px();
              const y0 = py();
              await page.mouse.move(x0, y0);
              await page.mouse.down();
              await page.mouse.move(px(), py(), { steps: 4 });
              await page.mouse.up();
            } else if (roll < 0.9) {
              await page.keyboard.press(pick(KEYS));
            } else {
              const x = px();
              const y = py();
              await page.mouse.click(x, y);
              await page.mouse.click(x, y, { delay: 40 });
            }
          } catch (err) {
            // A dead click target is a finding only if the page itself broke;
            // input-dispatch hiccups (detached frame mid-transition) are noise.
            if (!page.isClosed?.()) continue;
            failures.push(`input: ${err.message}`);
            break;
          }
          actions += 1;
          await sleep(60 + rng() * 180);

          if (Date.now() - lastProbe.at > 2000) {
            const p = await probe().catch(() => null);
            if (!p || p.scenes.length === 0) {
              failures.push(`invariant: no active scene after ${actions} action(s)`);
              await failShot('no-scene');
              break;
            }
            // The driven tab is always visible in this harness, so a frozen
            // loop.time between probes means the game loop wedged.
            if (p.loopTime === lastProbe.loopTime) {
              failures.push(`invariant: game loop wedged (loop.time frozen) after ${actions} action(s)`);
              await failShot('wedged');
              break;
            }
            sceneTrail.push(p.scenes.join('+'));
            lastProbe = { at: Date.now(), loopTime: p.loopTime };
          }
        }

        // The storm is only half the test: the save it mutated must still boot.
        await tab.goto(baseUrl, { waitUntil: 'networkidle2' });
        await waitForBoot('boot-after-fuzz');
      }
    }
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  for (const e of errors) failures.push(e);
  if (errors.length > 0) await failShot('page-error');

  const report = {
    kind: 'fuzz',
    passed: failures.length === 0,
    seconds,
    seed,
    actions,
    failures,
    sceneTrail: sceneTrail.slice(-20),
    finishedAt: new Date().toISOString(),
  };
  const out = path.join(gameDir, 'fuzz-report.json');
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  logger(`fuzz: ${report.passed ? 'PASS' : 'FAIL'} — ${actions} action(s), ${failures.length} failure(s) -> ${out}`);
  return { ...report, reportPath: out };
}
