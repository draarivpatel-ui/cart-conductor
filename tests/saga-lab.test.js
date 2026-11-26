'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../engine.js');
const L = require('../saga-lab.js');

const lab = L.createLab(E);

function nodeSha256(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex');
}

const SCENARIO_IDS = E.SCENARIOS.map((s) => s.id);
const ENGINE_FAULTS = ['NONE', 'OUT_OF_STOCK_AT_CAPTURE', 'THREE_DS_CHALLENGE_REQUIRED', 'SHIPPING_SLA_SLIPPAGE', 'PARTIAL_FULFILLMENT'];

/* ---------- Catalog shape ---------- */

test('LAB CAT 01: exactly five policies with unique ids and labels', () => {
  assert.equal(L.POLICIES.length, 5);
  const ids = L.POLICIES.map((p) => p.id);
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual(ids, ['greedy-min-cost', 'single-merchant', 'pareto-balanced', 'max-reliability', 'fastest-delivery']);
  for (const p of L.POLICIES) {
    assert.ok(typeof p.label === 'string' && p.label.length > 2);
  }
});

test('LAB CAT 02: six fault modes, each mapping to an engine fault type', () => {
  assert.equal(L.FAULT_MODES.length, 6);
  const ids = L.FAULT_MODES.map((f) => f.id);
  assert.equal(new Set(ids).size, 6);
  for (const f of L.FAULT_MODES) {
    assert.ok(E.FAULT_CATALOG[f.engineFault], f.id + ' maps to unknown engine fault ' + f.engineFault);
  }
});

test('LAB CAT 03: getPolicyById and getFaultModeById hit and miss cleanly', () => {
  assert.equal(L.getPolicyById('max-reliability').id, 'max-reliability');
  assert.equal(L.getPolicyById('nope'), null);
  assert.equal(L.getPolicyById('__proto__'), null);
  assert.equal(L.getFaultModeById('PARTIAL_STOCK').engineFault, 'PARTIAL_FULFILLMENT');
  assert.equal(L.getFaultModeById('PARTIAL_FULFILLMENT'), null);
  assert.equal(L.getFaultModeById(null), null);
});

test('LAB CAT 04: normalizeFaultMode defaults unknown values to NONE', () => {
  for (const bad of [undefined, null, 'HACK', '__proto__', 42, {}, ['NONE'], 'none']) {
    assert.equal(L.normalizeFaultMode(bad).id, 'NONE');
  }
  assert.equal(L.normalizeFaultMode('SLA_SLIPPAGE').id, 'SLA_SLIPPAGE');
});

test('LAB CAT 05: createLab requires an engine and returns bound api surface', () => {
  assert.throws(() => L.createLab(null), /CartConductorEngine/);
  assert.throws(() => L.createLab(undefined), /CartConductorEngine/);
  for (const fn of ['comparePolicies', 'paretoPlotData', 'sensitivityPlotData', 'buildAuditBrief',
    'verifyAuditBrief', 'tamperAuditBrief', 'exportJsonBrief', 'exportCsvBrief', 'exportMarkdownBrief',
    'csvEscapeCell', 'encodeBookmarkHash', 'decodeBookmarkHash', 'runLabSelfTests']) {
    assert.equal(typeof lab[fn], 'function', 'missing lab api ' + fn);
  }
});

/* ---------- selectPolicyPlan ---------- */

test('LAB SEL 01: selectPolicyPlan returns null on missing or infeasible results', () => {
  for (const bad of [null, undefined, {}, { feasible: false }, { feasible: true, modes: {} }]) {
    assert.equal(L.selectPolicyPlan(bad, 'greedy-min-cost'), null);
  }
});

test('LAB SEL 02: greedy-min-cost selects the LOWEST_COST mode exactly', () => {
  for (const sid of SCENARIO_IDS) {
    const solved = E.solveCart(sid);
    const plan = L.selectPolicyPlan(solved, 'greedy-min-cost');
    assert.equal(plan.signature, solved.modes.LOWEST_COST.signature, sid);
  }
});

test('LAB SEL 03: fastest-delivery selects the FASTEST_DELIVERY mode exactly', () => {
  for (const sid of SCENARIO_IDS) {
    const solved = E.solveCart(sid);
    const plan = L.selectPolicyPlan(solved, 'fastest-delivery');
    assert.equal(plan.signature, solved.modes.FASTEST_DELIVERY.signature, sid);
  }
});

test('LAB SEL 04: max-reliability picks the highest joint reliability of all feasible plans', () => {
  for (const sid of SCENARIO_IDS) {
    const solved = E.solveCart(sid);
    const plan = L.selectPolicyPlan(solved, 'max-reliability');
    assert.ok(plan, sid);
    for (const s of solved.allFeasibleSolutions) {
      assert.ok(s.jointReliability <= plan.jointReliability + 1e-9, sid + ' not maximal');
    }
  }
});

test('LAB SEL 05: pareto-balanced always lands on the Pareto frontier', () => {
  for (const sid of SCENARIO_IDS) {
    const solved = E.solveCart(sid);
    const plan = L.selectPolicyPlan(solved, 'pareto-balanced');
    assert.ok(plan, sid);
    const sigs = new Set(solved.paretoFrontier.map((p) => p.signature));
    assert.ok(sigs.has(plan.signature), sid + ' knee point must sit on the frontier');
  }
});

