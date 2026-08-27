// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/hyperstack.selftest.ts
import assert from 'node:assert/strict';
import { createTower, dropSlab, placeSlab, slabSpeed, travelBounds } from '../../slices/hyper/stack';
import type { StackSpec } from '../../slices/hyper/stack';
import { HYPER_TUNING } from '../../slices/hyper/tuning';

const spec: StackSpec = HYPER_TUNING.stack;

// --- dropSlab: exact center is perfect and keeps the whole footprint ---
{
  const hit = dropSlab(360, 400, 360, 400, spec.perfectEpsilon);
  assert.equal(hit.perfect, true, 'dead-center drop is perfect');
  assert.equal(hit.overlapW, 400, 'a perfect drop keeps the full width');
  assert.equal(hit.overlapX, 360, 'a perfect drop snaps to the tower top center');
  assert.equal(hit.trimmed, 0, 'a perfect drop trims nothing');
  assert.equal(hit.trimSide, 0);
  assert.equal(hit.miss, false);

  const edge = dropSlab(360, 400, 360 + spec.perfectEpsilon, 400, spec.perfectEpsilon);
  assert.equal(edge.perfect, true, 'exactly epsilon away still counts as perfect');
  assert.equal(edge.overlapW, 400, 'the epsilon drift is forgiven, not shaved off');
  assert.equal(edge.overlapX, 360, 'perfect snaps back to the tower center');

  const justOff = dropSlab(360, 400, 360 + spec.perfectEpsilon + 1, 400, spec.perfectEpsilon);
  assert.equal(justOff.perfect, false, 'one pixel past epsilon is an ordinary drop');
  assert.equal(justOff.trimmed, spec.perfectEpsilon + 1, 'and it trims exactly the drift');
}

// --- dropSlab: an offset drop trims the overhang and re-centers the top ---
{
  const r = dropSlab(360, 400, 460, 400, spec.perfectEpsilon);
  // top spans 160..560, drop spans 260..660 → overlap 260..560.
  assert.equal(r.overlapW, 300, 'overlap loses exactly the 100px offset');
  assert.equal(r.overlapX, 410, 'new top center is the overlap center');
  assert.equal(r.trimmed, 100, 'the overhang equals the offset');
  assert.equal(r.trimSide, 1, 'a right-side offset drops the overhang to the right');
  assert.equal(r.trimX, 610, 'the overhang piece is centered on its own span (560..660)');
  assert.equal(r.miss, false);
}

// --- dropSlab: mirrored offsets produce mirrored geometry ---
{
  for (const offset of [17, 60, 199, 399]) {
    const right = dropSlab(360, 400, 360 + offset, 400, spec.perfectEpsilon);
    const left = dropSlab(360, 400, 360 - offset, 400, spec.perfectEpsilon);
    assert.equal(left.overlapW, right.overlapW, `offset ${offset}: same surviving width`);
    assert.equal(left.trimmed, right.trimmed, `offset ${offset}: same trim`);
    assert.equal(360 - left.overlapX, right.overlapX - 360, `offset ${offset}: mirrored top center`);
    assert.equal(360 - left.trimX, right.trimX - 360, `offset ${offset}: mirrored overhang center`);
    assert.equal(left.trimSide, -1, `offset ${offset}: left overhang`);
    assert.equal(right.trimSide, 1, `offset ${offset}: right overhang`);
  }
}

// --- dropSlab: beyond the edge is a miss, and touching edge-to-edge is too ---
{
  const grazing = dropSlab(360, 400, 760, 400, spec.perfectEpsilon);
  assert.equal(grazing.overlapW, 0, 'edge-to-edge contact leaves no surviving width');
  assert.equal(grazing.miss, true, 'zero overlap is a miss');
  assert.equal(grazing.trimmed, 400, 'the whole slab falls');

  const beyond = dropSlab(360, 400, 900, 400, spec.perfectEpsilon);
  assert.equal(beyond.miss, true, 'fully past the tower is a miss');
  assert.ok(beyond.overlapW <= 0, 'miss is reported as overlapW <= 0');
  assert.equal(beyond.trimSide, 1, 'missing to the right falls right');
  assert.equal(dropSlab(360, 400, -180, 400, spec.perfectEpsilon).trimSide, -1, 'missing left falls left');
}

