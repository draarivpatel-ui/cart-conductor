'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../engine.js');

function nodeSha256(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex');
}

function solvedRobotics(constraints) {
  return E.solveCart('SCENARIO_ROBOTICS_RIG', constraints);
}

test('RBT 01: saga voids surviving merchant authorization when fallback plan drops it', () => {
  const solved = solvedRobotics({ strategy: 'FASTEST_DELIVERY' });
  const saga = E.simulateSagaExecution('SCENARIO_ROBOTICS_RIG', solved, {
    faultType: 'OUT_OF_STOCK_AT_CAPTURE',
    targetMerchantId: 'MERCH_ZENITH'
  });
  assert.equal(saga.sagaStatus, 'RECOVERED_AND_CAPTURED');
  const fallbackIds = saga.finalPlan.merchantBreakdowns.map((m) => m.merchantId);
  const capturedIds = saga.captures.map((c) => c.merchantId);
  const voidedIds = saga.voidedAuthorizations.map((v) => v.merchantId);
  for (const mb of saga.initialPlan.merchantBreakdowns) {
    if (mb.merchantId === saga.faultedMerchantId) continue;
    if (fallbackIds.includes(mb.merchantId)) {
      assert.ok(capturedIds.includes(mb.merchantId), 'surviving merchant must be captured');
    } else {
      assert.ok(voidedIds.includes(mb.merchantId), 'dropped merchant hold must be voided');
    }
  }
  assert.ok(voidedIds.includes('MERCH_HYPERION'));
  assert.equal(E.verifySagaReceiptChain(saga.timeline).valid, true);
});

test('RBT 02: every scenario x strategy x fault x merchant saga leaves zero stranded holds', () => {
  for (const sc of E.SCENARIOS) {
    for (const strategy of ['LOWEST_COST', 'FASTEST_DELIVERY', 'FEWEST_SHIPMENTS']) {
      const solved = E.solveCart(sc.id, { strategy });
      if (!solved.feasible) continue;
      for (const faultType of Object.keys(E.FAULT_CATALOG)) {
        if (faultType === 'NONE') continue;
        for (const mb of solved.recommended.merchantBreakdowns) {
          const saga = E.simulateSagaExecution(sc.id, solved, {
            faultType,
            targetMerchantId: mb.merchantId
          });
          if (saga.sagaStatus !== 'RECOVERED_AND_CAPTURED') continue;
          const resolved = new Set([
            ...saga.captures.map((c) => c.merchantId),
            ...saga.voidedAuthorizations.map((v) => v.merchantId)
          ]);
          for (const orig of saga.initialPlan.merchantBreakdowns) {
            assert.ok(
              resolved.has(orig.merchantId),
              sc.id + ' ' + strategy + ' ' + faultType + ' stranded ' + orig.merchantId
            );
          }
        }
      }
    }
  }
});

test('RBT 03: solveCart bounds work and returns SEARCH_LIMIT_EXCEEDED instead of exhausting memory', () => {
  const big = {
    id: 'BIG',
    title: 'big',
    items: Array.from({ length: 9 }, (_, i) => ({
      sku: 'S' + i,
      name: 'n',
      qty: 1,
      offers: E.MERCHANTS.slice(0, 5).map((m) => ({
        merchantId: m.id, unitPriceCents: 1000, stock: 99, deliveryHours: 10
      }))
    })),
    defaultBudgetCents: 1e9,
    defaultSlaHours: 72,
    defaultMinReliability: 0
  };
  const res = E.solveCart(big);
  assert.equal(res.feasible, false);
  assert.equal(res.searchLimitExceeded, true);
  assert.equal(res.reason, 'SEARCH_LIMIT_EXCEEDED');
  assert.ok(res.nodesExplored <= 250000);

  const tiny = E.solveCart('SCENARIO_ROBOTICS_RIG', { maxSearchNodes: 3 });
  assert.equal(tiny.searchLimitExceeded, true);
});

test('RBT 04: solveCart returns CART_TOO_LARGE instead of overflowing the call stack', () => {
  const deep = {
    id: 'DEEP',
    items: Array.from({ length: 15000 }, (_, i) => ({
      sku: 'S' + i, qty: 1,
      offers: [{ merchantId: 'MERCH_APEX', unitPriceCents: 100, stock: 99999, deliveryHours: 5 }]
    })),
    defaultBudgetCents: 1e9,
    defaultSlaHours: 72,
    defaultMinReliability: 0
  };
  const res = E.solveCart(deep);
  assert.equal(res.feasible, false);
  assert.equal(res.reason, 'CART_TOO_LARGE');
});