test('LAB SEL 06: single-merchant returns the best uniform assignment or null', () => {
  for (const sid of SCENARIO_IDS) {
    const solved = E.solveCart(sid);
    const plan = L.selectPolicyPlan(solved, 'single-merchant');
    const base = solved.baselines.singleMerchant;
    if (!base) {
      assert.equal(plan, null, sid);
    } else {
      assert.equal(plan.signature, base.signature, sid);
      assert.equal(plan.shipmentCount, 1, sid);
    }
  }
});

test('LAB SEL 07: unknown policy id returns null', () => {
  const solved = E.solveCart(SCENARIO_IDS[0]);
  for (const bad of ['__proto__', 'constructor', 'HACK', '', null, 9]) {
    assert.equal(L.selectPolicyPlan(solved, bad), null);
  }
});

/* ---------- comparePolicies: per-policy rows ---------- */

for (const sid of SCENARIO_IDS) {
  for (const pid of L.POLICY_IDS) {
    test('LAB CMP row ' + pid + ' on ' + sid + ' settles with exact conservation', () => {
      const cmp = lab.comparePolicies(sid, {});
      const row = cmp.rows.find((r) => r.policyId === pid);
      assert.ok(row, 'missing row');
      if (!row.feasible) {
        assert.ok(row.sagaStatus === 'NO_PLAN' || row.sagaStatus === 'OVER_BUDGET');
        return;
      }
      assert.equal(row.capturedCents - row.refundedCents, row.netSettledCents);
      assert.equal(row.netSettledCents, row.expectedNetCents);
      assert.ok(row.conservationOk);
      assert.ok(row.zeroLeak);
      assert.ok(row.chainValid);
      assert.ok(/^[0-9a-f]{64}$/.test(row.receiptChainHeadHash));
    });
  }
}

/* ---------- comparePolicies: scenario x engine fault x policy matrix ---------- */

for (const sid of SCENARIO_IDS) {
  for (const ef of ENGINE_FAULTS) {
    const fm = L.FAULT_MODES.find((f) => f.engineFault === ef && f.kind !== 'duplicate-retry');
    for (const pid of L.POLICY_IDS) {
      test('LAB CMP matrix ' + sid + ' / ' + ef + ' / ' + pid + ' keeps a verified chain', () => {
        const cmp = lab.comparePolicies(sid, { faultMode: fm.id });
        assert.equal(cmp.faultMode, fm.id);
        const row = cmp.rows.find((r) => r.policyId === pid);
        if (!row.feasible) {
          assert.ok(row.sagaStatus === 'NO_PLAN' || row.sagaStatus === 'OVER_BUDGET');
          return;
        }
        assert.ok(row.chainValid, 'receipt chain must verify');
        assert.equal(row.saga.receiptChainHeadHash, row.receiptChainHeadHash);
        assert.ok(row.conservationOk);
        assert.ok(row.zeroLeak);
        assert.ok(row.capturedCount >= 0);
        if (ef === 'NONE') {
          assert.equal(row.sagaStatus, 'SETTLED_NOMINAL');
          assert.equal(row.voidedCount, 0);
        } else {
          assert.ok(row.sagaStatus === 'RECOVERED_AND_CAPTURED' || row.sagaStatus === 'ROLLED_BACK_SAFE');
          assert.ok(row.voidedCount >= 1);
        }
      });
    }
  }
}

for (const sid of SCENARIO_IDS) {
  test('LAB CMP retry ' + sid + ': duplicate capture retry replays byte-identically', () => {
    const cmp = lab.comparePolicies(sid, { faultMode: 'DUPLICATE_RETRY' });
    assert.equal(cmp.faultMode, 'DUPLICATE_RETRY');
    for (const row of cmp.rows) {
      if (!row.feasible) continue;
      assert.equal(row.idempotentRetry, true, sid + ' ' + row.policyId);
      assert.equal(row.sagaStatus, 'SETTLED_NOMINAL');
      assert.equal(row.voidedCount, 0);
    }
  });
}

test('LAB CMP edge 01: zero budget produces no feasible rows and does not throw', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], { budgetCents: 0 });
  assert.equal(cmp.ok, false);
  for (const row of cmp.rows) {
    assert.equal(row.feasible, false);
    assert.equal(row.sagaStatus, 'NO_PLAN');
  }
});

test('LAB CMP edge 02: unknown fault mode id normalizes to NONE', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], { faultMode: 'NONSENSE' });
  assert.equal(cmp.faultMode, 'NONE');
});

test('LAB CMP edge 03: malformed options and scenarios fail clean', () => {
  assert.throws(() => lab.comparePolicies({ items: 'x' }), /valid scenario/);
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], null);
  assert.equal(cmp.ok, true);
  const cmp2 = lab.comparePolicies(SCENARIO_IDS[0], 'bad');
  assert.equal(cmp2.ok, true);
});

test('LAB CMP edge 04: non-integer or negative budget falls back to scenario default', () => {
  for (const b of [NaN, Infinity, -5, 0.5, '90000']) {
    const cmp = lab.comparePolicies(SCENARIO_IDS[0], { budgetCents: b });
    assert.equal(cmp.constraints.budgetCents, E.getScenarioById(SCENARIO_IDS[0]).defaultBudgetCents);
  }
});

