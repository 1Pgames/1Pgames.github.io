// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/sidegen.selftest.ts
import assert from 'node:assert/strict';
import {
  CUTS,
  arcHeight,
  coinReachable,
  generateLevel,
  hopReach,
  jumpEnvelope,
  planHop,
  planSpikeHop,
  platformRight,
  validateLevel,
  type SideKnobs,
  type SidePlatform,
} from '../../slices/side/gen';
import { SIDE_TUNING } from '../../slices/side/tuning';
import { SIDE_LEVEL_KNOBS, buildSideLevel } from '../../slices/side/levels';

const geo = SIDE_TUNING.geometry;
const env = jumpEnvelope(SIDE_TUNING.motion);

// --- the envelope formulas the whole generator is built on -------------------
{
  assert.equal(env.maxJumpHeight, 128, 'v^2/2g = 640^2/3200 = 128px apex');
  assert.equal(env.airtimeS, 0.8, '2v/g = 1280/1600 = 0.8s airtime');
  assert.equal(env.maxGap, 208, 's*2v/g = 260*0.8 = 208px flat gap');

  assert.equal(hopReach(env, 0), 208, 'a flat full jump reaches exactly maxGap');
  assert.ok(Math.abs(hopReach(env, env.maxJumpHeight) - 104) < 1e-6, 'a max-height jump lands under its own apex (s*v/g)');
  assert.equal(hopReach(env, env.maxJumpHeight + 1), -1, 'one px above the apex is unreachable');
  assert.ok(hopReach(env, -160) > 208, 'a drop buys air time, so it buys reach');

  // arcHeight and hopReach must agree: at the reach, the arc is back at `rise`.
  for (const rise of [-160, -80, 0, 40, 80, 120]) {
    for (const cut of CUTS) {
      const reach = hopReach(env, rise, cut);
      if (reach <= 0) continue;
      assert.ok(
        Math.abs(arcHeight(env, reach, cut) - rise) < 1e-6,
        `rise ${rise} cut ${cut}: the arc is at the target height when it lands`,
      );
    }
  }

  // A cut jump is strictly shorter and lower than a held one.
  let previousReach = Number.POSITIVE_INFINITY;
  let previousApex = Number.POSITIVE_INFINITY;
  for (const cut of CUTS) {
    const reach = hopReach(env, 0, cut);
    const apex = arcHeight(env, (reach * (cut === Number.POSITIVE_INFINITY ? 0.5 : 0.42)) | 0, cut);
    assert.ok(reach < previousReach, `cut ${cut} shortens the arc (${reach} < ${previousReach})`);
    assert.ok(apex < previousApex, `cut ${cut} lowers the arc`);
    previousReach = reach;
    previousApex = apex;
  }
  assert.ok(hopReach(env, 0, 0.08) >= 140, 'the shortest cut still covers a spike hop');
}

// --- planHop: the landing window is a plain interval intersection ------------
{
  const from: SidePlatform = { x: 0, y: 1000, w: 200, h: 280, ground: true };
  // Flat 100px gap: full jump reaches 208, so takeoff may be 100..? and the
  // window is `reach - gap` clipped by the target width and the margins.
  const to: SidePlatform = { x: 300, y: 1000, w: 200, h: 280, ground: true };
  const plan = planHop(env, from, to, geo);
  assert.ok(plan !== null, 'a 100px flat gap is trivially jumpable');
  assert.equal(plan.gap, 100);
  assert.equal(plan.rise, 0);
  assert.equal(plan.cutAtS, Number.POSITIVE_INFINITY, 'the widest window comes from the longest arc here');
  // takeoff must be in [max(0, 320-208), min(200, 480-208)] = [112, 200] -> 88 wide
  assert.equal(plan.window, 88);
  assert.ok(plan.takeoffX > from.x && plan.takeoffX <= platformRight(from));
  assert.ok(
    plan.takeoffX + plan.reach >= to.x + geo.landMargin && plan.takeoffX + plan.reach <= platformRight(to) - geo.landMargin,
    'the planned takeoff lands safely inside the target',
  );

  // A nearer platform is strictly more forgiving: the same arc has more
  // takeoff positions that still land inside it.
  const nearer: SidePlatform = { x: 260, y: 1000, w: 200, h: 280, ground: true };
  const nearPlan = planHop(env, from, nearer, geo);
  assert.ok(nearPlan !== null && nearPlan.window > plan.window, 'a 60px gap forgives more than a 100px one');
  const unreachableGap: SidePlatform = { x: 460, y: 1000, w: 200, h: 280, ground: true };
  assert.equal(planHop(env, from, unreachableGap, geo), null, 'a 260px flat gap is past the 208px envelope');

  const tooHigh: SidePlatform = { x: 300, y: 1000 - 140, w: 200, h: 40, ground: false };
  assert.equal(planHop(env, from, tooHigh, geo), null, 'a 140px rise is above the 128px apex');

  // A narrow platform far below is only landable with a cut jump.
  const narrowBelow: SidePlatform = { x: 150, y: 1160, w: 120, h: 120, ground: false };
  const cutPlan = planHop(env, from, narrowBelow, geo);
  assert.ok(cutPlan !== null, 'the cut family makes a short drop landable');
  assert.ok(cutPlan.cutAtS !== Number.POSITIVE_INFINITY, 'and it needs a released jump, not a held one');
}

