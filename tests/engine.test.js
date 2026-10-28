'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../engine.js');

function nodeSha256(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex');
}

test('ENG 01: sha256Hex matches Node crypto on empty, ASCII, UTF-8, and multi-block strings', () => {
  const vectors = [
    '',
    'abc',
    'CartConductor PayPal Orders v2',
    'a'.repeat(55),
    'b'.repeat(56),
    'c'.repeat(64),
    'd'.repeat(128),
    'Currency symbols: € £ ¥ and surrogate pair \uD83D\uDE80'
  ];
  for (const v of vectors) {
    assert.equal(E.sha256Hex(v), nodeSha256(v));
  }
});

test('ENG 02: centsToDollars and formatUsd handle zero, positive, negative, and reject non-numbers', () => {
  assert.equal(E.centsToDollars(0), '0.00');
  assert.equal(E.centsToDollars(5), '0.05');
  assert.equal(E.centsToDollars(12345), '123.45');
  assert.equal(E.centsToDollars(-450), '-4.50');
  assert.equal(E.formatUsd(68000), '$680.00');
  assert.equal(E.formatUsd(-1205), '-$12.05');
  assert.throws(() => E.centsToDollars(NaN), TypeError);
  assert.throws(() => E.centsToDollars(Infinity), TypeError);
  assert.throws(() => E.centsToDollars('100'), TypeError);
});

test('ENG 03: catalog has exactly 8 merchants with valid thresholds, reliability, and PayPal credentials', () => {
  assert.equal(E.MERCHANTS.length, 8);
  const seenIds = new Set();
  for (const m of E.MERCHANTS) {
    assert.ok(!seenIds.has(m.id));
    seenIds.add(m.id);
    assert.match(m.payeeEmail, /^[^@]+@[^@]+\.example\.com$/);
    assert.equal(m.merchantId.length, 13);
    assert.ok(m.reliabilityScore > 0.90 && m.reliabilityScore <= 1.0);
    assert.ok(m.freeShippingThresholdCents >= 10000);
    assert.ok(m.baseShippingCents > 0);
    assert.ok(m.bundleThresholdItems >= 2);
    assert.ok(m.bundleDiscountBps > 0);
    assert.ok(m.taxRateBps > 0);
    assert.ok(m.handlingCents > 0);
  }
});

test('ENG 04: getMerchantById and getScenarioById locate valid records and handle fallbacks', () => {
  const apex = E.getMerchantById('MERCH_APEX');
  assert.equal(apex.name, 'Apex Compute Supply');
  assert.equal(E.getMerchantById('NON_EXISTENT'), null);

  const bio = E.getScenarioById('SCENARIO_BIO_BENCH');
  assert.equal(bio.id, 'SCENARIO_BIO_BENCH');
  const fallback = E.getScenarioById('UNKNOWN_SCENARIO');
  assert.equal(fallback.id, E.SCENARIOS[0].id);
});

test('ENG 05: evaluateAssignment validates inputs and enforces excluded merchants, reliability, stock, and SLA', () => {
  const sc = E.getScenarioById('SCENARIO_ROBOTICS_RIG');
  assert.throws(() => E.evaluateAssignment(null, []), /valid scenario/);
  assert.throws(() => E.evaluateAssignment(sc, ['MERCH_APEX']), /assignment length/);

  // Unknown merchant
  const rUnknown = E.evaluateAssignment(sc, ['MERCH_NONE', 'MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX']);
  assert.equal(rUnknown.feasible, false);
  assert.equal(rUnknown.reason, 'UNKNOWN_MERCHANT');

  // Excluded merchant
  const rExcl = E.evaluateAssignment(sc, ['MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX'], {
    excludedMerchants: ['MERCH_APEX']
  });
  assert.equal(rExcl.feasible, false);
  assert.equal(rExcl.reason, 'EXCLUDED_MERCHANT');

  // Reliability floor violation (MERCH_PULSE has 0.941 < 0.95)
  const rRel = E.evaluateAssignment(sc, ['MERCH_PULSE', 'MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX'], {
    minReliability: 0.95
  });
  assert.equal(rRel.feasible, false);
  assert.equal(rRel.reason, 'RELIABILITY_BELOW_FLOOR');

  // No offer for merchant on item
  const rNoOffer = E.evaluateAssignment(sc, ['MERCH_ZENITH', 'MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX']);
  assert.equal(rNoOffer.feasible, false);
  assert.equal(rNoOffer.reason, 'NO_OFFER');

  // SLA exceeded
  const rSla = E.evaluateAssignment(sc, ['MERCH_NOVA', 'MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX'], {
    maxSlaHours: 24
  });
  assert.equal(rSla.feasible, false);
  assert.equal(rSla.reason, 'SLA_EXCEEDED');
});

