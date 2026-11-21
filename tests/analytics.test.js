'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

/* ---------- Unit tests: cost waterfall ---------- */

test('AN 01: costWaterfall reconstructs the landed total in exact integer cents', () => {
  for (const sc of E.SCENARIOS) {
    const solved = E.solveCart(sc.id);
    assert.equal(solved.feasible, true);
    const wf = E.costWaterfall(solved.recommended);
    assert.equal(wf.ok, true);
    assert.equal(wf.reconstructedCents, wf.totalCents);
    assert.equal(wf.totalCents, solved.recommended.totalLandedCents);
    assert.equal(wf.stages.length, 5);
  }
});

test('AN 02: waterfall stages match the solution fields and sum with a negative discount', () => {
  const solved = E.solveCart(E.SCENARIOS[0].id);
  const rec = solved.recommended;
  const wf = E.costWaterfall(rec);
  const byKey = Object.fromEntries(wf.stages.map((s) => [s.key, s]));
  assert.equal(byKey.ITEMS.cents, rec.totalItemSubtotalCents);
  assert.equal(byKey.BUNDLE_DISCOUNT.cents, -rec.totalBundleDiscountCents);
  assert.equal(byKey.SHIPPING.cents, rec.totalShippingCents);
  assert.equal(byKey.HANDLING.cents, rec.totalHandlingCents);
  assert.equal(byKey.TAX.cents, rec.totalTaxCents);
  assert.ok(byKey.BUNDLE_DISCOUNT.sign === -1);
  const sum = wf.stages.reduce((a, s) => a + s.cents, 0);
  assert.equal(sum, rec.totalLandedCents);
});

test('AN 03: waterfall running balance follows the additive order and shares are sane', () => {
  const wf = E.costWaterfall(E.solveCart(E.SCENARIOS[0].id).recommended);
  wf.stages.forEach((s, i) => {
    assert.ok(Number.isFinite(s.runningCents));
    assert.ok(s.shareOfLanded >= 0 && s.shareOfLanded <= 1.5);
    if (i > 0) assert.equal(s.runningCents, wf.stages[i - 1].runningCents + s.cents);
  });
});

test('AN 04: costWaterfall rejects infeasible or missing solutions', () => {
  assert.equal(E.costWaterfall(null).ok, false);
  assert.equal(E.costWaterfall({ feasible: false }).ok, false);
  assert.deepEqual(E.costWaterfall(undefined).stages, []);
});

/* ---------- Unit tests: budget sensitivity curve ---------- */

test('AN 05: sensitivity curve returns requested steps within a 70 to 130 percent sweep', () => {
  const sc = E.SCENARIOS[0];
  const curve = E.budgetSensitivityCurve(sc.id, {}, 9);
  assert.equal(curve.ok, true);
  assert.equal(curve.points.length, 9);
  assert.equal(curve.lowCents, Math.floor(sc.defaultBudgetCents * 0.70));
  assert.equal(curve.highCents, Math.ceil(sc.defaultBudgetCents * 1.30));
  for (let i = 1; i < curve.points.length; i++) {
    assert.ok(curve.points[i].budgetCents > curve.points[i - 1].budgetCents);
  }
});

test('AN 06: sensitivity feasibility is monotone in the budget cap', () => {
  const curve = E.budgetSensitivityCurve(E.SCENARIOS[0].id, {}, 16);
  let seenFeasible = false;
  for (const p of curve.points) {
    if (p.feasible) seenFeasible = true;
    if (seenFeasible) assert.equal(p.feasible, true, 'once feasible at a cap, higher caps stay feasible');
    assert.ok(p.feasibleCount >= 0);
    assert.ok(p.nodesExplored > 0);
  }
});

test('AN 07: the minimum sampled cost equals the minimum recommended cost over feasible points', () => {
  const curve = E.budgetSensitivityCurve(E.SCENARIOS[0].id, {}, 12);
  const costs = curve.points.filter((p) => p.recommendedCostCents !== null).map((p) => p.recommendedCostCents);
  if (costs.length) assert.equal(curve.minimumSampledCostCents, Math.min.apply(null, costs));
  else assert.equal(curve.minimumSampledCostCents, null);
});

test('AN 08: sensitivity curve clamps invalid step counts to a safe default', () => {
  const a = E.budgetSensitivityCurve(E.SCENARIOS[0].id, {}, 1);
  const b = E.budgetSensitivityCurve(E.SCENARIOS[0].id, {}, 0);
  assert.equal(a.steps, 12);
  assert.equal(b.steps, 12);
  assert.equal(a.points.length, 12);
});

/* ---------- Unit tests: Pareto crowding distance ---------- */

