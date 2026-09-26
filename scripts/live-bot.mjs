#!/usr/bin/env node
/**
 * Honest live bot — the `difficulty-live` taste axis (PRD §1c) measured on the
 * REAL build, because difficulty tuned on sims shipped "too easy" to a live
 * human. It plays the production preview the way a player does and reports
 * what a playtester would feel: how low the hero's HP got, how many drafts,
 * whether the run extracted or died, and how long it took.
 *
 * HONEST means real input only — a pointer joystick, ESC and taps on the draft
 * cards, at a human reaction time. No hp refills, no invulnerability, no clock
 * jumps, no teleports, no save edits (except `--fresh`, which wipes the save
 * BEFORE the first run so run 1 is what a new player gets).
 *
 * USAGE
 *   # 1. the production preview (long-running: use the process supervisor)
 *   npm run build && npm run preview -- --port 5322        # inside games/<slug>
 *   # 2. one Chrome per bot (a second tab backgrounds the first and sleeps its loop)
 *   <chrome> --headless=new --remote-debugging-port=9222 --mute-audio \
 *            --user-data-dir=/tmp/bot-chrome --no-first-run
 *   # 3. the bot, once per policy
 *   node scripts/live-bot.mjs <slug> --url http://localhost:5322/ --policy novice \
 *        [--runs 3] [--seconds 480] [--endpoint http://127.0.0.1:9222] \
 *        [--fresh] [--family arena] [--out <file>] [--shots <dir>]
 *
 * `?mute=1` is forced on every load (cert-driver `withMute`). Writes
 * `games/<slug>/live-bot-<policy>.json` (or `--out`) and prints the summary:
 * per run {outcome: extracted|died|timeout, gate, runS, wallS, minHpPct,
 * drafts, kills, level, firstDraftS}; summary {extractRate, medianMinHpPct,
 * medianRunS, verdict}. `--seconds` caps one run in the game's own clock; a
 * run over it is abandoned through the pause menu and counts as `timeout`.
 * The scripted FTUE run a `--fresh` save opens with (mode `ftue`) counts
 * toward `--runs` and is listed, but never scored.
 *
 * POLICIES (the calibration targets, game-prd genre playbooks §Taste floors)
 *   novice   450 ms reaction, takes the top draft card after a 1.8 s read,
 *            walks to the first gate that opens. Target: extracts in >= half
 *            the runs, yet its minimum HP drops below 50% (the run was felt).
 *   veteran  160 ms reaction, drafts by rank (evolution > weapon rank > new
 *            weapon > charm > stat), hunts POI chests, skips the first gate
 *            while above 35% HP to take the second, contested extraction.
 *            Target: extractions are contested (min HP < 50%); deaths are fine.
 *   verdict  novice: too-hard (extractRate < 0.5) | too-easy (median min HP
 *            >= 50%) | on-target; veteran: too-easy (every run extracted with
 *            min HP >= 50%) | on-target. Aim one step harder than bots suggest.
 *
 * FAMILY ADAPTERS
 * `botAdapters.<family>` knows how to enter a run, read state, steer, draft,
 * read the outcome and abandon; the loop above it is family-agnostic. Only
 * `arena` (Duskhaul-lineage survivor/extraction slices) is implemented; it
 * reuses the cert adapter's page functions (`adapters.arena.page.*` in
 * scripts/cert-driver.mjs) so the bot and the cert read the game one way.
 * A family without an adapter fails loudly instead of reporting a fake run.
 *
 * Importable: `runLiveBot({ tab, page, slug, policy, runs, seconds, family })`
 * resolves with the report object (it does not write files).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters as certAdapters, openCdpTab } from './cert-driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const POLICIES = {
  novice: { reactMs: 450, draftReadMs: 1800, rankDrafts: false, hunt: false, skipFirstGate: false, commit: 3 },
  veteran: { reactMs: 160, draftReadMs: 400, rankDrafts: true, hunt: true, skipFirstGate: true, commit: 3 },
};

/** Design-space geometry of the canvas, so taps land where the game draws. */
const pgViewport = () => {
  const g = window.__GAME__;
  const r = g.canvas.getBoundingClientRect();
  return { left: r.left, top: r.top, sx: r.width / g.scale.width, sy: r.height / g.scale.height, w: g.scale.width, h: g.scale.height };
};