test('RBT 05: solveCart and evaluateAssignment reject malformed scenario shapes cleanly', () => {
  for (const bad of [{}, [], 5, { items: 'x' }, { items: [{ sku: 'a', qty: 1, offers: 'x' }] }]) {
    assert.throws(() => E.solveCart(bad), /solveCart requires/);
  }
  const empty = {
    id: 'E',
    items: [{ sku: 'a', qty: 1, offers: [] }],
    defaultSlaHours: 72, defaultBudgetCents: 1e6, defaultMinReliability: 0
  };
  const res = E.solveCart(empty);
  assert.equal(res.feasible, false);
});

test('RBT 06: excludedMerchants accepts a string id and rejects non-iterables', () => {
  const sc = E.SCENARIOS[0];
  const assignment = sc.items.map(() => 'MERCH_APEX');
  const res = E.evaluateAssignment(sc, assignment, { excludedMerchants: 'MERCH_APEX' });
  assert.equal(res.reason, 'EXCLUDED_MERCHANT');
  for (const bad of [5, {}, true, Infinity]) {
    assert.throws(() => E.evaluateAssignment(sc, assignment, { excludedMerchants: bad }), /excludedMerchants/);
    assert.throws(() => E.solveCart(sc.id, { excludedMerchants: bad }), /excludedMerchants/);
  }
});

test('RBT 07: NaN constraint overrides fall back to scenario defaults instead of disabling checks', () => {
  const res = E.solveCart('SCENARIO_ROBOTICS_RIG', { maxSlaHours: NaN, minReliability: NaN });
  const sc = E.getScenarioById('SCENARIO_ROBOTICS_RIG');
  assert.equal(res.constraints.maxSlaHours, sc.defaultSlaHours);
  assert.equal(res.constraints.minReliability, sc.defaultMinReliability);

  const badItem = {
    id: 'B',
    items: [{ sku: 'a', qty: 1, offers: [{ merchantId: 'MERCH_APEX', unitPriceCents: 100, stock: 5, deliveryHours: 900 }] }],
    defaultSlaHours: 72, defaultBudgetCents: 1e6, defaultMinReliability: 0
  };
  const ev = E.evaluateAssignment(badItem, ['MERCH_APEX'], { maxSlaHours: NaN });
  assert.equal(ev.reason, 'SLA_EXCEEDED');
});

test('RBT 08: crafted item and offer fields cannot smuggle invalid economics', () => {
  const mk = (qty, offer) => ({
    id: 'C',
    items: [{ sku: 'a', qty, offers: [Object.assign({ merchantId: 'MERCH_APEX', unitPriceCents: 100, stock: 5, deliveryHours: 5 }, offer)] }],
    defaultSlaHours: 72, defaultBudgetCents: 1e6, defaultMinReliability: 0
  });
  for (const qty of [-5, 0, 1.5, '2', NaN]) {
    assert.equal(E.evaluateAssignment(mk(qty, {}), ['MERCH_APEX'], {}).reason, 'INVALID_ITEM_QUANTITY');
  }
  for (const offer of [{ unitPriceCents: -500 }, { unitPriceCents: 100.7 }, { stock: -1 }, { stock: NaN }, { deliveryHours: NaN }, { deliveryHours: -50 }]) {
    assert.equal(E.evaluateAssignment(mk(1, offer), ['MERCH_APEX'], {}).reason, 'INVALID_OFFER_DATA');
  }
});

test('RBT 09: duplicate SKUs cannot overdraw stock or forge the bundle threshold', () => {
  const dup = (qty, stock) => ({
    id: 'D',
    items: [
      { sku: 'SKU-SAME', name: 'x', qty, offers: [{ merchantId: 'MERCH_APEX', unitPriceCents: 1000, stock, deliveryHours: 10 }] },
      { sku: 'SKU-SAME', name: 'x', qty, offers: [{ merchantId: 'MERCH_APEX', unitPriceCents: 1000, stock, deliveryHours: 10 }] }
    ],
    defaultBudgetCents: 1e7, defaultSlaHours: 72, defaultMinReliability: 0
  });
  assert.equal(
    E.evaluateAssignment(dup(3, 5), ['MERCH_APEX', 'MERCH_APEX'], { budgetCents: 1e7 }).reason,
    'INSUFFICIENT_STOCK'
  );
  const ok = E.evaluateAssignment(dup(2, 50), ['MERCH_APEX', 'MERCH_APEX'], { budgetCents: 1e7 });
  assert.equal(ok.feasible, true);
  assert.equal(ok.merchantBreakdowns[0].distinctSkuCount, 1);
  assert.equal(ok.merchantBreakdowns[0].qualifiesBundle, false);
  assert.equal(ok.merchantBreakdowns[0].discountCents, 0);
});

