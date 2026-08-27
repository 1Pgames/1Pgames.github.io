/**
 * Side-view level generation + reachability proof — the headless half of the
 * family C (authored platformer levels) slice. Pure TypeScript, no Phaser
 * import, seeded `Rng` only: `src/sim/families/side.ts` generates and solves
 * the exact same levels `slices/side/game.ts` plays.
 *
 * ---------------------------------------------------------------------------
 * THE JUMP ENVELOPE — the only physics the generator is allowed to assume
 * ---------------------------------------------------------------------------
 * The player auto-runs right at `moveSpeed`, so a jump is a ballistic arc with
 * constant horizontal velocity. With gravity `g`, jump velocity `v` and run
 * speed `s` (defaults g=1600 px/s², v=640 px/s, s=260 px/s):
 *
 *   apex height     h_max = v² / (2g)              = 640²/3200   = 128 px
 *   airtime (flat)  T     = 2v / g                 = 1280/1600   = 0.80 s
 *   flat gap reach  G_max = s · T                  = 260 · 0.80  = 208 px
 *   arc height      h(dx) = v·(dx/s) − g·(dx/s)²/2
 *   reach at rise r R(r)  = s · (v + √(v² − 2·g·r)) / g
 *
 * `R(r)` is the horizontal distance a full jump covers when it ENDS `r` px
 * above the takeoff (`r < 0` is a drop, which buys air time and therefore
 * reach). `R(0) = G_max`, and `R(h_max) = s·v/g = 104 px` — a max-height jump
 * lands directly beneath its own apex. That collapse is why the generator
 * never spends more than 75% of `h_max` on a single rise: the gap budget it
 * would have left is worthless.
 *
 * A released ("cut") jump multiplies the remaining UPWARD velocity by
 * `cutFactor` at the release instant — exactly what the slice's variable jump
 * does on pointer-up. That hands the player a whole family of shorter arcs, so
 * every reachability question here is asked against that family (`CUTS`), not
 * against the full jump alone. Reaches for the shipped numbers, flat landing:
 *
 *   no cut → 208 px  |  cut@0.22s → 179 px  |  cut@0.14s → 161 px  |  cut@0.08s → 144 px
 *
 * Screen-space coordinates throughout: `y` grows DOWN, a platform's `y` is its
 * TOP surface, and a "rise" is positive when the target sits higher (smaller
 * `y`) than the takeoff.
 */

import { Rng } from '../../core/rng';

export interface SideMotion {
  /** px/s² downward. */
  gravity: number;
  /** px/s upward impulse at takeoff. */
  jumpVel: number;
  /** px/s constant auto-run speed. */
  moveSpeed: number;
  /** Upward velocity multiplier when the jump button is released early. */
  cutFactor: number;
}

export interface JumpEnvelope extends SideMotion {
  /** v²/2g — the highest a full jump ever gets above the takeoff. */
  maxJumpHeight: number;
  /** 2v/g — airtime of a jump that lands at takeoff height. */
  airtimeS: number;
  /** s·2v/g — the widest flat gap a full jump can clear. */
  maxGap: number;
}

/** World/grid limits the generator lays platforms out on. */
export interface SideGeometry {
  /** Everything (x, y, widths) snaps to this. */
  grid: number;
  worldWidth: number;
  worldHeight: number;
  /** Surface y of the spawn pad and of every "ground" segment. */
  baseY: number;
  /** Highest / lowest surface a platform may sit at. */
  minTopY: number;
  maxTopY: number;
  /** Platform width band (snapped to `grid`). */
  minWidth: number;
  maxWidth: number;
  /** Thickness of a floating platform; ground segments run to `worldHeight`. */
  floatThickness: number;
  /** Flat run-up before the first gap, and after the last one. */
  startPad: number;
  endPad: number;
  /** Deepest drop the generator will author between two segments. */
  maxDrop: number;
  /** A landing must be this far inside the target platform to count as safe. */
  landMargin: number;
  /** A hop is only "playable" when this many px of takeoff positions work. */
  minLandingWindow: number;
  /** Clear surface a spike needs on BOTH sides (takeoff room + landing room). */
  spikeClearance: number;
  spikeSize: number;
  /** How far above a spike the proving arc must pass. */
  hazardMargin: number;
  /** Pickup radius used by the coin reachability proof. */
  coinRadius: number;
}