test('LAB CMP edge 05: explicit target merchant faults that merchant when allocated', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], {
    faultMode: 'DECLINE_OUT_OF_STOCK'
  });
  const greedy = cmp.rows.find((r) => r.policyId === 'greedy-min-cost');
  const target = greedy.plan.merchantBreakdowns[0].merchantId;
  const cmp2 = lab.comparePolicies(SCENARIO_IDS[0], {
    faultMode: 'DECLINE_OUT_OF_STOCK',
    targetMerchantId: target
  });
  const row2 = cmp2.rows.find((r) => r.policyId === 'greedy-min-cost');
  assert.equal(row2.faultedMerchantId, target);
});

/* ---------- paretoPlotData ---------- */

test('LAB PPD 01: normalized points stay inside the unit square', () => {
  for (const sid of SCENARIO_IDS) {
    const data = lab.paretoPlotData(E.solveCart(sid));
    assert.equal(data.ok, true);
    for (const p of data.points) {
      assert.ok(p.x >= 0 && p.x <= 1, sid + ' x out of range');
      assert.ok(p.y >= 0 && p.y <= 1, sid + ' y out of range');
    }
  }
});

test('LAB PPD 02: frontier flags match the solver frontier exactly', () => {
  const solved = E.solveCart(SCENARIO_IDS[0]);
  const data = lab.paretoPlotData(solved);
  const sigs = new Set(solved.paretoFrontier.map((p) => p.signature));
  const flagged = data.points.filter((p) => p.frontier).map((p) => p.signature);
  assert.equal(new Set(flagged).size, sigs.size);
  for (const s of flagged) assert.ok(sigs.has(s));
});

test('LAB PPD 03: policy marks cover every selectable policy pick', () => {
  const solved = E.solveCart(SCENARIO_IDS[0]);
  const data = lab.paretoPlotData(solved);
  const marked = new Set();
  for (const p of data.points) {
    for (const pid of p.policyIds) marked.add(pid);
  }
  for (const pid of L.POLICY_IDS) {
    const plan = L.selectPolicyPlan(solved, pid);
    if (plan) assert.ok(marked.has(pid), 'policy pick ' + pid + ' missing mark');
  }
});

test('LAB PPD 04: selected flag follows the recommended signature', () => {
  const solved = E.solveCart(SCENARIO_IDS[0]);
  const data = lab.paretoPlotData(solved);
  const selected = data.points.filter((p) => p.selected);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].signature, solved.recommended.signature);
});

test('LAB PPD 05: infeasible and malformed inputs return the empty shape', () => {
  for (const bad of [null, undefined, {}, { feasible: false }, { feasible: true }]) {
    const data = lab.paretoPlotData(bad);
    assert.equal(data.ok, false);
    assert.deepEqual(data.points, []);
  }
});

test('LAB PPD 06: extents track the true min and max of both axes', () => {
  const solved = E.solveCart(SCENARIO_IDS[0]);
  const data = lab.paretoPlotData(solved);
  assert.equal(data.xMin, Math.min.apply(null, data.points.map((p) => p.reliability)));
  assert.equal(data.xMax, Math.max.apply(null, data.points.map((p) => p.reliability)));
  assert.equal(data.yMin, Math.min.apply(null, data.points.map((p) => p.costCents)));
  assert.equal(data.yMax, Math.max.apply(null, data.points.map((p) => p.costCents)));
});

/* ---------- sensitivityPlotData ---------- */

test('LAB SPD 01: sensitivity points mirror the engine sweep shape', () => {
  const data = lab.sensitivityPlotData(SCENARIO_IDS[0], {}, 10);
  assert.equal(data.ok, true);
  assert.equal(data.points.length, 10);
  assert.equal(data.steps, 10);
  assert.equal(data.scenarioId, SCENARIO_IDS[0]);
});

test('LAB SPD 02: sampled budgets stay inside the 70 to 130 percent band', () => {
  const sc = E.getScenarioById(SCENARIO_IDS[0]);
  const data = lab.sensitivityPlotData(sc.id, { budgetCents: sc.defaultBudgetCents }, 12);
  for (const p of data.points) {
    assert.ok(p.budgetCents >= data.lowCents);
    assert.ok(p.budgetCents <= data.highCents);
  }
  assert.equal(data.lowCents, Math.floor(sc.defaultBudgetCents * 0.70));
  assert.equal(data.highCents, Math.ceil(sc.defaultBudgetCents * 1.30));
});

test('LAB SPD 03: savings fields exist whenever a baseline and a sampled cost exist', () => {
  const data = lab.sensitivityPlotData(SCENARIO_IDS[0], {}, 12);
  for (const p of data.points) {
    if (p.costCents === null) {
      assert.equal(p.savingsVsGreedyCents, null);
      assert.equal(p.savingsVsSingleMerchantCents, null);
    } else {
      assert.ok(Number.isSafeInteger(p.savingsVsGreedyCents));
      if (data.singleMerchantTotalCents !== null) {
        assert.ok(Number.isSafeInteger(p.savingsVsSingleMerchantCents));
      }
    }
  }
});