test('ENG 06: evaluateAssignment checks stock quantity and budget cap accurately', () => {
  const sc = E.getScenarioById('SCENARIO_ROBOTICS_RIG');
  // Clone scenario and require qty=10 on item 1 where MERCH_NOVA only has stock=2
  const highQtyScenario = Object.assign({}, sc, {
    items: sc.items.map((it, idx) => idx === 1 ? Object.assign({}, it, { qty: 10 }) : it)
  });
  const rStock = E.evaluateAssignment(highQtyScenario, ['MERCH_APEX', 'MERCH_NOVA', 'MERCH_APEX', 'MERCH_APEX']);
  assert.equal(rStock.feasible, false);
  assert.equal(rStock.reason, 'INSUFFICIENT_STOCK');

  // Budget cap exceeded
  const rBudget = E.evaluateAssignment(sc, ['MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX'], {
    budgetCents: 40000
  });
  assert.equal(rBudget.feasible, false);
  assert.equal(rBudget.withinBudget, false);
  assert.equal(rBudget.reason, 'BUDGET_EXCEEDED');
  assert.ok(rBudget.budgetRemainingCents < 0);
});

test('ENG 07: evaluateAssignment computes bundle discount, free shipping threshold, handling, and tax in cents', () => {
  const sc = E.getScenarioById('SCENARIO_ROBOTICS_RIG');
  // Assign all 4 SKUs to MERCH_APEX
  const res = E.evaluateAssignment(sc, ['MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX', 'MERCH_APEX'], {
    budgetCents: 90000,
    maxSlaHours: 48
  });
  assert.equal(res.feasible, true);
  assert.equal(res.shipmentCount, 1);
  const mb = res.merchantBreakdowns[0];
  // Item subtotals at MERCH_APEX: 2*11200 + 1*18900 + 2*7400 + 1*8200 = 22400 + 18900 + 14800 + 8200 = 64300
  assert.equal(mb.itemSubtotalCents, 64300);
  assert.equal(mb.qualifiesBundle, true);
  // 500 bps of 64300 = 3215 cents
  assert.equal(mb.discountCents, 3215);
  assert.equal(mb.netItemsCents, 61085);
  // 61085 >= 22000 free shipping threshold
  assert.equal(mb.qualifiesFreeShipping, true);
  assert.equal(mb.shippingCents, 0);
  assert.equal(mb.handlingCents, 250);
  // Tax 825 bps of 61085 = Math.round(5039.5125) = 5040
  assert.equal(mb.taxCents, 5040);
  assert.equal(mb.unitTotalCents, 61085 + 0 + 250 + 5040);
  assert.equal(res.totalLandedCents, mb.unitTotalCents);
});

test('ENG 08: evaluateAssignment charges base shipping when net items fall below freeShippingThresholdCents', () => {
  const sc = E.getScenarioById('SCENARIO_ROBOTICS_RIG');
  // Split across 4 distinct merchants so none gets a bundle discount and some fall below free shipping threshold
  const res = E.evaluateAssignment(sc, ['MERCH_NOVA', 'MERCH_KINETIC', 'MERCH_VERIDIAN', 'MERCH_ZENITH'], {
    budgetCents: 95000,
    maxSlaHours: 48
  });
  assert.equal(res.feasible, true);
  assert.equal(res.shipmentCount, 4);
  assert.equal(res.totalBundleDiscountCents, 0);
  // MERCH_ZENITH has only 1 unit of SKU-PSU-GAN48V at 7500 (< 24000 threshold), so shippingCents must be 1950
  const zenithUnit = res.merchantBreakdowns.find((m) => m.merchantId === 'MERCH_ZENITH');
  assert.equal(zenithUnit.qualifiesBundle, false);
  assert.equal(zenithUnit.qualifiesFreeShipping, false);
  assert.equal(zenithUnit.shippingCents, 1950);
});