/** Per-level difficulty knobs (see `levels.ts` for the shipped ladder). */
export interface SideKnobs {
  /** Share of the rise-aware reach `R(r)` a gap may consume. Design cap: 0.8. */
  gapRatio: number;
  /** Share of `maxJumpHeight` a single rise may consume. Design cap: 0.75. */
  riseRatio: number;
  /**
   * Share of the geometry's platform-width band this level may use, measured
   * from the narrow end: 1 allows the full `minWidth..maxWidth`, 0.25 keeps
   * every platform near `minWidth`. Narrow platforms are the lever that forces
   * released (cut) jumps instead of comfortable held ones, and a mistimed
   * release is where a platformer's difficulty actually lives.
   */
  widthRatio: number;
  /** Probability that a wide enough segment gets a spike. */
  spikeDensity: number;
  /** Coins to place; 8..14, all provably reachable. */
  coins: number;
}

export interface SidePlatform {
  /** Left edge. */
  x: number;
  /** TOP surface. */
  y: number;
  w: number;
  h: number;
  /** Ground segments run to the world floor; floating ones are `floatThickness` thick. */
  ground: boolean;
}

/** Axis-aligned spike block sitting ON a platform surface (`y` = its top). */
export interface SideSpike {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SideCoin {
  x: number;
  y: number;
}

export interface SideLevel {
  id: string;
  index: number;
  worldWidth: number;
  worldHeight: number;
  /** Left-to-right, never overlapping in x. `[0]` is the spawn pad, last holds the exit. */
  platforms: readonly SidePlatform[];
  spikes: readonly SideSpike[];
  coins: readonly SideCoin[];
  spawn: { x: number; y: number };
  /** Door foot, centred on the last platform's surface. */
  exit: { x: number; y: number };
  /** Generator bookkeeping, reported by the sim family. */
  attempts: number;
  relaxed: boolean;
}

/** Release times (s after takeoff) the solver may use, longest arc first. */
export const CUTS: readonly number[] = [Number.POSITIVE_INFINITY, 0.22, 0.14, 0.08];

export function jumpEnvelope(motion: SideMotion): JumpEnvelope {
  const airtimeS = (2 * motion.jumpVel) / motion.gravity;
  return {
    ...motion,
    maxJumpHeight: (motion.jumpVel * motion.jumpVel) / (2 * motion.gravity),
    airtimeS,
    maxGap: motion.moveSpeed * airtimeS,
  };
}

/**
 * Height ABOVE the takeoff after running `dx` px, for a jump released at
 * `cutAtS` (`Infinity` = held all the way). Negative once the arc falls below
 * the takeoff line.
 */
export function arcHeight(env: JumpEnvelope, dx: number, cutAtS: number = Number.POSITIVE_INFINITY): number {
  const t = dx / env.moveSpeed;
  const g = env.gravity;
  if (t <= cutAtS) return env.jumpVel * t - 0.5 * g * t * t;
  const heightAtCut = env.jumpVel * cutAtS - 0.5 * g * cutAtS * cutAtS;
  const velAtCut = env.jumpVel - g * cutAtS;
  // The cut only bites while the player is still rising — releasing on the way
  // down is a no-op, same as the slice's `if (vy < 0)` guard.
  const velAfterCut = velAtCut > 0 ? velAtCut * env.cutFactor : velAtCut;
  const tau = t - cutAtS;
  return heightAtCut + velAfterCut * tau - 0.5 * g * tau * tau;
}

/**
 * Horizontal reach of a jump released at `cutAtS` that ends `rise` px above
 * the takeoff. `-1` when the arc never gets that high (or never comes back
 * down to it).
 */
export function hopReach(env: JumpEnvelope, rise: number, cutAtS: number = Number.POSITIVE_INFINITY): number {
  const g = env.gravity;
  const v = env.jumpVel;
  const discFull = v * v - 2 * g * rise;
  if (discFull < 0) return -1; // apex below the target surface
  const tFull = (v + Math.sqrt(discFull)) / g;
  if (tFull <= cutAtS) return env.moveSpeed * tFull; // landed before the release

  const heightAtCut = v * cutAtS - 0.5 * g * cutAtS * cutAtS;
  const velAtCut = v - g * cutAtS;
  const velAfterCut = velAtCut > 0 ? velAtCut * env.cutFactor : velAtCut;
  const disc = velAfterCut * velAfterCut + 2 * g * (heightAtCut - rise);
  if (disc < 0) return -1; // the cut robbed the arc of the height it needed
  return env.moveSpeed * (cutAtS + (velAfterCut + Math.sqrt(disc)) / g);
}

export function platformRight(platform: SidePlatform): number {
  return platform.x + platform.w;
}

/** One proven hop between two consecutive platforms. */
export interface HopPlan {
  /** Takeoff x at the centre of the safe window — what the sim bot aims at. */
  takeoffX: number;
  cutAtS: number;
  reach: number;
  /** Width of the interval of takeoff x values that still land safely. */
  window: number;
  gap: number;
  rise: number;
}

/** A proven hop over a spike, landing back on the same platform. */
export interface SpikeHopPlan {
  /** Centre of the widest safe takeoff interval — what the sim bot aims at. */
  takeoffX: number;
  cutAtS: number;
  landingX: number;
  /** Width of that interval: how much timing slop the hazard forgives. */
  window: number;
  /** Last x the spike can still be cleared from — a landing past it is a trap. */
  latestTakeoffX: number;
}

/**
 * Proves a spike is jumpable and measures how forgiving it is: for each cut,
 * scan the takeoff positions that pass `hazardMargin` above BOTH spike edges
 * and still land inside the same platform, and keep the widest contiguous run
 * of them. A hazard with no interval is a wall, and this level family has no
 * walls.
 *
 * `minTakeoffX` clips the scan to what is still ahead of the runner (a player
 * who landed late jumps from where they are, not from the platform edge).
 */
export function planSpikeHop(
  env: JumpEnvelope,
  platform: SidePlatform,
  spike: SideSpike,
  geo: SideGeometry,
  minTakeoffX = platform.x,
): SpikeHopPlan | null {
  const surfaceRight = platformRight(platform) - geo.landMargin;
  const clearHeight = spike.h + geo.hazardMargin;
  const lastTakeoff = spike.x - geo.landMargin;
  const step = 4;
  let best: SpikeHopPlan | null = null;
  let latest = -Number.MAX_VALUE;

  for (const cutAtS of CUTS) {
    const reach = hopReach(env, 0, cutAtS);
    if (reach <= 0) continue;
    let runStart: number | null = null;
    // One step past the last legal takeoff so a run that reaches the end is
    // still closed and measured.
    for (let takeoffX = Math.max(platform.x, minTakeoffX); takeoffX <= lastTakeoff + step; takeoffX += step) {
      const landingX = takeoffX + reach;
      const safe =
        takeoffX <= lastTakeoff &&
        landingX >= spike.x + spike.w + geo.landMargin &&
        landingX <= surfaceRight &&
        arcHeight(env, spike.x - takeoffX, cutAtS) > clearHeight &&
        arcHeight(env, spike.x + spike.w - takeoffX, cutAtS) > clearHeight;
      if (safe) {
        if (runStart === null) runStart = takeoffX;
        if (takeoffX > latest) latest = takeoffX;
        continue;
      }
      if (runStart === null) continue;
      const window = takeoffX - step - runStart;
      if (best === null || window > best.window) {
        const takeoff = runStart + window / 2;
        best = { takeoffX: takeoff, cutAtS, landingX: takeoff + reach, window, latestTakeoffX: latest };
      }
      runStart = null;
    }
  }
  if (best !== null) best.latestTakeoffX = latest;
  return best;
}

/** No hazards on the target platform — shared so the common path allocates nothing. */
const NO_HAZARDS: readonly SideSpike[] = [];

/**
 * Widest safe hop from `from` to `to`, across the whole cut family. A takeoff
 * at `x0` lands at `x0 + reach` (the run speed is constant), so the safe
 * interval starts as a plain intersection: the takeoff must still be on
 * `from`, and the landing must be `landMargin` inside `to`.
 *
 * `hazards` are the spikes ON `to`, and they carve holes in that interval. A
 * landing between "the last x the spike can be jumped from" and the spike's
 * far edge is a TRAP: the player arrives correctly and then has no legal jump
 * left, which is a level-design bug rather than a player mistake. Teaching the
 * hop planner about it means the generator, the validator and the sim bot all
 * refuse those landings for the same reason.
 *
 * `minTakeoffX` is where the runner ALREADY is; passing nothing plans the hop
 * for the whole platform, which is the level-design question.
 */
export function planHop(
  env: JumpEnvelope,
  from: SidePlatform,
  to: SidePlatform,
  geo: SideGeometry,
  minTakeoffX = from.x,
  hazards: readonly SideSpike[] = NO_HAZARDS,
): HopPlan | null {
  const gap = to.x - platformRight(from);
  const rise = from.y - to.y;

  // Landing intervals that strand the player, in target-platform x.
  const trapFrom: number[] = [];
  const trapTo: number[] = [];
  for (const spike of hazards) {
    if (spike.x + spike.w <= to.x || spike.x >= platformRight(to)) continue;
    const hop = planSpikeHop(env, to, spike, geo);
    trapFrom.push(hop === null ? to.x - 1 : hop.latestTakeoffX);
    trapTo.push(spike.x + spike.w);
  }

  let best: HopPlan | null = null;
  for (const cutAtS of CUTS) {
    const reach = hopReach(env, rise, cutAtS);
    if (reach <= 0) continue;
    const lo = Math.max(from.x, minTakeoffX, to.x + geo.landMargin - reach);
    const hi = Math.min(platformRight(from), platformRight(to) - geo.landMargin - reach);
    if (hi < lo) continue;

    // Subtract every trap (mapped from landing x back to takeoff x) and keep
    // the widest surviving piece. At most one spike per platform is generated,
    // so this stays a two-piece split in practice.
    let pieces: number[] = [lo, hi];
    for (let t = 0; t < trapFrom.length; t += 1) {
      const cutLo = trapFrom[t]! - reach;
      const cutHi = trapTo[t]! - reach;
      const next: number[] = [];
      for (let p = 0; p < pieces.length; p += 2) {
        const a = pieces[p]!;
        const b = pieces[p + 1]!;
        if (cutHi <= a || cutLo >= b) {
          next.push(a, b);
          continue;
        }
        if (a < cutLo) next.push(a, Math.min(cutLo, b));
        if (b > cutHi) next.push(Math.max(cutHi, a), b);
      }
      pieces = next;
    }

    for (let p = 0; p < pieces.length; p += 2) {
      const window = pieces[p + 1]! - pieces[p]!;
      if (best !== null && window <= best.window) continue;
      best = { takeoffX: (pieces[p]! + pieces[p + 1]!) / 2, cutAtS, reach, window, gap, rise };
    }
  }
  return best;
}

/**
 * True when SOME jump from SOME platform passes within `coinRadius` of the
 * coin. Only platforms at or left of the coin can matter (the player runs
 * right), and only those within one full jump of it, so the scan stays tiny.
 */
export function coinReachable(
  env: JumpEnvelope,
  coin: SideCoin,
  platforms: readonly SidePlatform[],
  geo: SideGeometry,
): boolean {
  for (const platform of platforms) {
    if (platform.x > coin.x) break; // ordered left to right: nothing further can help
    if (platformRight(platform) < coin.x - env.maxGap) continue;
    for (const cutAtS of CUTS) {
      const reach = hopReach(env, 0, cutAtS);
      const from = Math.max(platform.x, coin.x - Math.max(reach, env.maxGap));
      for (let takeoffX = from; takeoffX <= platformRight(platform); takeoffX += 8) {
        const dx = coin.x - takeoffX;
        if (dx < 0) break;
        const y = platform.y - arcHeight(env, dx, cutAtS);
        if (Math.abs(y - coin.y) <= geo.coinRadius) return true;
      }
    }
  }
  return false;
}

/**
 * A level without the generator's bookkeeping — what the validator actually
 * needs, so a draft can be checked before it is stamped with `attempts`.
 */
export type SideLevelShape = Omit<SideLevel, 'attempts' | 'relaxed'>;

/** Spikes sitting on `platform`'s surface. */
export function spikesOn(level: SideLevelShape, platform: SidePlatform): readonly SideSpike[] {
  return level.spikes.filter(
    (spike) => spike.y + spike.h === platform.y && spike.x >= platform.x && spike.x + spike.w <= platformRight(platform),
  );
}

export interface SideValidation {
  ok: boolean;
  /** `'ok'` or the first rule that failed — the generator retries on these. */
  reason: string;
  hops: number;
  /** Widest gap and tallest rise actually authored (envelope discipline audit). */
  maxGap: number;
  maxRise: number;
  /** Narrowest landing window on the critical path: the level's real difficulty. */
  minWindow: number;
  coins: number;
}

/**
 * Greedy hop simulation: walk the platforms left to right and prove every
 * consecutive pair is inside the jump envelope AND lands somewhere the next
 * hazard is still jumpable from, then prove every spike is jumpable, the exit
 * sits on the last platform, and every coin is on some arc. Because the player
 * auto-runs right and platforms never overlap in x, the chain IS the only
 * route — so a chain that holds end to end means the exit is reachable.
 */
export function validateLevel(level: SideLevelShape, env: JumpEnvelope, geo: SideGeometry): SideValidation {
  const fail = (reason: string): SideValidation => ({
    ok: false,
    reason,
    hops: 0,
    maxGap: 0,
    maxRise: 0,
    minWindow: 0,
    coins: 0,
  });

  const platforms = level.platforms;
  if (platforms.length < 2) return fail('too-few-platforms');

  let maxGap = 0;
  let maxRise = 0;
  let minWindow = Number.POSITIVE_INFINITY;
  let hops = 0;

  for (let i = 0; i < platforms.length; i += 1) {
    const platform = platforms[i]!;
    if (platform.w < geo.minWidth) return fail('platform-too-narrow');
    if (platform.y < geo.minTopY || platform.y > geo.maxTopY) return fail('platform-out-of-band');
    if (i === 0) continue;
    const previous = platforms[i - 1]!;
    if (platform.x < platformRight(previous)) return fail('platform-overlap');

    const plan = planHop(env, previous, platform, geo, previous.x, spikesOn(level, platform));
    if (plan === null) return fail('hop-unreachable');
    if (plan.window < geo.minLandingWindow) return fail('hop-window-too-narrow');
    maxGap = Math.max(maxGap, plan.gap);
    maxRise = Math.max(maxRise, plan.rise);
    minWindow = Math.min(minWindow, plan.window);
    hops += 1;
  }

  for (const spike of level.spikes) {
    const host = platforms.find((p) => spike.x >= p.x && spike.x + spike.w <= platformRight(p));
    if (host === undefined) return fail('spike-off-platform');
    if (spike.y + spike.h !== host.y) return fail('spike-not-on-surface');
    if (spike.x - host.x < geo.spikeClearance) return fail('spike-clearance-left');
    if (platformRight(host) - (spike.x + spike.w) < geo.spikeClearance) return fail('spike-clearance-right');
    const hop = planSpikeHop(env, host, spike, geo);
    if (hop === null) return fail('spike-unjumpable');
    if (hop.window < geo.minLandingWindow) return fail('spike-window-too-narrow');
  }

  const last = platforms[platforms.length - 1]!;
  if (level.exit.x < last.x || level.exit.x > platformRight(last)) return fail('exit-off-platform');
  if (level.exit.y !== last.y) return fail('exit-not-on-surface');

  const first = platforms[0]!;
  if (level.spawn.x < first.x || level.spawn.x > platformRight(first)) return fail('spawn-off-platform');

  for (const coin of level.coins) {
    if (!coinReachable(env, coin, platforms, geo)) return fail('coin-unreachable');
  }

  return {
    ok: true,
    reason: 'ok',
    hops,
    maxGap,
    maxRise,
    minWindow: minWindow === Number.POSITIVE_INFINITY ? 0 : minWindow,
    coins: level.coins.length,
  };
}

/** Knob profile the generator falls back to when the authored one keeps failing. */
function relaxKnobs(knobs: SideKnobs): SideKnobs {
  return {
    gapRatio: Math.min(knobs.gapRatio, 0.4),
    riseRatio: Math.min(knobs.riseRatio, 0.3),
    widthRatio: 1,
    spikeDensity: knobs.spikeDensity * 0.5,
    coins: Math.max(8, Math.min(knobs.coins, 10)),
  };
}

/**
 * Generates level `index` for `seed`, retrying until the validator signs it
 * off. Every draft is built inside the envelope by construction, so a retry
 * only happens when the dice produce something *unplayable* rather than
 * impossible (a too-narrow landing window, or too few coin sites). After
 * `maxAttempts` the knobs are relaxed — wider platforms, shorter gaps — which
 * always places, so a level is never missing.
 */
export function generateLevel(
  index: number,
  knobs: SideKnobs,
  geo: SideGeometry,
  motion: SideMotion,
  seed: string,
  maxAttempts = 20,
): SideLevel {
  const env = jumpEnvelope(motion);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const draft = buildDraft(index, knobs, geo, env, new Rng(`${seed}:side:${index}:${attempt}`));
    if (draft !== null && validateLevel(draft, env, geo).ok) {
      return { ...draft, attempts: attempt, relaxed: false };
    }
  }