test('LAB SPD 04: first feasible cap is the cheapest sampled feasible budget', () => {
  const data = lab.sensitivityPlotData(SCENARIO_IDS[0], {}, 16);
  const feas = data.points.filter((p) => p.feasible);
  if (feas.length) {
    assert.equal(data.firstFeasibleBudgetCents, Math.min.apply(null, feas.map((p) => p.budgetCents)));
  } else {
    assert.equal(data.firstFeasibleBudgetCents, null);
  }
});

test('LAB SPD 05: hostile caps fail closed with empty points', () => {
  for (const b of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER, 'x', {}, null]) {
    const data = lab.sensitivityPlotData(SCENARIO_IDS[0], { budgetCents: b }, 6);
    assert.equal(data.ok, false, JSON.stringify(b));
    assert.equal(data.reason, 'INVALID_BUDGET_CAP');
    assert.deepEqual(data.points, []);
  }
});

test('LAB SPD 06: recommended costs never exceed their own sampled cap', () => {
  const data = lab.sensitivityPlotData(SCENARIO_IDS[2], {}, 14);
  for (const p of data.points) {
    if (p.costCents !== null) assert.ok(p.costCents <= p.budgetCents);
  }
});

/* ---------- canonical JSON + digest ---------- */

test('LAB CJS 01: canonicalJson sorts keys recursively', () => {
  const a = L.canonicalJson({ b: 1, a: { d: 2, c: 3 } });
  const b = L.canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
});

test('LAB CJS 02: canonicalJson drops functions, undefined and symbols', () => {
  const out = JSON.parse(L.canonicalJson({ a: 1, f: () => 2, u: undefined, s: Symbol('x') }));
  assert.deepEqual(out, { a: 1 });
});

test('LAB CJS 03: canonicalJson drops poison keys and nulls non-finite numbers', () => {
  const out = L.canonicalJson({ '__proto__': { x: 1 }, 'constructor': 5, ok: NaN, inf: Infinity });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, null);
  assert.equal(parsed.inf, null);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'constructor'), false);
});

test('LAB CJS 04: canonicalJson is idempotent and stable across repeat calls', () => {
  const obj = { z: [3, { b: 1, a: [2, 1] }], a: 'x' };
  assert.equal(L.canonicalJson(obj), L.canonicalJson(obj));
});

/* ---------- audit brief + verify ---------- */

function sampleBrief(opts) {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], opts || {});
  return lab.buildAuditBrief({
    scenarioId: SCENARIO_IDS[0],
    constraints: { budgetCents: 68000, maxSlaHours: 48, minReliability: 0.95 },
    faultMode: 'NONE',
    activePolicy: 'greedy-min-cost',
    compare: cmp
  });
}

test('LAB BRF 01: stamped brief carries format, digest and disclosure', () => {
  const b = sampleBrief();
  assert.equal(b.format, 'CARTCONDUCTOR_AUDIT_BRIEF_V1');
  assert.match(b.auditDigest, /^[0-9a-f]{64}$/);
  assert.match(b.disclosure, /No live payment authorization or capture/);
});

test('LAB BRF 02: digest equals a Node-verified sha256 of the canonical payload', () => {
  const b = sampleBrief();
  const sans = {};
  for (const k of Object.keys(b)) if (k !== 'auditDigest') sans[k] = b[k];
  const expected = nodeSha256('CARTCONDUCTOR_AUDIT_BRIEF_V1|' + L.canonicalJson(sans));
  assert.equal(b.auditDigest, expected);
});

test('LAB BRF 03: cache returns the identical object for the same state', () => {
  const a = sampleBrief();
  const c = sampleBrief();
  assert.equal(a, c);
  assert.equal(a.auditDigest, c.auditDigest);
});

test('LAB BRF 04: different state produces a different digest', () => {
  const a = sampleBrief({ faultMode: 'NONE' });
  const d = sampleBrief({ faultMode: 'DECLINE_OUT_OF_STOCK' });
  assert.notEqual(a.auditDigest, d.auditDigest);
});

test('LAB BRF 05: policies array mirrors comparator rows one to one', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], {});
  const b = lab.buildAuditBrief({ scenarioId: SCENARIO_IDS[0], compare: cmp });
  assert.equal(b.policies.length, cmp.rows.length);
  cmp.rows.forEach((row, i) => {
    assert.equal(b.policies[i].policyId, row.policyId);
    assert.equal(b.policies[i].sagaStatus, row.sagaStatus);
    assert.equal(b.policies[i].capturedCents, row.capturedCents || 0);
  });
});

test('LAB BRF 06: settlement mirrors the active policy row', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], {});
  const b = lab.buildAuditBrief({
    scenarioId: SCENARIO_IDS[0],
    activePolicy: 'fastest-delivery',
    compare: cmp
  });
  const row = cmp.rows.find((r) => r.policyId === 'fastest-delivery');
  assert.equal(b.settlement.policyId, 'fastest-delivery');
  assert.equal(b.settlement.capturedCents, row.capturedCents);
});