test('ENG 09: dominates accurately compares multi-objective cart metrics', () => {
  const a = { totalLandedCents: 55000, maxDeliveryHours: 24, shipmentCount: 2, jointReliability: 0.98 };
  const b = { totalLandedCents: 56000, maxDeliveryHours: 24, shipmentCount: 2, jointReliability: 0.98 };
  const c = { totalLandedCents: 55000, maxDeliveryHours: 20, shipmentCount: 3, jointReliability: 0.98 };
  assert.equal(E.dominates(a, b), true);
  assert.equal(E.dominates(b, a), false);
  assert.equal(E.dominates(a, a), false);
  // Neither a nor c dominates the other (c is faster, a has fewer shipments)
  assert.equal(E.dominates(a, c), false);
  assert.equal(E.dominates(c, a), false);
});

test('ENG 10: solveCart finds optimal LOWEST_COST, FASTEST_DELIVERY, and FEWEST_SHIPMENTS on SCENARIO_ROBOTICS_RIG', () => {
  const res = E.solveCart('SCENARIO_ROBOTICS_RIG');
  assert.equal(res.feasible, true);
  assert.ok(res.totalFeasibleCount > 10);
  assert.ok(res.paretoFrontier.length >= 2);
  assert.ok(res.branchesPruned > 0);

  const mCost = res.modes.LOWEST_COST;
  const mFast = res.modes.FASTEST_DELIVERY;
  const mShip = res.modes.FEWEST_SHIPMENTS;

  assert.ok(mCost.totalLandedCents <= mFast.totalLandedCents);
  assert.ok(mCost.totalLandedCents <= mShip.totalLandedCents);
  assert.ok(mFast.maxDeliveryHours <= mCost.maxDeliveryHours);
  assert.ok(mFast.maxDeliveryHours <= mShip.maxDeliveryHours);
  assert.ok(mShip.shipmentCount <= mCost.shipmentCount);
  assert.equal(mShip.shipmentCount, 1);

  // Verify savings vs greedy unbundled and single merchant are strictly positive for LOWEST_COST
  assert.ok(res.savingsVsGreedyCents > 0);
  assert.ok(res.savingsVsSingleMerchantCents > 0);
});

test('ENG 11: solveCart produces valid Pareto frontier where no frontier point dominates another', () => {
  for (const sc of E.SCENARIOS) {
    const res = E.solveCart(sc.id);
    assert.equal(res.feasible, true);
    const pf = res.paretoFrontier;
    assert.ok(pf.length >= 1);
    for (let i = 0; i < pf.length; i++) {
      for (let j = 0; j < pf.length; j++) {
        if (i === j) continue;
        assert.equal(E.dominates(pf[i], pf[j]), false);
      }
    }
  }
});

test('ENG 12: solveCart respects strategy selection and returns infeasible cleanly when constraints are impossible', () => {
  const fastRes = E.solveCart('SCENARIO_BIO_BENCH', { strategy: 'FASTEST_DELIVERY' });
  assert.equal(fastRes.selectedMode, 'FASTEST_DELIVERY');
  assert.equal(fastRes.recommended.signature, fastRes.modes.FASTEST_DELIVERY.signature);

  const shipRes = E.solveCart('SCENARIO_RACK_CLUSTER', { strategy: 'FEWEST_SHIPMENTS' });
  assert.equal(shipRes.selectedMode, 'FEWEST_SHIPMENTS');
  assert.equal(shipRes.recommended.signature, shipRes.modes.FEWEST_SHIPMENTS.signature);

  const impossible = E.solveCart('SCENARIO_ROBOTICS_RIG', { budgetCents: 10000, maxSlaHours: 10 });
  assert.equal(impossible.feasible, false);
  assert.equal(impossible.recommended, null);
  assert.equal(impossible.paretoFrontier.length, 0);
});