// --- planSpikeHop: clearance is what makes a spike jumpable ------------------
{
  const wide: SidePlatform = { x: 0, y: 1000, w: 400, h: 280, ground: true };
  const spike = { x: 160, y: 960, w: 40, h: 40 };
  const hop = planSpikeHop(env, wide, spike, geo);
  assert.ok(hop !== null, 'a spike mid-platform with 120px clear each side is jumpable');
  assert.ok(hop.takeoffX < spike.x, 'the takeoff is before the spike');
  assert.ok(hop.landingX > spike.x + spike.w, 'and the landing is past it');
  assert.ok(hop.landingX <= platformRight(wide) - geo.landMargin, 'without overshooting the platform');
  assert.ok(arcHeight(env, spike.x - hop.takeoffX, hop.cutAtS) > spike.h, 'the arc clears the near edge');

  const cramped: SidePlatform = { x: 0, y: 1000, w: 160, h: 280, ground: true };
  assert.equal(
    planSpikeHop(env, cramped, { x: 100, y: 960, w: 40, h: 40 }, geo),
    null,
    'a spike with no landing room behind it is a wall, not a hazard',
  );
}

// --- planHop refuses landings the next hazard cannot be jumped from ---------
{
  const from: SidePlatform = { x: 0, y: 1000, w: 200, h: 280, ground: true };
  const to: SidePlatform = { x: 280, y: 1000, w: 400, h: 280, ground: true };
  const spike = { x: 400, y: 960, w: 40, h: 40 };

  const blind = planHop(env, from, to, geo);
  const aware = planHop(env, from, to, geo, from.x, [spike]);
  assert.ok(blind !== null && aware !== null, 'the hop itself is well inside the envelope either way');
  assert.ok(aware.window < blind.window, 'knowing about the hazard costs some of the landing window');

  // The trap zone: past the last x the spike can be cleared from, up to its far
  // edge. A landing in there is a level-design bug, not a player mistake.
  const spikePlan = planSpikeHop(env, to, spike, geo);
  if (spikePlan === null) throw new Error('the spike must be jumpable from somewhere on its platform');
  const latest = spikePlan.latestTakeoffX;
  assert.ok(latest > to.x, 'and the last legal takeoff is on the platform');
  const landing = aware.takeoffX + aware.reach;
  assert.ok(
    landing <= latest || landing > spike.x + spike.w,
    `the planned landing (${landing.toFixed(0)}) must stay out of the trap zone (${latest.toFixed(0)}..${spike.x + spike.w})`,
  );

  // Every takeoff in the planned window is safe, not just its centre.
  for (let takeoffX = aware.takeoffX - aware.window / 2; takeoffX <= aware.takeoffX + aware.window / 2; takeoffX += 2) {
    const lands: number = takeoffX + aware.reach;
    assert.ok(lands <= latest || lands > spike.x + spike.w, `takeoff ${takeoffX.toFixed(0)} lands in the trap zone`);
    assert.ok(
      lands >= to.x + geo.landMargin && lands <= platformRight(to) - geo.landMargin,
      'and stays on the platform',
    );
  }

  // An unjumpable hazard poisons its whole platform up to the spike's far edge.
  const shallow: SidePlatform = { x: 280, y: 1000, w: 200, h: 280, ground: true };
  const wall = { x: 400, y: 960, w: 40, h: 40 };
  assert.equal(planSpikeHop(env, shallow, wall, geo), null, 'no landing room past the spike');
  const poisoned = planHop(env, from, shallow, geo, from.x, [wall]);
  if (poisoned !== null) {
    assert.ok(
      poisoned.takeoffX + poisoned.reach > wall.x + wall.w,
      'the only legal landings are past an unjumpable hazard',
    );
  }
}