const pgSceneKeys = () => (window.__GAME__ ? window.__GAME__.scene.scenes.filter((s) => s.scene.isActive()).map((s) => s.scene.key) : []);

/**
 * Arena steering decision (page side): a flee vector from enemy and shot
 * pressure, and the goal the policy wants — an open gate (the veteran passes
 * over the first while healthy), a POI chest when hunting, the nearest orb,
 * else the gate it is waiting on.
 */
const pgArenaDecide = (opt) => {
  const s = window.__GAME__.scene.getScene('Game');
  if (!s || !s.scene.isActive() || !s.built || !s.combat || !s.extraction) return null;
  const c = s.combat;
  const p = c.player;
  let fx = 0;
  let fy = 0;
  for (const e of Array.isArray(c.enemies) ? c.enemies : []) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 420 * 420 && d2 > 1) {
      const d = Math.sqrt(d2);
      const w = ((e.def && e.def.rank !== 'trash' ? 3 : 1) / d2) * 1e5;
      fx += (dx / d) * w;
      fy += (dy / d) * w;
    }
  }
  for (const h of Array.isArray(c.hostile) ? c.hostile : []) {
    const dx = p.x - h.x;
    const dy = p.y - h.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 300 * 300 && d2 > 1) {
      const d = Math.sqrt(d2);
      fx += ((dx / d) * 2e5) / d2;
      fy += ((dy / d) * 2e5) / d2;
    }
  }
  const hpMax = p.health.max ?? 100;
  const gates = s.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, state: String(s.extraction.gateState(g.id)) }));
  const passOver = opt.skipFirstGate && p.health.hp > 0.35 * hpMax;
  const open = gates.find((g) => /open|closing/.test(g.state) && !(passOver && (g.id === 'a' || g.id === 'x')));
  let goal = null;
  let why = 'idle';
  if (open) {
    goal = open;
    why = `gate-${open.id}`;
  }
  if (!goal && opt.hunt && s.poi) {
    let best = 2200 * 2200;
    for (const q of Array.isArray(s.poi.pois) ? s.poi.pois : []) {
      if (!q.active || q.done || !q.anchor || !/chest|vein|shrine|vault/.test(q.anchor.kind)) continue;
      const d = (q.anchor.x - p.x) ** 2 + (q.anchor.y - p.y) ** 2;
      if (d < best) {
        best = d;
        goal = { x: q.anchor.x, y: q.anchor.y };
        why = `poi-${q.anchor.kind}`;
      }
    }
    for (const q of Array.isArray(s.poi.chests) ? s.poi.chests : []) {
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < best) {
        best = d;
        goal = { x: q.x, y: q.y };
        why = 'poi-drop';
      }
    }
  }
  let near = false;
  if (!goal) {
    let best = 700 * 700;
    for (const o of Array.isArray(c.orbs) ? c.orbs : []) {
      if (o.active === false) continue;
      const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
      if (d < best) {
        best = d;
        goal = { x: o.x, y: o.y };
        why = 'orb';
        near = true;
      }
    }
  }
  if (!goal) {
    const g = gates.find((x) => x.id === (passOver ? 'b' : 'a')) ?? gates[0];
    if (g) {
      goal = g;
      why = `toward-${g.id}`;
    }
  }
  return { fx, fy, goal: goal ? { x: Math.round(goal.x), y: Math.round(goal.y) } : null, why, near, px: Math.round(p.x), py: Math.round(p.y) };
};