test('AN 09: crowding distance marks both extremes of each objective as boundaries', () => {
  const frontier = E.solveCart(E.SCENARIOS[0].id).paretoFrontier;
  const scores = E.paretoCrowdingDistance(frontier);
  assert.equal(scores.length, frontier.length);
  const boundaries = scores.filter((s) => !Number.isFinite(s.crowdingDistance));
  assert.ok(boundaries.length >= 2, 'at least two boundary solutions');
  for (const s of scores) assert.ok(typeof s.signature === 'string');
});

test('AN 10: crowding distance handles empty, singleton and two point frontiers', () => {
  assert.deepEqual(E.paretoCrowdingDistance([]), []);
  assert.deepEqual(E.paretoCrowdingDistance(null), []);
  const one = E.paretoCrowdingDistance([{ signature: 'a', totalLandedCents: 1, maxDeliveryHours: 1, shipmentCount: 1, jointReliability: 0.9 }]);
  assert.equal(one.length, 1);
  assert.equal(one[0].crowdingDistance, Infinity);
  const two = E.paretoCrowdingDistance([
    { signature: 'a', totalLandedCents: 1, maxDeliveryHours: 1, shipmentCount: 1, jointReliability: 0.9 },
    { signature: 'b', totalLandedCents: 2, maxDeliveryHours: 2, shipmentCount: 2, jointReliability: 0.8 }
  ]);
  assert.equal(two.length, 2);
});

test('AN 11: crowding distance is finite and positive for strictly interior points', () => {
  const scores = E.paretoCrowdingDistance(E.solveCart(E.SCENARIOS[1].id).paretoFrontier);
  const interior = scores.filter((s) => Number.isFinite(s.crowdingDistance));
  for (const s of interior) assert.ok(s.crowdingDistance >= 0);
});

/* ---------- Unit tests: solver diagnostics ---------- */

test('AN 12: diagnostics report consistent prune, compression and savings rates', () => {
  const solved = E.solveCart(E.SCENARIOS[0].id);
  const d = E.solverDiagnostics(solved);
  assert.equal(d.ok, true);
  assert.equal(d.nodesExplored, solved.nodesExplored);
  assert.equal(d.feasibleCount, solved.totalFeasibleCount);
  assert.equal(d.frontierSize, solved.paretoFrontier.length);
  assert.ok(d.pruneRatio >= 0 && d.pruneRatio <= 1);
  assert.ok(d.dominanceCompressionRatio >= 0 && d.dominanceCompressionRatio <= 1);
  assert.equal(d.frontierCrowding.length, solved.paretoFrontier.length);
  assert.ok(d.recommended);
  assert.ok(d.recommended.savingsVsGreedyRate >= 0);
});

test('AN 13: diagnostics handle an infeasible solver result without throwing', () => {
  const infeasible = E.solveCart(E.SCENARIOS[0].id, { budgetCents: 1 });
  assert.equal(infeasible.feasible, false);
  const d = E.solverDiagnostics(infeasible);
  assert.equal(d.ok, true);
  assert.equal(d.feasibleCount, 0);
  assert.equal(d.frontierSize, 0);
  assert.equal(d.recommended, null);
});

test('AN 14: diagnostics reject malformed solver results', () => {
  assert.equal(E.solverDiagnostics(null).ok, false);
  assert.equal(E.solverDiagnostics({}).ok, false);
});

/* ---------- Regression: exhaustive saga stress test ---------- */

test('AN 15: scenarioStressTest verifies every fault type on every allocated merchant for all scenarios', () => {
  for (const sc of E.SCENARIOS) {
    const stress = E.scenarioStressTest(sc.id);
    assert.equal(stress.ok, true, sc.id + ' stress failed');
    assert.equal(stress.faultTypeCount, Object.keys(E.FAULT_CATALOG).length);
    assert.ok(stress.merchantCount >= 1);
    // NONE ignores the target merchant, so it runs once instead of per merchant
    assert.equal(stress.caseCount, (stress.faultTypeCount - 1) * stress.merchantCount + 1);
    for (const c of stress.cases) {
      assert.equal(c.ok, true, sc.id + ' ' + c.faultType + ' ' + c.merchantId + ': ' + c.reason);
      assert.ok(c.chainSteps > 0);
      assert.ok(c.apiCalls > 0);
    }
  }
});

test('AN 16: scenarioStressTest returns a clean miss when no solution exists', () => {
  const stress = E.scenarioStressTest(E.SCENARIOS[0].id, { budgetCents: 1 });
  assert.equal(stress.ok, false);
  assert.equal(stress.reason, 'NO_RECOMMENDED_SOLUTION');
  assert.deepEqual(stress.cases, []);
});