test('ENG 13: buildPayPalOrderPayload and validatePayPalOrderPayload enforce exact breakdown math and idempotency', () => {
  const solved = E.solveCart('SCENARIO_ROBOTICS_RIG');
  const payload = E.buildPayPalOrderPayload('SCENARIO_ROBOTICS_RIG', solved.recommended);
  const check = E.validatePayPalOrderPayload(payload);

  assert.equal(check.valid, true);
  assert.equal(check.errors.length, 0);
  assert.equal(check.grandTotalCents, solved.recommended.totalLandedCents);
  assert.equal(check.purchaseUnitCount, solved.recommended.shipmentCount);
  assert.match(payload.orderId, /^ORD-PP-[0-9A-F]{12}$/);
  assert.match(payload.headers['PayPal-Request-Id'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);

  // Determinism check: identical inputs produce identical PayPal-Request-Id and Order ID
  const payload2 = E.buildPayPalOrderPayload('SCENARIO_ROBOTICS_RIG', solved.recommended);
  assert.equal(payload.orderId, payload2.orderId);
  assert.equal(payload.headers['PayPal-Request-Id'], payload2.headers['PayPal-Request-Id']);
});

test('ENG 14: validatePayPalOrderPayload detects tampered amounts, missing headers, and duplicate reference_ids', () => {
  assert.equal(E.validatePayPalOrderPayload(null).valid, false);
  const solved = E.solveCart('SCENARIO_ROBOTICS_RIG');
  const payload = E.buildPayPalOrderPayload('SCENARIO_ROBOTICS_RIG', solved.recommended);

  // Tamper with unit value by 1 cent
  const badValue = JSON.parse(JSON.stringify(payload));
  badValue.body.purchase_units[0].amount.value = '999.99';
  const resVal = E.validatePayPalOrderPayload(badValue);
  assert.equal(resVal.valid, false);
  assert.ok(resVal.errors.some((e) => e.includes('Breakdown mismatch')));

  // Tamper with line item unit_amount
  const badLine = JSON.parse(JSON.stringify(payload));
  badLine.body.purchase_units[0].items[0].unit_amount.value = '1.00';
  const resLine = E.validatePayPalOrderPayload(badLine);
  assert.equal(resLine.valid, false);
  assert.ok(resLine.errors.some((e) => e.includes('Line item sum mismatch')));

  // Tamper with headers
  const badHeader = JSON.parse(JSON.stringify(payload));
  badHeader.headers['PayPal-Request-Id'] = 'short';
  assert.equal(E.validatePayPalOrderPayload(badHeader).valid, false);
});

test('ENG 15: simulateSagaExecution executes nominal settlement and builds verified SHA-256 receipt chain', () => {
  const solved = E.solveCart('SCENARIO_ROBOTICS_RIG');
  const saga = E.simulateSagaExecution('SCENARIO_ROBOTICS_RIG', solved, { faultType: 'NONE' });

  assert.equal(saga.sagaStatus, 'SETTLED_NOMINAL');
  assert.equal(saga.faultInjected, false);
  assert.equal(saga.recoverySucceeded, true);
  assert.equal(saga.voidedAuthorizations.length, 0);
  assert.equal(saga.captures.length, solved.recommended.shipmentCount);
  assert.equal(saga.costDeltaCents, 0);

  const chainCheck = E.verifySagaReceiptChain(saga.timeline);
  assert.equal(chainCheck.valid, true);
  assert.equal(chainCheck.headHash, saga.receiptChainHeadHash);
});

test('ENG 16: simulateSagaExecution handles all 4 fault types by voiding failed hold and rerouting within budget', () => {
  const solved = E.solveCart('SCENARIO_ROBOTICS_RIG');
  const faultTypes = [
    'OUT_OF_STOCK_AT_CAPTURE',
    'THREE_DS_CHALLENGE_REQUIRED',
    'SHIPPING_SLA_SLIPPAGE',
    'PARTIAL_FULFILLMENT'
  ];

  for (const ft of faultTypes) {
    const saga = E.simulateSagaExecution('SCENARIO_ROBOTICS_RIG', solved, { faultType: ft });
    assert.equal(saga.sagaStatus, 'RECOVERED_AND_CAPTURED');
    assert.equal(saga.faultInjected, true);
    assert.equal(saga.faultType, ft);
    assert.equal(saga.recoverySucceeded, true);
    assert.ok(saga.voidedAuthorizations.length >= 1);
    assert.ok(saga.captures.length >= 1);
    assert.ok(saga.finalPlan.totalLandedCents <= solved.constraints.budgetCents);
    // Ensure faulted merchant is not in the final captured plan
    assert.ok(!saga.finalPlan.merchantBreakdowns.some((m) => m.merchantId === saga.faultedMerchantId));

    const chainCheck = E.verifySagaReceiptChain(saga.timeline);
    assert.equal(chainCheck.valid, true);
    const repCheck = E.validatePayPalOrderPayload(saga.replacementOrder);
    assert.equal(repCheck.valid, true);
  }
});

test('ENG 17: simulateSagaExecution performs full safe rollback when fallback exceeds tight buyer budget', () => {
  const solved = E.solveCart('SCENARIO_ROBOTICS_RIG');
  const minBudget = solved.modes.LOWEST_COST.totalLandedCents;
  const tightSolved = E.solveCart('SCENARIO_ROBOTICS_RIG', { budgetCents: minBudget });
  assert.equal(tightSolved.feasible, true);

  const saga = E.simulateSagaExecution('SCENARIO_ROBOTICS_RIG', tightSolved, {
    faultType: 'OUT_OF_STOCK_AT_CAPTURE',
    targetMerchantId: tightSolved.recommended.merchantBreakdowns[0].merchantId
  });

  assert.equal(saga.sagaStatus, 'ROLLED_BACK_SAFE');
  assert.equal(saga.recoverySucceeded, false);
  assert.equal(saga.finalPlan, null);
  assert.equal(saga.captures.length, 0);
  // Every initial purchase unit authorization must be voided
  assert.equal(saga.voidedAuthorizations.length, tightSolved.recommended.shipmentCount);
  assert.equal(E.verifySagaReceiptChain(saga.timeline).valid, true);
});

test('ENG 18: verifySagaReceiptChain detects tampering of step detail or prevHash', () => {
  assert.equal(E.verifySagaReceiptChain([]).valid, false);
  const solved = E.solveCart('SCENARIO_BIO_BENCH');
  const saga = E.simulateSagaExecution('SCENARIO_BIO_BENCH', solved, { faultType: 'SHIPPING_SLA_SLIPPAGE' });
  assert.equal(E.verifySagaReceiptChain(saga.timeline).valid, true);

  const tamperedEvent = JSON.parse(JSON.stringify(saga.timeline));
  tamperedEvent[1].detail = 'Tampered amount $0.01';
  const check1 = E.verifySagaReceiptChain(tamperedEvent);
  assert.equal(check1.valid, false);
  assert.match(check1.reason, /^EVENT_HASH_MISMATCH_AT_STEP_2$/);

  const tamperedPrev = JSON.parse(JSON.stringify(saga.timeline));
  tamperedPrev[2].prevHash = 'f'.repeat(64);
  const check2 = E.verifySagaReceiptChain(tamperedPrev);
  assert.equal(check2.valid, false);
  assert.match(check2.reason, /^PREV_HASH_MISMATCH_AT_STEP_3$/);
});

test('ENG 19: computeIdempotencyKey produces distinct deterministic UUID-v4-shaped keys per stage', () => {
  const k1 = E.computeIdempotencyKey('SCENARIO_ROBOTICS_RIG', 'MERCH_APEX|MERCH_APEX', 'AUTHORIZE');
  const k2 = E.computeIdempotencyKey('SCENARIO_ROBOTICS_RIG', 'MERCH_APEX|MERCH_APEX', 'CAPTURE');
  const k3 = E.computeIdempotencyKey('SCENARIO_BIO_BENCH', 'MERCH_APEX|MERCH_APEX', 'AUTHORIZE');
  assert.notEqual(k1, k2);
  assert.notEqual(k1, k3);
  assert.equal(k1, E.computeIdempotencyKey('SCENARIO_ROBOTICS_RIG', 'MERCH_APEX|MERCH_APEX', 'AUTHORIZE'));
});

test('ENG 20: solveCart on SCENARIO_BIO_BENCH finds valid Pareto solutions and positive savings', () => {
  const res = E.solveCart('SCENARIO_BIO_BENCH');
  assert.equal(res.feasible, true);
  assert.ok(res.totalFeasibleCount >= 5);
  assert.ok(res.modes.LOWEST_COST.totalLandedCents <= res.constraints.budgetCents);
  assert.ok(res.modes.FASTEST_DELIVERY.maxDeliveryHours <= res.constraints.maxSlaHours);
  assert.ok(res.savingsVsGreedyCents >= 0);
});

test('ENG 21: solveCart on SCENARIO_RACK_CLUSTER finds valid Pareto solutions and positive savings', () => {
  const res = E.solveCart('SCENARIO_RACK_CLUSTER');
  assert.equal(res.feasible, true);
  assert.ok(res.totalFeasibleCount >= 5);
  assert.ok(res.modes.LOWEST_COST.totalLandedCents <= res.constraints.budgetCents);
  assert.ok(res.modes.FEWEST_SHIPMENTS.shipmentCount >= 1);
});

test('ENG 22: buildPayPalOrderPayload rejects null or infeasible solutions', () => {
  assert.throws(() => E.buildPayPalOrderPayload('SCENARIO_ROBOTICS_RIG', null), /feasible cart solution/);
  assert.throws(() => E.buildPayPalOrderPayload('SCENARIO_ROBOTICS_RIG', { feasible: false }), /feasible cart solution/);
});

test('ENG 23: validatePayPalOrderPayload rejects invalid intent, empty purchase_units, and missing payee', () => {
  const solved = E.solveCart('SCENARIO_ROBOTICS_RIG');
  const base = E.buildPayPalOrderPayload('SCENARIO_ROBOTICS_RIG', solved.recommended);

  const badIntent = JSON.parse(JSON.stringify(base));
  badIntent.body.intent = 'INVALID_INTENT';
  assert.equal(E.validatePayPalOrderPayload(badIntent).valid, false);

  const emptyUnits = JSON.parse(JSON.stringify(base));
  emptyUnits.body.purchase_units = [];
  assert.equal(E.validatePayPalOrderPayload(emptyUnits).valid, false);

  const noPayee = JSON.parse(JSON.stringify(base));
  noPayee.body.purchase_units[0].payee = {};
  assert.equal(E.validatePayPalOrderPayload(noPayee).valid, false);
});

test('ENG 24: validatePayPalOrderPayload detects duplicate reference_id across purchase_units', () => {
  const solved = E.solveCart('SCENARIO_ROBOTICS_RIG', { strategy: 'LOWEST_COST' });
  // Ensure at least 2 purchase units by evaluating a split assignment
  const splitEval = E.evaluateAssignment(
    E.getScenarioById('SCENARIO_ROBOTICS_RIG'),
    ['MERCH_NOVA', 'MERCH_KINETIC', 'MERCH_KINETIC', 'MERCH_NOVA']
  );
  const payload = E.buildPayPalOrderPayload('SCENARIO_ROBOTICS_RIG', splitEval);
  assert.equal(payload.body.purchase_units.length, 2);
  payload.body.purchase_units[1].reference_id = payload.body.purchase_units[0].reference_id;
  const check = E.validatePayPalOrderPayload(payload);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => e.includes('Duplicate or missing reference_id')));
});