// --- coinReachable: only coins on some arc count ----------------------------
{
  const platforms: SidePlatform[] = [
    { x: 0, y: 1000, w: 320, h: 280, ground: true },
    { x: 420, y: 1000, w: 320, h: 280, ground: true },
  ];
  assert.ok(coinReachable(env, { x: 200, y: 1000 - 40 }, platforms, geo), 'a low coin over the surface is run-through');
  assert.ok(coinReachable(env, { x: 370, y: 1000 - 120 }, platforms, geo), 'a coin near the gap apex is on the arc');
  assert.equal(
    coinReachable(env, { x: 370, y: 1000 - 320 }, platforms, geo),
    false,
    'a coin 320px up is above every arc',
  );
  assert.equal(
    coinReachable(env, { x: 20, y: 1000 - 200 }, platforms, geo),
    false,
    'a coin higher than the apex right at the level start has no run-up',
  );
}

// --- the shipped ladder: 100 seeds x 8 levels ------------------------------
{
  const seeds = 100;
  const riseCapPx = 0.75 * env.maxJumpHeight;
  // The per-hop budget is 0.8 of the RISE-AWARE reach, and a drop reaches
  // further than a flat jump, so the absolute widest legal gap is 0.8 of the
  // reach at the deepest authored drop — not 0.8 of `maxGap`.
  const gapCapPx = 0.8 * hopReach(env, -geo.maxDrop);

  let relaxedLevels = 0;
  let attemptsTotal = 0;
  const perLevel = SIDE_LEVEL_KNOBS.map(() => ({
    gap: 0,
    rise: 0,
    window: Number.POSITIVE_INFINITY,
    spikes: 0,
    coins: 0,
    platforms: 0,
  }));

  for (let s = 0; s < seeds; s += 1) {
    const seed = `sidegen-${s}`;
    for (let index = 0; index < SIDE_LEVEL_KNOBS.length; index += 1) {
      const level = buildSideLevel(index, seed);
      const check = validateLevel(level, env, geo);
      assert.ok(check.ok, `${seed} L${index + 1}: validator rejected the shipped level (${check.reason})`);

      // Envelope discipline: the generator promises 0.8 of the rise-aware
      // reach and 0.75 of the apex, and the 40px grid can only make that
      // stricter — never looser.
      assert.ok(check.maxGap <= gapCapPx, `${seed} L${index + 1}: gap ${check.maxGap} over the widest legal budget`);
      assert.ok(check.maxRise <= riseCapPx, `${seed} L${index + 1}: rise ${check.maxRise} over the 0.75*apex budget`);
      assert.ok(check.minWindow >= geo.minLandingWindow, `${seed} L${index + 1}: unplayable landing window`);
      assert.ok(check.hops >= 8, `${seed} L${index + 1}: a level is a chain of hops, got ${check.hops}`);

      // Every hop is individually inside the envelope (the chain, not a total).
      for (let i = 1; i < level.platforms.length; i += 1) {
        const previous = level.platforms[i - 1]!;
        const platform = level.platforms[i]!;
        const gap = platform.x % geo.grid;
        assert.equal(gap, 0, `${seed} L${index + 1}: platform ${i} is off the 40px grid`);
        assert.equal(platform.y % geo.grid, 0, `${seed} L${index + 1}: surface ${i} is off the 40px grid`);
        const rise = previous.y - platform.y;
        const reach = hopReach(env, rise);
        assert.ok(reach > 0, `${seed} L${index + 1}: hop ${i} rise ${rise} is off-envelope`);
        assert.ok(
          platform.x - platformRight(previous) <= 0.8 * reach + 1e-9,
          `${seed} L${index + 1}: hop ${i} spends more than 0.8 of its rise-aware reach`,
        );
      }

      // Exit + coins.
      const last = level.platforms[level.platforms.length - 1]!;
      assert.ok(level.exit.x >= last.x && level.exit.x <= platformRight(last), `${seed} L${index + 1}: exit off the pad`);
      assert.equal(level.exit.y, last.y, `${seed} L${index + 1}: exit must sit on the surface`);
      assert.ok(level.coins.length >= 8, `${seed} L${index + 1}: only ${level.coins.length} coins`);
      assert.ok(level.coins.length <= 14, `${seed} L${index + 1}: ${level.coins.length} coins is past the design band`);
      assert.equal(check.coins, level.coins.length, `${seed} L${index + 1}: every coin must be provably reachable`);
      assert.ok(level.worldWidth === geo.worldWidth && platformRight(last) >= geo.worldWidth - geo.endPad);

      const stats = perLevel[index]!;
      stats.gap += check.maxGap;
      stats.rise += check.maxRise;
      stats.window = Math.min(stats.window, check.minWindow);
      stats.spikes += level.spikes.length;
      stats.coins += level.coins.length;
      stats.platforms += level.platforms.length;
      attemptsTotal += level.attempts;
      if (level.relaxed) relaxedLevels += 1;
    }
  }

  const total = seeds * SIDE_LEVEL_KNOBS.length;
  assert.ok(relaxedLevels === 0, `the shipped knobs must place without relaxation, ${relaxedLevels}/${total} relaxed`);
  assert.ok(attemptsTotal / total < 1.5, `generator retries should be rare, averaged ${(attemptsTotal / total).toFixed(2)}`);

  // Difficulty knobs are monotone, and so is what they produce: wider gaps,
  // more spikes, tighter landing windows as the ladder climbs.
  for (let i = 1; i < SIDE_LEVEL_KNOBS.length; i += 1) {
    const previous = SIDE_LEVEL_KNOBS[i - 1]!;
    const knobs: SideKnobs = SIDE_LEVEL_KNOBS[i]!;
    assert.ok(knobs.gapRatio > previous.gapRatio, `L${i + 1}: gapRatio must rise`);
    assert.ok(knobs.riseRatio >= previous.riseRatio, `L${i + 1}: riseRatio must not fall`);
    assert.ok(knobs.widthRatio < previous.widthRatio, `L${i + 1}: platforms must not get roomier`);
    assert.ok(knobs.spikeDensity > previous.spikeDensity, `L${i + 1}: spikeDensity must rise`);
    assert.ok(knobs.coins >= previous.coins, `L${i + 1}: coin payout must not fall`);
    assert.ok(knobs.gapRatio <= 0.8 && knobs.riseRatio <= 0.75, `L${i + 1}: knob past the envelope cap`);
    assert.ok(knobs.widthRatio > 0 && knobs.widthRatio <= 1, `L${i + 1}: widthRatio is a share of the width band`);

    const before = perLevel[i - 1]!;
    const now = perLevel[i]!;
    assert.ok(now.gap >= before.gap, `L${i + 1}: mean widest gap must not shrink (${now.gap} vs ${before.gap})`);
    assert.ok(now.spikes >= before.spikes, `L${i + 1}: mean spike count must not shrink`);
    assert.ok(now.window <= before.window, `L${i + 1}: the tightest landing window must not widen`);
  }
  const easiest = perLevel[0]!;
  const hardest = perLevel[SIDE_LEVEL_KNOBS.length - 1]!;
  assert.ok(hardest.gap > easiest.gap * 1.3, 'L8 gaps must be meaningfully wider than L1 gaps');
  assert.ok(hardest.window < easiest.window * 0.6, 'L8 landing windows must be meaningfully tighter than L1');
  assert.ok(easiest.spikes === 0, 'L1 must be spike-free');
}

// --- determinism -----------------------------------------------------------
{
  const a = buildSideLevel(4, 'determinism');
  const b = buildSideLevel(4, 'determinism');
  assert.deepEqual(a, b, 'the same (seed, index) always yields the identical level');
  const c = buildSideLevel(4, 'determinism-other');
  assert.notDeepEqual(a.platforms, c.platforms, 'a different seed yields a different level');
}

// --- relaxation is a real safety net, not dead code ------------------------
{
  // Knobs no random roll can satisfy directly (a 1-cell gap budget with the
  // shipped platform widths): the generator must still hand back a valid level.
  const brutal: SideKnobs = { gapRatio: 0.001, riseRatio: 0.75, widthRatio: 0.2, spikeDensity: 0.9, coins: 14 };
  const level = generateLevel(7, brutal, geo, SIDE_TUNING.motion, 'relax-me', 3);
  const check = validateLevel(level, env, geo);
  assert.ok(check.ok, `the relaxed fallback must still validate (${check.reason})`);
  assert.ok(level.coins.length >= 8, 'and still pay out at least 8 coins');
}

console.log('sidegen.selftest: ok');