  const relaxed = relaxKnobs(knobs);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const draft = buildDraft(index, relaxed, geo, env, new Rng(`${seed}:side:${index}:relaxed:${attempt}`));
    if (draft !== null && validateLevel(draft, env, geo).ok) {
      return { ...draft, attempts: maxAttempts + attempt, relaxed: true };
    }
  }
  throw new Error(`side gen: level ${index} unplaceable even relaxed (seed ${seed})`);
}

/** One randomised attempt. Returns null the moment a placement rule cannot be met. */
function buildDraft(
  index: number,
  knobs: SideKnobs,
  geo: SideGeometry,
  env: JumpEnvelope,
  rng: Rng,
): SideLevelShape | null {
  const grid = geo.grid;
  const snapDown = (value: number): number => Math.floor(value / grid) * grid;
  const platforms: SidePlatform[] = [];
  const spikes: SideSpike[] = [];

  const makePlatform = (x: number, y: number, w: number): SidePlatform => {
    const ground = y >= geo.baseY;
    return { x, y, w, h: ground ? geo.worldHeight - y : geo.floatThickness, ground };
  };

  // Spawn pad: always ground, always flat, wide enough for a calm start.
  platforms.push(makePlatform(0, geo.baseY, geo.startPad));
  let cursor = geo.startPad;
  let surfaceY = geo.baseY;

  // The 40px grid quantises rises hard: 0.75 of the 128px apex is 96px, which
  // snaps to two cells, and anything under 0.3125 snaps to zero. A level that
  // can never climb would drift to the bottom of the band and flatten out, so
  // the cap floors at one cell and `riseRatio` also drives HOW OFTEN a step
  // rises (see `pickRise`) — that is what keeps the ladder monotone through
  // the quantisation.
  const riseCap = Math.max(grid, snapDown(knobs.riseRatio * env.maxJumpHeight));
  const minWideForSpike = geo.spikeClearance * 2 + geo.spikeSize;
  // Widest platform this level may cut: late levels keep landings tight, which
  // forces released jumps rather than comfortable held ones.
  const widthCap = Math.max(
    geo.minWidth + grid,
    snapDown(geo.minWidth + (geo.maxWidth - geo.minWidth) * knobs.widthRatio),
  );
  const lastStart = geo.worldWidth - geo.endPad;

  while (cursor < lastStart) {
    const previous = platforms[platforms.length - 1]!;
    let placed = false;

    // A few dice rolls per segment: a rejected roll is a local retry, not a
    // whole-level retry, which is what keeps `attempts` at 1 for most seeds.
    for (let roll = 0; roll < 10 && !placed; roll += 1) {
      const up = Math.min(riseCap, snapDown(surfaceY - geo.minTopY));
      const down = Math.min(geo.maxDrop, snapDown(geo.maxTopY - surfaceY));
      const rise = pickRise(rng, up, down, grid, knobs.riseRatio);
      const targetY = surfaceY - rise;

      const reach = hopReach(env, rise);
      if (reach <= 0) continue;
      // `gapRatio` is a floor as well as a ceiling: the LANDING WINDOW is what
      // a level's difficulty actually is (window = reach - gap), so a high knob
      // has to make gaps CLUSTER near the budget. Drawing uniformly from
      // 1..cap instead would leave every level with the same comfortable
      // average window and a difficulty ladder that does not ramp.
      const gapCap = Math.max(grid, snapDown(knobs.gapRatio * reach));
      const cells = Math.max(1, Math.round(gapCap / grid));
      const gap = grid * rng.int(Math.max(1, Math.round(cells * knobs.gapRatio * 0.9)), cells);

      // The hazard decision comes FIRST, because a fair spike needs
      // `spikeClearance` of run-up and landing room on its own segment while
      // `widthRatio` is busy making ordinary segments tight. Deciding width
      // first would silently delete every late-ladder spike (a 0.22 width band
      // is narrower than a spike platform has to be) and make the hardest
      // levels the safest. So: hazard segments are cut wide, everything else
      // narrows with the knob — which also reads well, alternating hazard
      // arenas with precision platforms.
      const wantSpike = rng.chance(knobs.spikeDensity);
      const width = wantSpike
        ? grid * rng.int(Math.round(minWideForSpike / grid), Math.round(geo.maxWidth / grid))
        : grid * rng.int(Math.round(geo.minWidth / grid), Math.round(widthCap / grid));
      const candidate = makePlatform(cursor + gap, targetY, width);

      // The spike is cut WITH its platform, because the hop onto it has to
      // avoid landing in the hazard's trap zone (see `planHop`). Deciding
      // hazards after the fact would author levels that kill a player who
      // arrived perfectly.
      const spike = wantSpike ? cutSpike(candidate, geo, env, rng, minWideForSpike) : null;
      const plan = planHop(env, previous, candidate, geo, previous.x, spike === null ? NO_HAZARDS : [spike]);
      if (plan === null || plan.window < geo.minLandingWindow) continue;

      platforms.push(candidate);
      if (spike !== null) spikes.push(spike);
      cursor = platformRight(candidate);
      surfaceY = targetY;
      placed = true;
    }

    if (!placed) return null;
  }

  // Exit pad: a flat wide ground segment back at ground level, so the door is
  // never a blind landing.
  let exitPad: SidePlatform | null = null;
  for (let roll = 0; roll < 10 && exitPad === null; roll += 1) {
    const previous = platforms[platforms.length - 1]!;
    const rise = surfaceY - geo.baseY; // > 0 when the pad sits above the last surface
    const reach = hopReach(env, rise);
    if (reach <= 0) continue;
    const gapCap = Math.max(grid, snapDown(Math.min(knobs.gapRatio, 0.6) * reach));
    const gap = grid * rng.int(1, Math.max(1, Math.round(gapCap / grid)));
    const pad = makePlatform(cursor + gap, geo.baseY, geo.endPad);
    const plan = planHop(env, previous, pad, geo);
    if (plan === null || plan.window < geo.minLandingWindow) continue;
    exitPad = pad;
  }
  if (exitPad === null) return null;
  platforms.push(exitPad);

  const coins = placeCoins(platforms, spikes, knobs, geo, env, rng);
  if (coins.length < 8) return null;

  const spawnPad = platforms[0]!;
  return {
    id: `side-${(index + 1).toString().padStart(2, '0')}`,
    index,
    worldWidth: geo.worldWidth,
    worldHeight: geo.worldHeight,
    platforms,
    spikes,
    coins,
    spawn: { x: spawnPad.x + 80, y: spawnPad.y },
    exit: { x: snapDown(exitPad.x + exitPad.w / 2), y: exitPad.y },
  };
}