test('ENG 25: simulateSagaExecution re-bundles surviving merchant hold when fallback adds SKUs to that merchant', () => {
  const sc = E.getScenarioById('SCENARIO_ROBOTICS_RIG');
  // Create a multi-merchant primary solution where MERCH_NOVA and MERCH_KINETIC share the cart
  const splitEval = E.evaluateAssignment(sc, ['MERCH_NOVA', 'MERCH_KINETIC', 'MERCH_KINETIC', 'MERCH_NOVA']);
  const customSolverResult = {
    feasible: true,
    constraints: {
      budgetCents: 72000,
      maxSlaHours: 48,
      minReliability: 0.95,
      excludedMerchants: [],
      strategy: 'LOWEST_COST'
    },
    recommended: splitEval
  };
  const saga = E.simulateSagaExecution(sc, customSolverResult, {
    faultType: 'PARTIAL_FULFILLMENT',
    targetMerchantId: 'MERCH_NOVA'
  });
  assert.equal(saga.sagaStatus, 'RECOVERED_AND_CAPTURED');
  assert.ok(saga.voidedAuthorizations.some((v) => v.merchantId === 'MERCH_NOVA'));
  assert.equal(E.verifySagaReceiptChain(saga.timeline).valid, true);
});

test('ENG 26: simulateSagaExecution throws when given an infeasible primary solution', () => {
  assert.throws(
    () => E.simulateSagaExecution('SCENARIO_ROBOTICS_RIG', { feasible: false, recommended: null }),
    /feasible primary cart solution/
  );
});