test('RBT 10: validatePayPalOrderPayload returns invalid instead of throwing on malformed shapes', () => {
  const base = E.buildPayPalOrderPayload('SCENARIO_ROBOTICS_RIG', solvedRobotics().recommended);
  const mutations = [
    (p) => { p.body.purchase_units = [null]; },
    (p) => { p.body.purchase_units[0].items = 'ab'; },
    (p) => { p.body.purchase_units[0].items = [null]; },
    (p) => { p.body.purchase_units[0].items = [{}]; },
    (p) => { p.body.purchase_units[0].items = 5; },
    (p) => { p.body.purchase_units[0].items = {}; },
    (p) => { p.body.purchase_units[0].payee = null; },
    (p) => { p.body.purchase_units[0].amount.value = 'abc'; },
    (p) => { p.body.purchase_units[0].amount.breakdown = 'x'; }
  ];
  for (const mutate of mutations) {
    const copy = JSON.parse(JSON.stringify(base));
    mutate(copy);
    const res = E.validatePayPalOrderPayload(copy);
    assert.equal(res.valid, false);
    assert.ok(res.errors.length > 0);
  }
});

test('RBT 11: validatePayPalOrderPayload rejects negative money end to end', () => {
  const base = E.buildPayPalOrderPayload('SCENARIO_ROBOTICS_RIG', solvedRobotics().recommended);
  const neg = JSON.parse(JSON.stringify(base));
  neg.body.purchase_units[0].amount.value = '-10.00';
  neg.body.purchase_units[0].amount.breakdown.item_total.value = '-10.00';
  const res = E.validatePayPalOrderPayload(neg);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => /Negative/.test(e)));
});

test('RBT 12: receipt chain authenticates recorded request and response payloads', () => {
  const saga = E.simulateSagaExecution('SCENARIO_ROBOTICS_RIG', solvedRobotics(), { faultType: 'OUT_OF_STOCK_AT_CAPTURE' });
  const tampered = JSON.parse(JSON.stringify(saga.timeline));
  const ev = tampered.find((e) => e.phase === 'AUTHORIZE_UNIT');
  ev.apiRecord.requestBody.amount.value = '0.01';
  ev.apiRecord.requestBody.reference_id = 'PU_99_HACKED';
  assert.equal(E.verifySagaReceiptChain(tampered).valid, false);
});

test('RBT 13: verifySagaReceiptChain guards malformed entries and step sequence', () => {
  assert.equal(E.verifySagaReceiptChain([null]).valid, false);
  assert.equal(E.verifySagaReceiptChain([undefined]).valid, false);
  const saga = E.simulateSagaExecution('SCENARIO_ROBOTICS_RIG', solvedRobotics(), { faultType: 'NONE' });
  const stepped = JSON.parse(JSON.stringify(saga.timeline));
  stepped[2].step = 99;
  assert.equal(E.verifySagaReceiptChain(stepped).reason, 'STEP_SEQUENCE_MISMATCH_AT_INDEX_2');
  const head = E.verifySagaReceiptChain(saga.timeline);
  assert.equal(head.headHash, saga.receiptChainHeadHash);
});

test('RBT 14: paretoCrowdingDistance ignores malformed frontier entries', () => {
  const pts = [
    { signature: 'a', totalLandedCents: 100, maxDeliveryHours: 10, shipmentCount: 1, jointReliability: 0.9 },
    null,
    { signature: 'b', totalLandedCents: 200, maxDeliveryHours: 20, shipmentCount: 2, jointReliability: 0.8 },
    { signature: 'c', totalLandedCents: 300, maxDeliveryHours: 30, shipmentCount: 3, jointReliability: 0.7 }
  ];
  const res = E.paretoCrowdingDistance(pts);
  assert.equal(res.length, 3);
  assert.ok(res.every((r) => typeof r.signature === 'string'));
});

test('RBT 15: sha256Hex matches platform digest on lone surrogates', () => {
  for (const s of ['\uD800A', '\uD800', '\uDC00', '\uD800\uD800', 'A\uDC00B']) {
    assert.equal(E.sha256Hex(s), nodeSha256(s), JSON.stringify(s));
  }
});

test('RBT 16: simulateSagaExecution guards mismatched scenario/solution pairs and missing constraints', () => {
  const solved = solvedRobotics();
  assert.throws(
    () => E.simulateSagaExecution('SCENARIO_BIO_BENCH', solved, { faultType: 'NONE' }),
    /different scenario|belongs to scenario/
  );
  const saga = E.simulateSagaExecution('SCENARIO_ROBOTICS_RIG',
    { feasible: true, recommended: solved.recommended },
    { faultType: 'OUT_OF_STOCK_AT_CAPTURE' });
  assert.ok(saga.sagaStatus === 'RECOVERED_AND_CAPTURED' || saga.sagaStatus === 'ROLLED_BACK_SAFE');
});

test('RBT 17: centsToDollars rejects fractional and non-integer cents', () => {
  assert.throws(() => E.centsToDollars(100.5), /integer/);
  assert.throws(() => E.centsToDollars(NaN), /integer/);
  assert.equal(E.centsToDollars(-8775), '-87.75');
});