/** A pointer joystick in design space: hold on the lower half, steer by offset. */
function joystick(h) {
  let down = false;
  const origin = { x: 360, y: 1000 };
  const reach = 90;
  return {
    async dir(vx, vy) {
      const m = Math.hypot(vx, vy);
      if (m < 0.05) {
        await this.release();
        return;
      }
      const v = await h.view();
      const at = (dx, dy) => [v.left + dx * v.sx, v.top + dy * v.sy];
      if (!down) {
        await h.page.mouse.move(...at(origin.x, origin.y));
        await h.page.mouse.down();
        down = true;
      }
      await h.page.mouse.move(...at(origin.x + (vx / m) * reach, origin.y + (vy / m) * reach));
    },
    async release() {
      if (down) {
        await h.page.mouse.up();
        down = false;
      }
    },
  };
}

/**
 * Veteran draft preference: the card's kind line when its face has Text, else
 * its `cardId` (Duskhaul-lineage ids `w_evo_`/`w_boost_`/`w_unlock_`/`ch_rank_`/
 * `ch_unlock_` — card faces there are baked, so the id is the only identity).
 */
const cardRank = (card) => {
  const t = `${card.texts.join(' ')} ${card.cardId ?? ''}`;
  if (/EVOLUTION|\bw_evo_/.test(t)) return 6;
  if (/WEAPON \+1|\bw_boost_/.test(t)) return 5;
  if (/NEW WEAPON|\bw_unlock_/.test(t)) return 4;
  if (/Pairs with/i.test(t)) return 3.5;
  if (/CHARM \+1|\bch_rank_/.test(t)) return 3;
  if (/NEW CHARM|\bch_unlock_/.test(t)) return 2.5;
  return 1;
};