/**
 * Grid-snapped height step: up (capped by the knob), down (capped by
 * `maxDrop`) or flat, weighted so a level reads as varied terrain rather than
 * a staircase. Positive = the next surface is HIGHER. `riseRatio` buys both
 * bigger AND more frequent climbs, so the ladder still ramps between two
 * levels whose caps quantise to the same number of grid cells.
 */
function pickRise(rng: Rng, up: number, down: number, grid: number, riseRatio: number): number {
  const canRise = up >= grid;
  const canDrop = down >= grid;
  if (!canRise && !canDrop) return 0;
  const roll = rng.next();
  const upChance = 0.15 + riseRatio * 0.35;
  if (canRise && roll < upChance) return grid * rng.int(1, Math.round(up / grid));
  if (canDrop && roll < upChance + 0.32) return -grid * rng.int(1, Math.round(down / grid));
  return 0;
}

/**
 * Places one spike on a freshly cut platform: only segments wide enough to
 * hold `spikeClearance` on both sides can have one, and only hazards the
 * solver can prove a jump over — with enough timing slop to be fair — survive.
 * The `spikeDensity` roll happens at the call site, because it also decides
 * how wide the segment gets cut.
 */
function cutSpike(
  platform: SidePlatform,
  geo: SideGeometry,
  env: JumpEnvelope,
  rng: Rng,
  minWide: number,
): SideSpike | null {
  if (platform.w < minWide) return null;
  const lo = platform.x + geo.spikeClearance;
  const hi = platformRight(platform) - geo.spikeClearance - geo.spikeSize;
  const spike: SideSpike = {
    x: Math.round(rng.float(lo, hi)),
    y: platform.y - geo.spikeSize,
    w: geo.spikeSize,
    h: geo.spikeSize,
  };
  const hop = planSpikeHop(env, platform, spike, geo);
  if (hop === null || hop.window < geo.minLandingWindow) return null;
  return spike;
}