test('AN 17: stress test under a tight reliability floor still yields verified chains', () => {
  const stress = E.scenarioStressTest(E.SCENARIOS[0].id, { minReliability: 0.98 });
  if (stress.ok === false && stress.reason === 'NO_RECOMMENDED_SOLUTION') return;
  assert.equal(stress.ok, true);
  for (const c of stress.cases) assert.equal(c.ok, true);
});

/* ---------- Invariant tests: cross checking new analytics against the solver ---------- */

test('AN 18: waterfall, diagnostics and crowding agree on the same solved scenario', () => {
  for (const sc of E.SCENARIOS) {
    const solved = E.solveCart(sc.id);
    const wf = E.costWaterfall(solved.recommended);
    const d = E.solverDiagnostics(solved);
    const cd = E.paretoCrowdingDistance(solved.paretoFrontier);
    assert.equal(wf.totalCents, solved.recommended.totalLandedCents);
    assert.equal(d.recommended.totalLandedCents, solved.recommended.totalLandedCents);
    assert.equal(cd.length, solved.paretoFrontier.length);
    assert.equal(d.frontierCrowding.length, cd.length);
  }
});

test('AN 19: sensitivity recommended costs never exceed their own budget cap', () => {
  const curve = E.budgetSensitivityCurve(E.SCENARIOS[2].id, {}, 14);
  for (const p of curve.points) {
    if (p.recommendedCostCents !== null) {
      assert.ok(p.recommendedCostCents <= p.budgetCents, 'chosen plan must respect its cap');
    }
  }
});

test('AN 20: exported analytics functions are all callable and pure across repeated calls', () => {
  for (const name of ['costWaterfall', 'budgetSensitivityCurve', 'paretoCrowdingDistance', 'solverDiagnostics', 'scenarioStressTest']) {
    assert.equal(typeof E[name], 'function', name + ' must be exported');
  }
  const a = E.solverDiagnostics(E.solveCart(E.SCENARIOS[0].id));
  const b = E.solverDiagnostics(E.solveCart(E.SCENARIOS[0].id));
  assert.deepEqual(a, b, 'deterministic diagnostics');
  const c1 = E.budgetSensitivityCurve(E.SCENARIOS[0].id, {}, 7);
  const c2 = E.budgetSensitivityCurve(E.SCENARIOS[0].id, {}, 7);
  assert.deepEqual(c1, c2, 'deterministic sensitivity curve');
});

test('Waterfall rejects missing, fractional and nonfinite cent fields', () => {
  const good = E.solveCart(E.SCENARIOS[0].id).recommended;
  for (const value of [undefined, NaN, Infinity, -1, 0.5]) {
    assert.equal(E.costWaterfall({ ...good, totalTaxCents: value }).ok, false);
  }
});

test('Sensitivity recomputation count has a fixed upper bound', () => {
  const sweep = E.budgetSensitivityCurve(E.SCENARIOS[0].id, {}, 1000000);
  assert.equal(sweep.steps, 64);
  assert.equal(sweep.points.length, 64);
});

test('Constant objectives add no arbitrary crowding boundaries', () => {
  const points = ['a', 'b', 'c'].map((signature) => ({ signature,
    totalLandedCents: 1, maxDeliveryHours: 1, shipmentCount: 1, jointReliability: 1 }));
  assert.deepEqual(E.paretoCrowdingDistance(points).map((p) => p.crowdingDistance), [0, 0, 0]);
  assert.equal(E.paretoCrowdingDistance(points.slice(0, 1))[0].crowdingDistance, Infinity);
  assert.ok(E.paretoCrowdingDistance(points.slice(0, 2)).every((p) => p.crowdingDistance === Infinity));
});

test('Unavailable baselines produce no invented savings rate', () => {
  const solved = E.solveCart(E.SCENARIOS[0].id);
  const d = E.solverDiagnostics({ ...solved, baselines: {
    greedyUnbundled: { feasible: false }, singleMerchant: null } });
  assert.equal(d.recommended.savingsVsGreedyRate, null);
  assert.equal(d.recommended.savingsVsSingleMerchantRate, null);
});

test('Sensitivity rejects unsafe or nonfinite budget caps instead of sampling invented caps', () => {
  for (const budgetCents of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
    const result = E.budgetSensitivityCurve(E.SCENARIOS[0].id, { budgetCents }, 4);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'INVALID_BUDGET_CAP');
    assert.deepEqual(result.points, []);
  }
});

test('Waterfall rejects a reconstruction outside the safe integer range', () => {
  const solution = { feasible: true, totalLandedCents: Number.MAX_SAFE_INTEGER,
    totalItemSubtotalCents: Number.MAX_SAFE_INTEGER, totalBundleDiscountCents: 0,
    totalShippingCents: 1, totalHandlingCents: 0, totalTaxCents: 0 };
  assert.equal(E.costWaterfall(solution).reason, 'UNSAFE_RECONSTRUCTION');
});