export const botAdapters = {
  arena: {
    gameScene: 'Game',
    async controls(h) {
      return h.tab.evaluate(certAdapters.arena.page.controls);
    },
    async state(h) {
      const st = await h.tab.evaluate(certAdapters.arena.page.state).catch(() => null);
      return st && st.started ? st : null;
    },
    /** Hub/Results → a live run: CONTINUE, EMBARK, DESCEND (whichever the screen shows). */
    async enterRun(h) {
      for (let i = 0; i < 40; i += 1) {
        const keys = await h.keys();
        // A Game scene left active behind the Hub is not a run: only a started one counts.
        const st = keys.includes('Game') ? await this.state(h) : null;
        if (st?.acceptsInput) return true;
        if (st && !st.ended) {
          await sleep(400);
          continue;
        }
        const all = await this.controls(h);
        const pick = ['CONTINUE', 'DESCEND', 'EMBARK'].map((l) => all.find((c) => c.label === l && c.visible && c.inView && c.alpha > 0.5)).find(Boolean);
        if (pick) await h.tap(pick.x, pick.y);
        await sleep(900);
      }
      return false;
    },
    async steer(h, policy, stick, mem) {
      const d = await h.tab.evaluate(pgArenaDecide, { hunt: policy.hunt, skipFirstGate: policy.skipFirstGate }).catch(() => null);
      if (!d) return null;
      let gx = 0;
      let gy = 0;
      if (d.goal) {
        let hx = d.goal.x - d.px;
        let hy = d.goal.y - d.py;
        const dist = Math.hypot(hx, hy) || 1;
        if (!d.near && dist > 160) {
          await h.tab.evaluate(() => {
            window.__CERT__ = window.__CERT__ || {};
          });
          const head = await h.tab.evaluate(certAdapters.arena.page.navHeading, d.goal).catch(() => null);
          if (head && !head.ended) {
            hx = head.hx;
            hy = head.hy;
          }
        }
        const m = Math.hypot(hx, hy) || 1;
        const arrived = (d.why.startsWith('gate') || d.why.startsWith('poi')) && dist < 50;
        gx = arrived ? 0 : hx / m;
        gy = arrived ? 0 : hy / m;
      }
      const flee = Math.hypot(d.fx, d.fy);
      const wGoal = d.why.startsWith('gate') ? 1.6 * policy.commit : 0.7;
      let vx = gx * wGoal + (flee > 0 ? (d.fx / Math.max(flee, 1)) * Math.min(flee, 3) : 0);
      let vy = gy * wGoal + (flee > 0 ? (d.fy / Math.max(flee, 1)) * Math.min(flee, 3) : 0);
      // A wedge against scenery: a short sideways burst, the way a player unsticks.
      const moved = mem.last ? Math.hypot(d.px - mem.last.x, d.py - mem.last.y) : 99;
      mem.last = { x: d.px, y: d.py };
      mem.stuckMs = moved < 6 && !d.why.startsWith('gate') ? (mem.stuckMs ?? 0) + policy.reactMs : 0;
      if (mem.stuckMs > 1200) {
        const a = Math.random() * Math.PI * 2;
        mem.jitter = { vx: Math.cos(a), vy: Math.sin(a), until: Date.now() + 900 };
        mem.stuckMs = 0;
      }
      if (mem.jitter && Date.now() < mem.jitter.until) {
        vx = mem.jitter.vx;
        vy = mem.jitter.vy;
      }
      await stick.dir(vx, vy);
      return d.why;
    },
    async draft(h, policy) {
      await sleep(policy.draftReadMs);
      const cards = (await this.controls(h)).filter((c) => c.scene === 'Game' && c.card && c.visible && c.alpha > 0.5).sort((a, b) => a.y - b.y);
      if (cards.length === 0) return null;
      const pick = policy.rankDrafts ? [...cards].sort((a, b) => cardRank(b) - cardRank(a))[0] : cards[0];
      await h.tap(pick.x, pick.y);
      await sleep(350);
      return pick.cardId ?? pick.texts.slice(0, 3).join(' / ');
    },
    /** Pause, bag sheet or a fence trade left open: ESC closes it (a player backs out). */
    async unblock(h, st) {
      if (st.pauseOpen || st.bagSheetOpen || st.fenceOpen) {
        await h.page.keyboard.down('Escape');
        await h.page.keyboard.up('Escape');
        await sleep(300);
        return true;
      }
      return false;
    },
    async results(h) {
      return h.tab.evaluate(certAdapters.arena.page.results).catch(() => null);
    },
    /** Over the time cap: pause → ABANDON RUN → confirm. */
    async abandon(h) {
      for (let i = 0; i < 4; i += 1) {
        const st = await this.state(h);
        if (!st) break;
        if (!st.pauseOpen) {
          await h.page.keyboard.down('Escape');
          await h.page.keyboard.up('Escape');
          await sleep(500);
        }
        const all = await this.controls(h);
        const ab = all.find((c) => c.scene === 'Game' && c.label === 'ABANDON RUN' && c.visible);
        if (ab) {
          await h.tap(ab.x, ab.y);
          await sleep(500);
          const confirm = (await this.controls(h)).find((c) => c.scene === 'Game' && c.label === 'ABANDON' && c.visible);
          if (confirm) await h.tap(confirm.x, confirm.y);
          break;
        }
        if (st.drafting) await this.draft(h, POLICIES.novice);
      }
      for (let i = 0; i < 30 && !(await h.keys()).includes('GameOver'); i += 1) await sleep(300);
    },
  },
};

/**
 * Plays `runs` runs with `policy` on an already-open tab and resolves with the
 * report. `tab.evaluate` runs in the page's main world, `page` supplies real
 * input — the same host contract as scripts/cert-driver.mjs.
 */