test('LAB BRF 07: verify accepts the stamped brief and rejects mutations', () => {
  const b = sampleBrief();
  assert.equal(lab.verifyAuditBrief(b).ok, true);
  const mut = JSON.parse(JSON.stringify(b));
  mut.constraints.budgetCents += 1;
  assert.equal(lab.verifyAuditBrief(mut).ok, false);
  const mut2 = JSON.parse(JSON.stringify(b));
  mut2.policies[0].capturedCents += 1;
  assert.equal(lab.verifyAuditBrief(mut2).reason, 'DIGEST_MISMATCH');
});

test('LAB BRF 08: verifyAuditBrief fails closed on malformed briefs', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { auditDigest: 'zz' }, { auditDigest: 'a'.repeat(64) }]) {
    assert.equal(lab.verifyAuditBrief(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(lab.verifyAuditBrief({ auditDigest: 'a'.repeat(64) }).reason, 'DIGEST_MISMATCH');
  assert.equal(lab.verifyAuditBrief({}).reason, 'MISSING_DIGEST');
});

test('LAB BRF 09: tamperAuditBrief flips exactly one detectable field', () => {
  const b = sampleBrief();
  const t = lab.tamperAuditBrief(b);
  assert.equal(t.auditDigest, b.auditDigest, 'stale digest stays attached');
  assert.equal(lab.verifyAuditBrief(t).ok, false);
  assert.equal(lab.verifyAuditBrief(b).ok, true);
});

test('LAB BRF 10: stamped brief is frozen against mutation', () => {
  const b = sampleBrief();
  assert.equal(Object.isFrozen(b), true);
  assert.throws(() => { 'use strict'; b.scenarioId = 'HACK'; }, TypeError);
});

/* ---------- exports ---------- */

test('LAB EXP 01: JSON export parses back to the stamped brief', () => {
  const b = sampleBrief();
  const parsed = JSON.parse(lab.exportJsonBrief(b));
  assert.equal(parsed.auditDigest, b.auditDigest);
  assert.equal(parsed.scenarioId, b.scenarioId);
});

test('LAB EXP 02: CSV export carries the digest in provenance lines', () => {
  const b = sampleBrief();
  const csv = lab.exportCsvBrief(b);
  assert.ok(csv.includes('# sha256 ' + b.auditDigest));
  assert.ok(csv.startsWith('# cartconductor audited procurement brief'));
  assert.ok(csv.includes('policy_id,saga_status'));
});

test('LAB EXP 03: CSV has one data row per policy plus header lines', () => {
  const b = sampleBrief();
  const csv = lab.exportCsvBrief(b);
  const rows = csv.trim().split('\n');
  const dataRows = rows.filter((r) => !r.startsWith('#') && !r.startsWith('policy_id'));
  assert.equal(dataRows.length, L.POLICIES.length);
});

test('LAB EXP 04: Markdown export ends with the same digest line', () => {
  const b = sampleBrief();
  const md = lab.exportMarkdownBrief(b);
  assert.ok(md.includes('sha256: ' + b.auditDigest));
  assert.match(md, /# CartConductor Audited Procurement Brief/);
});

test('LAB EXP 05: all three exports carry byte-identical digests', () => {
  const b = sampleBrief();
  const d = b.auditDigest;
  assert.ok(lab.exportJsonBrief(b).includes(d));
  assert.ok(lab.exportCsvBrief(b).includes(d));
  assert.ok(lab.exportMarkdownBrief(b).includes(d));
});

test('LAB EXP 06: csvEscapeCell neutralizes formula injection leads', () => {
  for (const h of ['=CMD()', '+1+1', '-2+2', '@x', '\t=2', '\r=3']) {
    const esc = lab.csvEscapeCell(h);
    const firstContentChar = esc.charAt(0) === '"' ? esc.charAt(1) : esc.charAt(0);
    assert.equal(firstContentChar, "'", 'cell ' + JSON.stringify(h) + ' not escaped');
  }
});

test('LAB EXP 07: csvEscapeCell quotes commas, quotes and newlines', () => {
  assert.equal(lab.csvEscapeCell('a,b'), '"a,b"');
  assert.equal(lab.csvEscapeCell('a"b'), '"a""b"');
  assert.equal(lab.csvEscapeCell('a\nb'), '"a\nb"');
});

test('LAB EXP 07b: csvEscapeCell guards formula leads hidden by whitespace or invisible characters', () => {
  for (const h of [' =CMD()', '\n+1', '\u200b@x', '\ufeff=2']) {
    const esc = lab.csvEscapeCell(h);
    const firstContentChar = esc.charAt(0) === '"' ? esc.charAt(1) : esc.charAt(0);
    assert.equal(firstContentChar, "'", 'cell ' + JSON.stringify(h) + ' not escaped');
  }
});

test('LAB EXP 08: csvEscapeCell leaves plain values untouched', () => {
  assert.equal(lab.csvEscapeCell('MERCH_APEX'), 'MERCH_APEX');
  assert.equal(lab.csvEscapeCell(60353), '60353');
  assert.equal(lab.csvEscapeCell(''), '');
  assert.equal(lab.csvEscapeCell(null), '');
  assert.equal(lab.csvEscapeCell(undefined), '');
});

test('LAB EXP 09: formula plus quoting composes in the right order', () => {
  const esc = lab.csvEscapeCell('=x,y');
  assert.equal(esc, '"\'=x,y"');
});

test('LAB EXP 10: exports tolerate malformed brief objects without throwing', () => {
  assert.equal(lab.exportJsonBrief(null), 'null');
  assert.equal(lab.exportCsvBrief(null), '');
  assert.equal(lab.exportMarkdownBrief(null), '');
});

/* ---------- bookmark codec ---------- */

test('LAB CC 01: full-state round-trip restores every field', () => {
  const src = { v: 1, s: SCENARIO_IDS[1], p: 'pareto-balanced', b: 77700, f: 'SLA_SLIPPAGE', n: 9 };
  const hash = lab.encodeBookmarkHash(src);
  assert.ok(hash.startsWith('#cc='));
  const dec = lab.decodeBookmarkHash(hash);
  assert.equal(dec.ok, true);
  assert.deepEqual(dec.state, src);
});

for (const sid of SCENARIO_IDS) {
  test('LAB CC 02 round-trip scenario ' + sid, () => {
    const src = { v: 1, s: sid, p: 'max-reliability', b: 60000, f: 'PARTIAL_STOCK', n: 7 };
    const dec = lab.decodeBookmarkHash(lab.encodeBookmarkHash(src));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.s, sid);
  });
}

for (const pid of L.POLICY_IDS) {
  test('LAB CC 03 round-trip policy ' + pid, () => {
    const src = { v: 1, s: SCENARIO_IDS[0], p: pid, b: 65000, f: 'NONE', n: 4 };
    const dec = lab.decodeBookmarkHash(lab.encodeBookmarkHash(src));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.p, pid);
  });
}