// --- dropSlab: a slab wider than the tower top trims both sides ---
{
  const straddle = dropSlab(360, 200, 380, 400, 0);
  // top spans 260..460, drop spans 180..580 → overlap is the whole top.
  assert.equal(straddle.overlapW, 200, 'the overlap can never exceed the tower top');
  assert.equal(straddle.trimmed, 200, 'both overhangs are counted (80 left + 120 right)');
  assert.equal(straddle.trimSide, 1, 'the bigger piece is the right one');
}

// --- placeSlab: width is monotonically non-increasing without perfect drops ---
{
  const tower = createTower(spec, 360);
  assert.equal(tower.width, spec.startWidth);
  let previous = tower.width;
  let drops = 0;
  // Alternate sides by a fixed drift so no drop can ever be perfect.
  for (let i = 0; drops < 40 && tower.alive; i += 1) {
    const drift = (i % 2 === 0 ? 1 : -1) * (spec.perfectEpsilon + 4);
    const result = placeSlab(tower, spec, tower.topX + drift);
    if (!tower.alive) break;
    drops += 1;
    assert.equal(result.perfect, false, 'a drift past epsilon is never perfect');
    assert.ok(tower.width <= previous, `drop ${drops}: width must not grow without a perfect`);
    assert.equal(tower.perfects, 0, 'no perfects were scored');
    assert.equal(tower.height, drops, 'every landed drop adds one row');
    previous = tower.width;
  }
  assert.ok(!tower.alive, 'a constant drift eventually thins the tower below minWidth');
  assert.equal(tower.failure, 'toppled', 'thinning out reports toppled, not missed');
  assert.ok(tower.width < spec.minWidth, 'the run ends once the top is thinner than minWidth');
}

// --- placeSlab: a perfect drop restores the width bonus, capped at startWidth ---
{
  const tower = createTower(spec, 360);
  placeSlab(tower, spec, 360 + 100); // 420 -> 320
  assert.equal(tower.width, 320);
  assert.equal(tower.topX, 410);

  placeSlab(tower, spec, tower.topX); // perfect
  assert.equal(tower.perfects, 1);
  assert.equal(tower.width, 320 + spec.widthBonusOnPerfect, 'a perfect drop hands width back');
  assert.equal(tower.topX, 410, 'a perfect drop leaves the top center untouched');
  assert.equal(tower.height, 2, 'a perfect drop still stacks a row');

  const wide = createTower(spec, 360);
  placeSlab(wide, spec, 360 + 4); // inside epsilon -> perfect at full width
  assert.equal(wide.width, spec.startWidth, 'the bonus is capped at startWidth');
  assert.equal(wide.perfects, 1);
}

// --- placeSlab: a miss ends the run and freezes the tower ---
{
  const tower = createTower(spec, 360);
  tower.width = 60;
  const result = placeSlab(tower, spec, 360 + 200);
  assert.equal(result.miss, true);
  assert.equal(tower.alive, false);
  assert.equal(tower.failure, 'missed');
  assert.equal(tower.height, 0, 'a missed drop does not add a row');
  assert.equal(tower.width, 60, 'the tower geometry is left as it was');

  const ignored = placeSlab(tower, spec, 360);
  assert.equal(tower.height, 0, 'drops after the run ended change nothing');
  assert.equal(ignored.perfect, true, 'the geometry is still reported for the renderer');
}

// --- speed ramp and travel bounds ---
{
  const { baseSpeed, speedPerDifficulty } = HYPER_TUNING;
  assert.equal(slabSpeed(baseSpeed, speedPerDifficulty, 1), 260, 'difficulty 1 is the base speed');
  assert.equal(slabSpeed(baseSpeed, speedPerDifficulty, 2), 350, 'each difficulty point adds 90px/s');
  assert.equal(
    slabSpeed(baseSpeed, speedPerDifficulty, HYPER_TUNING.ramp.maxDifficulty),
    260 + 2.5 * 90,
    'the ramp ceiling caps the slide speed',
  );

  assert.deepEqual(travelBounds(420, 720), { minX: 210, maxX: 510 }, 'a full-width slab barely travels');
  assert.deepEqual(travelBounds(80, 720), { minX: 40, maxX: 680 }, 'a thin slab can travel clear off the tower');
  const wide = travelBounds(420, 720);
  const thin = travelBounds(80, 720);
  assert.ok(thin.maxX - thin.minX > wide.maxX - wide.minX, 'thinner towers get a wider miss window');
}

console.log('hyperstack.selftest: ok');