/**
 * Coins are placed ON proven arcs, so they are collectible by construction —
 * `validateLevel` then re-derives that independently. Gap apexes first (the
 * fun ones, they reward the jump the level already demands), then surface
 * coins to top the count up. Nothing is placed over a spike: a coin must never
 * bait the player into a hazard.
 */
function placeCoins(
  platforms: readonly SidePlatform[],
  spikes: readonly SideSpike[],
  knobs: SideKnobs,
  geo: SideGeometry,
  env: JumpEnvelope,
  rng: Rng,
): SideCoin[] {
  const coins: SideCoin[] = [];
  const target = Math.max(8, Math.min(14, knobs.coins));
  const overSpike = (x: number): boolean =>
    spikes.some((spike) => x > spike.x - geo.coinRadius && x < spike.x + spike.w + geo.coinRadius);

  for (let i = 0; i + 1 < platforms.length && coins.length < target; i += 1) {
    const from = platforms[i]!;
    const to = platforms[i + 1]!;
    if (to.x - platformRight(from) < 80) continue;
    const plan = planHop(env, from, to, geo);
    if (plan === null) continue;
    // Sample the planned arc for its apex — cheap, and exact for any cut.
    let apexDx = 0;
    let apexHeight = 0;
    for (let dx = 0; dx <= plan.reach; dx += 4) {
      const height = arcHeight(env, dx, plan.cutAtS);
      if (height > apexHeight) {
        apexHeight = height;
        apexDx = dx;
      }
    }
    if (apexHeight < 24) continue;
    const x = Math.round(plan.takeoffX + apexDx);
    if (overSpike(x)) continue;
    coins.push({ x, y: Math.round(from.y - apexHeight) });
  }

  // Surface coins: low arcs over a platform, offset from both edges so they
  // never hide inside a wall or float over a gap.
  const hostable = platforms.filter((platform) => platform.w >= 160);
  for (let guard = 0; coins.length < target && guard < 240; guard += 1) {
    const platform = hostable[coins.length % Math.max(1, hostable.length)] ?? platforms[0]!;
    const x = Math.round(rng.float(platform.x + 60, platformRight(platform) - 60));
    if (overSpike(x)) continue;
    const height = rng.chance(0.5) ? 40 : Math.round(env.maxJumpHeight * 0.6);
    const coin = { x, y: platform.y - height };
    if (coinReachable(env, coin, platforms, geo)) coins.push(coin);
  }

  return coins;
}