test('ENG 27: evaluateAssignment computes jointReliability as exact product of unique allocated merchants', () => {
  const sc = E.getScenarioById('SCENARIO_ROBOTICS_RIG');
  const splitEval = E.evaluateAssignment(sc, ['MERCH_APEX', 'MERCH_KINETIC', 'MERCH_KINETIC', 'MERCH_APEX']);
  const apexRel = E.getMerchantById('MERCH_APEX').reliabilityScore;
  const kinRel = E.getMerchantById('MERCH_KINETIC').reliabilityScore;
  assert.equal(splitEval.jointReliability, Number((apexRel * kinRel).toFixed(6)));
  assert.equal(splitEval.minMerchantReliability, Number(Math.min(apexRel, kinRel).toFixed(4)));
});

test('ENG 28: every scenario and every fault type produces a valid SHA-256 chain and schema-valid PayPal order', () => {
  const faultKeys = Object.keys(E.FAULT_CATALOG);
  for (const sc of E.SCENARIOS) {
    const solved = E.solveCart(sc.id);
    assert.equal(solved.feasible, true);
    for (const fk of faultKeys) {
      const saga = E.simulateSagaExecution(sc.id, solved, { faultType: fk });
      const chain = E.verifySagaReceiptChain(saga.timeline);
      assert.equal(chain.valid, true, 'Chain invalid on ' + sc.id + ' / ' + fk);
      if (saga.replacementOrder) {
        assert.equal(E.validatePayPalOrderPayload(saga.replacementOrder).valid, true);
      }
    }
  }
});

test('ENG 29: simulateSagaExecution on SCENARIO_BIO_BENCH uses BIO_BENCH agent and omits faulted merchant from RESERVE_INVENTORY', () => {
  const solved = E.solveCart('SCENARIO_BIO_BENCH');
  const saga = E.simulateSagaExecution('SCENARIO_BIO_BENCH', solved, {
    faultType: 'OUT_OF_STOCK_AT_CAPTURE'
  });
  assert.equal(saga.timeline[0].actor, 'BioSupplyAgent-V3');
  const reserveEvents = saga.timeline.filter((ev) => ev.phase === 'RESERVE_INVENTORY');
  assert.ok(!reserveEvents.some((ev) => ev.actor === saga.faultedMerchantName));
  assert.equal(reserveEvents.length, saga.initialPlan.shipmentCount - 1);
});