export async function runLiveBot({ tab, page, slug, policy: policyName = 'novice', runs = 3, seconds = 480, family = 'arena', fresh = false, shotsDir = null, logger = null }) {
  const adapter = botAdapters[family];
  if (!adapter) throw new Error(`live-bot: no adapter for family "${family}" — implement botAdapters.${family} in scripts/live-bot.mjs`);
  const policy = POLICIES[policyName];
  if (!policy) throw new Error(`live-bot: unknown policy "${policyName}" (${Object.keys(POLICIES).join(' | ')})`);
  const log = (m) => logger && logger(`[live-bot ${policyName}] ${m}`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
  let view = null;
  let viewAt = 0;
  const h = {
    tab,
    page,
    keys: () => tab.evaluate(pgSceneKeys).catch(() => []),
    async view() {
      if (view === null || Date.now() - viewAt > 5000) {
        view = await tab.evaluate(pgViewport);
        viewAt = Date.now();
      }
      return view;
    },
    async tap(dx, dy) {
      const v = await this.view();
      await page.mouse.move(v.left + dx * v.sx, v.top + dy * v.sy);
      await sleep(40);
      await page.mouse.down();
      await sleep(40);
      await page.mouse.up();
    },
  };
  for (let i = 0; i < 60 && !(await tab.evaluate(() => typeof window.__GAME__ === 'object' && window.__GAME__ !== null).catch(() => false)); i += 1) await sleep(250);
  if (fresh) {
    await tab.evaluate(() => localStorage.clear());
    await tab.evaluate(() => location.reload()).catch(() => null);
    await sleep(1500);
    for (let i = 0; i < 60 && !(await tab.evaluate(() => typeof window.__GAME__ === 'object' && window.__GAME__ !== null).catch(() => false)); i += 1) await sleep(250);
    log('save wiped (--fresh)');
  }
  const forced = await tab.evaluate(() => (typeof window.__AUDIO__ === 'function' ? window.__AUDIO__().forcedByUrl : null)).catch(() => null);
  if (forced === false) throw new Error('live-bot: the page loaded WITHOUT ?mute=1 in effect — refusing to play audio out loud');

  const rows = [];
  for (let run = 1; run <= runs; run += 1) {
    if (!(await adapter.enterRun(h))) {
      rows.push({ run, outcome: 'no-run', note: `could not enter a run from ${(await h.keys()).join('+')}` });
      break;
    }
    const stick = joystick(h);
    const mem = {};
    const t0 = Date.now();
    let minHpPct = 100;
    let drafts = 0;
    let firstDraftS = null;
    let last = null;
    let timedOut = false;
    const why = {};
    for (;;) {
      const keys = await h.keys();
      if (!keys.includes(adapter.gameScene) || keys.includes('GameOver')) break;
      const st = await adapter.state(h);
      if (!st) {
        await sleep(200);
        continue;
      }
      last = st;
      if (st.hpMax > 0) minHpPct = Math.min(minHpPct, Math.round((100 * Math.max(0, st.hp)) / st.hpMax));
      if (st.ended || st.dying) {
        await stick.release();
        await sleep(300);
        continue;
      }
      if (st.drafting) {
        await stick.release();
        if (firstDraftS === null) firstDraftS = st.runS;
        const card = await adapter.draft(h, policy);
        if (card !== null) drafts += 1;
        if (drafts <= 2) log(`run ${run} draft #${drafts} at ${st.runS}s: ${card}`);
        continue;
      }
      if (await adapter.unblock(h, st)) {
        await stick.release();
        continue;
      }
      // The game's clock caps a run; the wall clock caps a stalled one (twice the budget plus boot slack).
      if (st.runS > seconds || (Date.now() - t0) / 1000 > seconds * 2 + 120) {
        await stick.release();
        timedOut = true;
        log(`run ${run}: over the ${seconds}s cap at ${st.runS}s — abandoning`);
        await adapter.abandon(h);
        break;
      }
      const w = await adapter.steer(h, policy, stick, mem);
      if (w) why[w.replace(/-.*$/, '')] = (why[w.replace(/-.*$/, '')] ?? 0) + 1;
      await sleep(policy.reactMs);
    }
    await stick.release();
    for (let i = 0; i < 40 && !(await h.keys()).includes('GameOver'); i += 1) await sleep(250);
    await sleep(900);
    const res = await adapter.results(h);
    if (shotsDir) {
      mkdirSync(shotsDir, { recursive: true });
      await page.screenshot({ path: path.join(shotsDir, `${policyName}-run${run}-results.png`) }).catch(() => null);
    }
    const outcome = timedOut ? 'timeout' : res && res.outcome === 'extracted' ? 'extracted' : res && res.outcome === 'died' ? 'died' : res ? res.outcome : 'unknown';
    const row = {
      run,
      mode: last ? last.mode : null,
      zone: last ? last.zone : null,
      outcome,
      gate: res ? res.gate : null,
      killer: res ? res.killer : null,
      runS: res && typeof res.elapsedS === 'number' ? Math.round(res.elapsedS) : last ? Math.round(last.runS) : null,
      wallS: Math.round((Date.now() - t0) / 1000),
      minHpPct,
      drafts,
      firstDraftS,
      kills: last ? last.kills : null,
      level: last ? last.level : null,
      steering: why,
    };
    rows.push(row);
    log(`run ${run}: ${JSON.stringify(row)}`);
  }
  await page.keyboard.up('Escape').catch(() => {});

  // The FTUE run is a scripted tutorial, not the difficulty being calibrated: listed, not scored.
  const played = rows.filter((r) => r.outcome !== 'no-run' && r.mode !== 'ftue');
  const extracted = played.filter((r) => r.outcome === 'extracted');
  const summary = {
    runs: played.length,
    extracted: extracted.length,
    died: played.filter((r) => r.outcome === 'died').length,
    timeout: played.filter((r) => r.outcome === 'timeout').length,
    extractRate: played.length ? Math.round((extracted.length / played.length) * 100) / 100 : null,
    medianMinHpPct: median(played.map((r) => r.minHpPct)),
    medianRunS: median(played.map((r) => r.runS).filter((x) => x !== null)),
    pageErrors: errors.length,
    tutorialRuns: rows.filter((r) => r.mode === 'ftue').length,
  };
  if (played.length === 0) summary.verdict = 'unmeasured';
  else if (policyName === 'novice') summary.verdict = summary.extractRate < 0.5 ? 'too-hard' : summary.medianMinHpPct >= 50 ? 'too-easy' : 'on-target';
  else summary.verdict = extracted.length === played.length && extracted.every((r) => r.minHpPct >= 50) ? 'too-easy' : 'on-target';
  return { slug, policy: policyName, family, seconds, startedAt: new Date().toISOString(), honest: { refills: false, invulnerability: false, clockJumps: false }, summary, rows, errors: errors.slice(0, 20) };
}

async function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      args._.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
    else {
      args[a.slice(2)] = next;
      i += 1;
    }
  }
  const slug = args._[0];
  if (!slug || !args.url) {
    console.error('usage: node scripts/live-bot.mjs <slug> --url <previewUrl> --policy novice|veteran [--runs 3] [--seconds 480] [--endpoint http://127.0.0.1:9222] [--fresh] [--family arena] [--out <file>] [--shots <dir>]');
    process.exitCode = 2;
    return;
  }
  const policy = args.policy ?? 'novice';
  const host = await openCdpTab({ endpoint: args.endpoint ?? undefined, url: args.url, viewport: { width: 540, height: 960, scale: 1 } });
  let report;
  try {
    report = await runLiveBot({
      tab: host.tab,
      page: host.page,
      slug,
      policy,
      runs: Number(args.runs ?? 3),
      seconds: Number(args.seconds ?? 480),
      family: args.family ?? 'arena',
      fresh: args.fresh === true,
      shotsDir: typeof args.shots === 'string' ? path.resolve(args.shots) : null,
      logger: (m) => console.log(m),
    });
  } finally {
    await host.close();
  }
  const out = typeof args.out === 'string' ? path.resolve(args.out) : path.join(ROOT, 'games', slug, `live-bot-${policy}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ policy, ...report.summary, report: out }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