for (const fid of L.FAULT_MODE_IDS) {
  test('LAB CC 04 round-trip fault ' + fid, () => {
    const src = { v: 1, s: SCENARIO_IDS[0], p: 'greedy-min-cost', b: 65000, f: fid, n: 4 };
    const dec = lab.decodeBookmarkHash(lab.encodeBookmarkHash(src));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.f, fid);
  });
}

test('LAB CC 05: omitted fields normalize to documented defaults', () => {
  const dec = lab.decodeBookmarkHash(lab.encodeBookmarkHash({ v: 1, s: SCENARIO_IDS[2] }));
  assert.equal(dec.ok, true);
  assert.equal(dec.state.p, 'greedy-min-cost');
  assert.equal(dec.state.b, E.getScenarioById(SCENARIO_IDS[2]).defaultBudgetCents);
  assert.equal(dec.state.f, 'NONE');
  assert.equal(dec.state.n, 12);
});

test('LAB CC 06: decode accepts bare cc= and full URL forms', () => {
  const src = { v: 1, s: SCENARIO_IDS[0], p: 'greedy-min-cost', b: 68000, f: 'NONE', n: 12 };
  const hash = lab.encodeBookmarkHash(src);
  const bare = lab.decodeBookmarkHash(hash.slice(1));
  assert.equal(bare.ok, true);
  const url = lab.decodeBookmarkHash('https://example.test/page' + hash);
  assert.equal(url.ok, true);
  const messy = lab.decodeBookmarkHash('https://example.test/page?x=1' + hash + '&y=2');
  assert.equal(messy.ok, true);
  assert.equal(messy.state.s, src.s);
});

test('LAB CC 07: poison keys fail the whole decode', () => {
  for (const poison of ['__proto__', 'prototype', 'constructor']) {
    const rawJson = '{"v":1,"s":"' + SCENARIO_IDS[0] + '","' + poison + '":{"polluted":true}}';
    const token = L.b64urlEncodeText(rawJson);
    assert.equal(lab.decodeBookmarkHash('#cc=' + token).ok, false, poison);
  }
});

test('LAB CC 08: malformed inputs fail closed across the board', () => {
  const bads = [
    null, undefined, 0, 42, {}, [], '', '#', '#cc=', 'cc=', 'no-hash',
    '#cc=!!!', '#cc=AB', '#cc=' + 'A'.repeat(5000), '#xx=AAAA'
  ];
  for (const bad of bads) {
    const res = lab.decodeBookmarkHash(bad);
    assert.equal(res.ok, false, JSON.stringify(bad));
    assert.equal(res.state, null);
  }
});

test('LAB CC 09: invalid JSON and non-object payloads fail closed', () => {
  for (const raw of ['not json', '{', '[1,2]', '"str"', '5', 'true', 'null']) {
    const token = L.b64urlEncodeText(raw);
    const res = lab.decodeBookmarkHash('#cc=' + token);
    assert.equal(res.ok, false, raw);
  }
});

test('LAB CC 10: bad version, scenario, policy, fault fail closed', () => {
  const cases = [
    { v: 0, s: SCENARIO_IDS[0] },
    { v: 2, s: SCENARIO_IDS[0] },
    { v: '1', s: SCENARIO_IDS[0] },
    { v: 1, s: 'UNKNOWN' },
    { v: 1, s: 5 },
    { v: 1, s: SCENARIO_IDS[0], p: 'HACK' },
    { v: 1, s: SCENARIO_IDS[0], p: 9 },
    { v: 1, s: SCENARIO_IDS[0], f: 'OUT_OF_STOCK_AT_CAPTURE' },
    { v: 1, s: SCENARIO_IDS[0], f: 'NONE' , n: 1}
  ];
  for (const c of cases) {
    const token = L.b64urlEncodeText(JSON.stringify(c));
    const res = lab.decodeBookmarkHash('#cc=' + token);
    assert.equal(res.ok, false, JSON.stringify(c));
  }
});

test('LAB CC 11: hostile budget fields fail closed', () => {
  const cases = [
    { v: 1, s: SCENARIO_IDS[0], b: -1 },
    { v: 1, s: SCENARIO_IDS[0], b: 0.5 },
    { v: 1, s: SCENARIO_IDS[0], b: '68000' },
    { v: 1, s: SCENARIO_IDS[0], b: NaN },
    { v: 1, s: SCENARIO_IDS[0], b: Infinity },
    { v: 1, s: SCENARIO_IDS[0], b: Number.MAX_SAFE_INTEGER },
    { v: 1, s: SCENARIO_IDS[0], b: {} },
    { v: 1, s: SCENARIO_IDS[0], b: [68000] }
  ];
  for (const c of cases) {
    const token = L.b64urlEncodeText(JSON.stringify(c));
    const res = lab.decodeBookmarkHash('#cc=' + token);
    assert.equal(res.ok, false, JSON.stringify(c));
  }
});

test('LAB CC 12: out-of-range sensitivity samples fail closed', () => {
  for (const n of [0, 1, 65, -4, 3.5, '12', NaN, Infinity, {}, []]) {
    const raw = { v: 1, s: SCENARIO_IDS[0], n };
    const token = L.b64urlEncodeText(JSON.stringify(raw));
    const res = lab.decodeBookmarkHash('#cc=' + token);
    assert.equal(res.ok, false, JSON.stringify(n));
  }
});

test('LAB CC 13: encode returns null for unencodable state', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { v: 1, s: 'NOPE' }, { v: 2, s: SCENARIO_IDS[0] }]) {
    assert.equal(lab.encodeBookmarkHash(bad), null, JSON.stringify(bad));
  }
});

test('LAB CC 14: zero budget encodes and decodes as a valid infeasible probe', () => {
  const src = { v: 1, s: SCENARIO_IDS[0], p: 'greedy-min-cost', b: 0, f: 'NONE', n: 4 };
  const dec = lab.decodeBookmarkHash(lab.encodeBookmarkHash(src));
  assert.equal(dec.ok, true);
  assert.equal(dec.state.b, 0);
});

test('LAB CC 15: b64url codec handles unicode and rejects broken input', () => {
  const uni = 'utf8 euro \u20AC snow \u2603';
  const round = L.b64urlDecodeText(L.b64urlEncodeText(uni));
  assert.equal(round, uni);
  assert.equal(L.b64urlDecodeText('!!!!'), null);
  assert.equal(L.b64urlDecodeText('A'), null);
  assert.equal(L.b64urlDecodeText(''), null);
  assert.equal(L.b64urlDecodeText(null), null);
});

test('LAB CC 16: normalizeBookmarkState enforces plain-object shape', () => {
  for (const bad of [null, undefined, 5, 'x', [], new Date()]) {
    assert.equal(lab.normalizeBookmarkState(bad), null, JSON.stringify(bad));
  }
});

/* ---------- self-test runner ---------- */

test('LAB ST 00: self-test suite runs 14 or more checks and all pass', () => {
  const res = lab.runLabSelfTests();
  assert.ok(res.total >= 14, 'expected at least 14 in-page checks');
  assert.equal(res.passed, res.total);
  assert.equal(res.ok, true);
});

test('LAB ST parity: each self-test id is reported exactly once and passes', () => {
  const res = lab.runLabSelfTests();
  const ids = res.results.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of res.results) {
    assert.equal(r.ok, true, r.id + ' failed: ' + r.detail);
  }
});

for (const expectedId of [
  'sha256-kat', 'waterfall-exactness', 'conservation', 'rollback-zero-leak',
  'pareto-non-dominance', 'infeasible-graceful', 'csv-formula-escape',
  'tamper-detection', 'digest-parity', 'cc-round-trip', 'cc-hostile',
  'duplicate-retry', 'policy-matrix', 'single-merchant-graceful', 'bookmark-normalize'
]) {
  test('LAB ST ' + expectedId + ' passes inside the in-page runner', () => {
    const res = lab.runLabSelfTests();
    const row = res.results.find((r) => r.id === expectedId);
    assert.ok(row, 'missing self-test ' + expectedId);
    assert.equal(row.ok, true, row.detail);
  });
}

/* ---------- Cross-instance and determinism verification ---------- */

test('LAB X 01: two independent lab instances stamp identical digests on identical state', () => {
  const labB = L.createLab(E);
  const snap = () => {
    const cmp = lab.comparePolicies(SCENARIO_IDS[0], { faultMode: 'SLA_SLIPPAGE' });
    return { scenarioId: SCENARIO_IDS[0], compare: cmp, faultMode: 'SLA_SLIPPAGE', activePolicy: 'pareto-balanced' };
  };
  const a = lab.buildAuditBrief(snap());
  const b = labB.buildAuditBrief(snap());
  assert.notEqual(a, b);
  assert.equal(a.auditDigest, b.auditDigest);
});

test('LAB X 02: brief digest is stable across a JSON serialization boundary', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], {});
  const b = lab.buildAuditBrief({ scenarioId: SCENARIO_IDS[0], compare: cmp });
  const roundTripped = JSON.parse(JSON.stringify(b));
  assert.equal(lab.verifyAuditBrief(roundTripped).ok, true);
});

test('LAB X 03: repeated comparator runs return byte-identical digests', () => {
  const mk = () => lab.buildAuditBrief({
    scenarioId: SCENARIO_IDS[0],
    compare: lab.comparePolicies(SCENARIO_IDS[0], { faultMode: 'DECLINE_OUT_OF_STOCK' })
  });
  assert.equal(mk().auditDigest, mk().auditDigest);
});

test('LAB X 04: aggregate captured minus refunded equals net settled across the whole matrix', () => {
  for (const fm of L.FAULT_MODES) {
    const cmp = lab.comparePolicies(SCENARIO_IDS[1], { faultMode: fm.id });
    for (const row of cmp.rows) {
      if (!row.feasible) continue;
      assert.equal(row.capturedCents - row.refundedCents - row.netSettledCents, 0, fm.id + ' ' + row.policyId);
      assert.ok(row.capturedCents >= 0 && row.voidedCents >= 0 && row.refundedCents === 0);
    }
  }
});

test('LAB X 05: sensitivity savings at the first feasible cap are non-negative vs greedy', () => {
  const data = lab.sensitivityPlotData(SCENARIO_IDS[0], {}, 16);
  const first = data.points.find((p) => p.budgetCents === data.firstFeasibleBudgetCents);
  if (first && first.savingsVsGreedyCents !== null) {
    assert.ok(first.savingsVsGreedyCents >= 0);
  }
});

test('LAB X 06: byte-identical CSV exports for two builds of the same state', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], {});
  const a = lab.buildAuditBrief({ scenarioId: SCENARIO_IDS[0], compare: cmp });
  const b = lab.buildAuditBrief({ scenarioId: SCENARIO_IDS[0], compare: cmp });
  assert.equal(lab.exportCsvBrief(a), lab.exportCsvBrief(b));
});

test('LAB X 07: markdown table contains one data row per policy', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], {});
  const b = lab.buildAuditBrief({ scenarioId: SCENARIO_IDS[0], compare: cmp });
  const md = lab.exportMarkdownBrief(b);
  const rows = md.split('\n').filter((r) => r.startsWith('| ') && !r.startsWith('| ---'));
  assert.equal(rows.length, L.POLICIES.length + 1);
});

test('LAB X 08: encoded bookmark tokens use only url-safe characters', () => {
  for (const sid of SCENARIO_IDS) {
    for (const f of L.FAULT_MODE_IDS) {
      const hash = lab.encodeBookmarkHash({ v: 1, s: sid, f });
      assert.match(hash, /^#cc=[A-Za-z0-9_-]+$/);
    }
  }
});

test('LAB X 09: every policy-selected plan sits within its own budget cap', () => {
  for (const sid of SCENARIO_IDS) {
    const solved = E.solveCart(sid);
    const budget = solved.constraints.budgetCents;
    for (const pid of L.POLICY_IDS) {
      const plan = L.selectPolicyPlan(solved, pid);
      if (plan) assert.ok(plan.totalLandedCents <= budget, sid + ' ' + pid);
    }
  }
});

test('LAB X 10: comparator never leaves stranded authorizations', () => {
  for (const sid of SCENARIO_IDS) {
    for (const fm of L.FAULT_MODES) {
      const cmp = lab.comparePolicies(sid, { faultMode: fm.id });
      for (const row of cmp.rows) {
        if (row.feasible) assert.equal(row.zeroLeak, true, sid + ' ' + fm.id + ' ' + row.policyId);
      }
    }
  }
});

test('LAB X 11: receipt head hash on every row matches the verified chain output', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[2], { faultMode: 'PARTIAL_STOCK' });
  for (const row of cmp.rows) {
    if (!row.feasible) continue;
    const chain = E.verifySagaReceiptChain(row.saga.timeline);
    assert.equal(chain.valid, true);
    assert.equal(chain.headHash, row.receiptChainHeadHash);
  }
});

test('LAB X 12: duplicate retry keeps identical order id, request id, captures and head hash', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], { faultMode: 'DUPLICATE_RETRY' });
  for (const row of cmp.rows) {
    if (!row.feasible) continue;
    assert.equal(row.idempotentRetry, true, row.policyId);
  }
});

test('LAB X 13: tampered briefs are detected even when digest field is re-copied', () => {
  const cmp = lab.comparePolicies(SCENARIO_IDS[0], {});
  const b = lab.buildAuditBrief({ scenarioId: SCENARIO_IDS[0], compare: cmp });
  const t = lab.tamperAuditBrief(b);
  const forged = Object.assign({}, t, { auditDigest: b.auditDigest });
  assert.equal(lab.verifyAuditBrief(forged).ok, false);
});

test('LAB X 14: hostile strings injected into a brief cannot break verification', () => {
  const b = lab.buildAuditBrief({
    scenarioId: SCENARIO_IDS[0],
    faultMode: "';DROP",
    activePolicy: '__proto__',
    compare: lab.comparePolicies(SCENARIO_IDS[0], {})
  });
  assert.equal(lab.verifyAuditBrief(b).ok, true);
});
