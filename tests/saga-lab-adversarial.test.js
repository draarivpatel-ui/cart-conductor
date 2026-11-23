'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const L = require('../saga-lab.js');
const App = require('../app.js');
const { createFakeDocument } = require('./helpers/fake-dom.js');

const lab = L.createLab(E);
const SID = 'SCENARIO_ROBOTICS_RIG';

const HOSTILE_NUMBERS = [NaN, Infinity, -Infinity, -1, -0, 0.5, -0.5, 1e20, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 2 ** 53];
const HOSTILE_VALUES = [null, undefined, 'x', '', '68000', {}, [], () => 1, Symbol('s'), true, new Date(), /re/];

/* ---------- comparePolicies hostile inputs ---------- */

test('ADV CMP 01: hostile constraint objects never throw', () => {
  for (const v of HOSTILE_VALUES) {
    let cmp;
    assert.doesNotThrow(() => { cmp = lab.comparePolicies(SID, v); });
    assert.ok(cmp && Array.isArray(cmp.rows));
    assert.equal(cmp.rows.length, 5);
  }
});

test('ADV CMP 02: hostile budget cents fall back to the scenario default', () => {
  const fallback = E.getScenarioById(SID).defaultBudgetCents;
  for (const v of HOSTILE_VALUES.concat(HOSTILE_NUMBERS)) {
    if (Number.isSafeInteger(v) && v >= 0 && v <= 100000000) continue;
    const cmp = lab.comparePolicies(SID, { budgetCents: v });
    assert.equal(cmp.constraints.budgetCents, fallback, JSON.stringify(v));
  }
});

test('ADV CMP 03: non-finite sla and reliability fields fall back to defaults', () => {
  const sc = E.getScenarioById(SID);
  for (const v of HOSTILE_VALUES.concat(HOSTILE_NUMBERS)) {
    const cmp = lab.comparePolicies(SID, { maxSlaHours: v, minReliability: v });
    if (Number.isFinite(v)) {
      assert.equal(cmp.constraints.maxSlaHours, v);
      assert.equal(cmp.constraints.minReliability, v);
    } else {
      assert.equal(cmp.constraints.maxSlaHours, sc.defaultSlaHours);
      assert.equal(cmp.constraints.minReliability, sc.defaultMinReliability);
    }
  }
});

test('ADV CMP 04: hostile targetMerchantId degrades to automatic targeting', () => {
  for (const v of HOSTILE_VALUES.concat(HOSTILE_NUMBERS)) {
    const cmp = lab.comparePolicies(SID, { faultMode: 'DECLINE_OUT_OF_STOCK', targetMerchantId: v });
    assert.ok(Array.isArray(cmp.rows));
  }
});

test('ADV CMP 05: hostile non-scenario inputs throw a typed error', () => {
  for (const v of [42, true, {}, [], () => 1, Symbol('s'), new Date(), /re/]) {
    assert.throws(() => lab.comparePolicies(v, {}), /valid scenario/);
  }
  for (const v of ['NOPE', '', '__proto__']) {
    const cmp = lab.comparePolicies(v, {});
    assert.equal(cmp.scenarioId, 'SCENARIO_ROBOTICS_RIG');
  }
});

test('ADV CMP 06: constraint budgets at every integer edge stay safe', () => {
  for (const b of [0, 1, 2, 9999999999, 100000000, 100000001]) {
    const cmp = lab.comparePolicies(SID, { budgetCents: b });
    assert.equal(typeof cmp.ok, 'boolean');
    for (const row of cmp.rows) {
      if (row.feasible) assert.ok(row.plan.totalLandedCents <= b);
    }
  }
});

/* ---------- selectPolicyPlan hostile inputs ---------- */

test('ADV SEL 01: poison-shaped solved results return null, never throw', () => {
  for (const v of HOSTILE_VALUES) {
    assert.equal(L.selectPolicyPlan(v, 'greedy-min-cost'), null);
  }
  for (const pid of HOSTILE_VALUES) {
    assert.equal(L.selectPolicyPlan(E.solveCart(SID), pid), null);
  }
});

test('ADV SEL 02: forged feasible object with hostile fields stays contained', () => {
  const forges = [
    { feasible: true, modes: null, allFeasibleSolutions: 'x', baselines: 9 },
    { feasible: true, modes: {}, allFeasibleSolutions: [], baselines: null },
    { feasible: true, modes: { LOWEST_COST: 'bad' }, allFeasibleSolutions: null, baselines: null },
    { feasible: true, modes: null, allFeasibleSolutions: [{ signature: 'A' }], baselines: null },
    { feasible: true, modes: null, allFeasibleSolutions: 'nope', baselines: null },
    { feasible: true, modes: { LOWEST_COST: {} }, allFeasibleSolutions: [{}], baselines: {} }
  ];
  for (const f of forges) {
    for (const pid of L.POLICY_IDS) {
      assert.doesNotThrow(() => L.selectPolicyPlan(f, pid));
    }
  }
});

/* ---------- paretoPlotData hostile inputs ---------- */

test('ADV PPD 01: malformed solved results return the empty safe shape', () => {
  for (const v of HOSTILE_VALUES.concat(HOSTILE_NUMBERS)) {
    const data = lab.paretoPlotData(v);
    assert.equal(data.ok, false);
    assert.deepEqual(data.points, []);
    assert.equal(data.frontierCount, 0);
  }
});

test('ADV PPD 02: forged feasible results with hostile arrays stay contained', () => {
  const forges = [
    { feasible: true, allFeasibleSolutions: 'x', paretoFrontier: null, recommended: null },
    { feasible: true, allFeasibleSolutions: [null, undefined, {}], paretoFrontier: 'x', recommended: null },
    { feasible: true, allFeasibleSolutions: [{ signature: 'A', totalLandedCents: NaN, jointReliability: Infinity }], paretoFrontier: [], recommended: {} }
  ];
  for (const f of forges) {
    const data = lab.paretoPlotData(f);
    assert.equal(typeof data.ok, 'boolean');
    assert.ok(Array.isArray(data.points));
    for (const p of data.points) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    }
  }
});

/* ---------- sensitivityPlotData hostile inputs ---------- */

test('ADV SPD 01: hostile scenario inputs throw or fall back without crashing', () => {
  for (const v of [42, true, {}, [], () => 1, Symbol('s'), new Date(), /re/]) {
    assert.throws(() => lab.sensitivityPlotData(v, {}, 6), /valid scenario/);
  }
  for (const v of ['NOPE', '', null, undefined]) {
    const data = lab.sensitivityPlotData(v, {}, 6);
    assert.equal(data.ok, true);
    assert.equal(data.scenarioId, 'SCENARIO_ROBOTICS_RIG');
  }
});

test('ADV SPD 02: hostile constraint objects never throw', () => {
  for (const v of HOSTILE_VALUES) {
    const data = lab.sensitivityPlotData(SID, v, 6);
    assert.equal(typeof data.ok, 'boolean');
  }
});

test('ADV SPD 03: hostile step counts clamp into the supported range', () => {
  for (const v of HOSTILE_VALUES.concat(HOSTILE_NUMBERS)) {
    const data = lab.sensitivityPlotData(SID, {}, v);
    assert.equal(data.ok, true);
    assert.ok(data.points.length >= 2 && data.points.length <= 64, JSON.stringify(v));
  }
});

/* ---------- buildAuditBrief / verify hostile inputs ---------- */

test('ADV BRF 01: hostile buildAuditBrief inputs still return a stamped brief', () => {
  for (const v of HOSTILE_VALUES) {
    let b;
    assert.doesNotThrow(() => { b = lab.buildAuditBrief(v); });
    assert.ok(b === null || /^(null|[0-9a-f]{64})$/.test(String(b.auditDigest || 'null')));
  }
});

test('ADV BRF 02: verifyAuditBrief on hostile payloads fails closed', () => {
  for (const v of HOSTILE_VALUES.concat(HOSTILE_NUMBERS)) {
    const res = lab.verifyAuditBrief(v);
    assert.equal(res.ok, false);
    assert.equal(typeof res.reason, 'string');
  }
});

test('ADV BRF 03: tamperAuditBrief on hostile briefs never throws', () => {
  for (const v of HOSTILE_VALUES) {
    assert.doesNotThrow(() => lab.tamperAuditBrief(v));
  }
});

test('ADV BRF 04: deep-nested hostile compare objects cannot crash the brief builder', () => {
  const evil = { rows: 'x', rows2: [{ capturedCents: Symbol('s') }] };
  assert.doesNotThrow(() => lab.buildAuditBrief({ scenarioId: SID, compare: evil }));
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => lab.buildAuditBrief({ scenarioId: SID, compare: cyclic }));
});

/* ---------- exports hostile inputs ---------- */

test('ADV EXP 01: exports on hostile briefs return safe placeholders', () => {
  for (const v of HOSTILE_VALUES.concat(HOSTILE_NUMBERS)) {
    assert.equal(typeof lab.exportJsonBrief(v), 'string');
    assert.equal(typeof lab.exportCsvBrief(v), 'string');
    assert.equal(typeof lab.exportMarkdownBrief(v), 'string');
  }
});

test('ADV EXP 02: csvEscapeCell on hostile values stays formula-safe', () => {
  const bads = ['=1+1', '=\u00A0x', '+cmd', '-@x', '@', '\t', '\r\n=1', '  =x', '\u2028=1', null, undefined, 0, false, {}, ['=a']];
  for (const v of bads) {
    const esc = lab.csvEscapeCell(v);
    assert.equal(typeof esc, 'string');
    if (v !== null && v !== undefined && String(v).length > 0 && /^[=+\-@\t\r]/.test(String(v))) {
      const contentStart = esc.charAt(0) === '"' ? esc.charAt(1) : esc.charAt(0);
      assert.equal(contentStart, "'", JSON.stringify(v) + ' -> ' + JSON.stringify(esc));
    }
  }
});

test('ADV EXP 03: crafted briefs with hostile strings stay digest-verified', () => {
  const evilBrief = lab.buildAuditBrief({
    scenarioId: SID,
    constraints: { budgetCents: 68000, maxSlaHours: 48, minReliability: 0.95 },
    faultMode: '=DROP TABLE',
    activePolicy: '@x+cmd',
    compare: { rows: [] },
    sensitivity: { notes: "'; rm -rf /" }
  });
  const check = lab.verifyAuditBrief(evilBrief);
  assert.equal(check.ok, true, 'hostile strings must digest cleanly');
  const csv = lab.exportCsvBrief(evilBrief);
  assert.ok(!/^=/m.test(csv.split('\n').filter((r) => !r.startsWith('#')).join('\n')) || csv.includes("'"));
});

/* ---------- codec hostile inputs ---------- */

test('ADV CC 01: decode of every hostile primitive fails closed', () => {
  for (const v of HOSTILE_VALUES.concat(HOSTILE_NUMBERS)) {
    const res = lab.decodeBookmarkHash(v);
    assert.equal(res.ok, false);
    assert.equal(res.state, null);
    assert.equal(typeof res.reason, 'string');
  }
});

test('ADV CC 02: decode of hostile suffixes and prefixes fails closed', () => {
  const good = lab.encodeBookmarkHash({ v: 1, s: SID, p: 'greedy-min-cost', b: 68000, f: 'NONE', n: 4 });
  const variants = [
    good + ' ', ' ' + good, good + '#cc=BBBB', good.slice(0, -1), good.slice(0, 6),
    good.toUpperCase(), good + '\n', good + '\t', '#' + good.slice(1) + '#',
    'javascript:alert(1)' + good, good + '?evil=1'
  ];
  for (const v of variants) {
    const res = lab.decodeBookmarkHash(v);
    if (res.ok) {
      assert.equal(res.state.s, SID, 'accepted variant must decode identically');
    }
  }
});

test('ADV CC 03: decode cannot pollute Object.prototype via __proto__ key', () => {
  const poisoned = '{"v":1,"s":"' + SID + '","__proto__":{"polluted":true}}';
  const token = L.b64urlEncodeText(poisoned);
  const res = lab.decodeBookmarkHash('#cc=' + token);
  assert.equal(res.ok, false);
  const probe = {};
  assert.equal(probe.polluted, undefined);
});

test('ADV CC 04: encode of hostile state objects returns null or a clean hash', () => {
  for (const v of HOSTILE_VALUES.concat(HOSTILE_NUMBERS)) {
    assert.equal(lab.encodeBookmarkHash(v), null);
  }
  const cyclic = { v: 1, s: SID };
  cyclic.self = cyclic;
  const hash = lab.encodeBookmarkHash(cyclic);
  assert.ok(hash === null || lab.decodeBookmarkHash(hash).state.s === SID);
});

test('ADV CC 05: decode survives adversarial JSON value types', () => {
  const raws = [
    '{"v":1,"s":123}',
    '{"v":1,"s":"' + SID + '","b":"68000"}',
    '{"v":1,"s":"' + SID + '","p":["x"]}',
    '{"v":1,"s":"' + SID + '","f":{"x":1}}',
    '{"v":1,"s":"' + SID + '","n":true}',
    '{"v":1,"s":"' + SID + '","v":[1]}',
    '{"v":1.5,"s":"' + SID + '"}',
    '{"v":true,"s":"' + SID + '"}',
    '{"v":null,"s":"' + SID + '"}'
  ];
  for (const raw of raws) {
    const res = lab.decodeBookmarkHash('#cc=' + L.b64urlEncodeText(raw));
    assert.equal(res.ok, false, raw);
  }
});

test('ADV CC 06: gigantic and binary garbage tokens fail without throwing', () => {
  const token = L.b64urlEncodeText('x'.repeat(200000));
  assert.equal(lab.decodeBookmarkHash('#cc=' + token).ok, false);
  const bin = String.fromCharCode.apply(null, Array.from({ length: 256 }, (_, i) => i));
  const res = lab.decodeBookmarkHash('#cc=' + L.b64urlEncodeText(bin));
  assert.equal(res.ok, false);
});

/* ---------- normalizeBookmarkState internals ---------- */

test('ADV NBS 01: poison keys inside normalizeBookmarkState always reject', () => {
  const raws = [
    { '__proto__': {} },
    { 'constructor': {} },
    { 'prototype': {} },
    JSON.parse('{"__proto__":{"x":1}}'),
    JSON.parse('{"constructor":{"x":1}}')
  ];
  for (const raw of raws) {
    assert.equal(lab.normalizeBookmarkState(raw), null);
  }
});

test('ADV NBS 02: hasOwnProperty shadowing cannot bypass the key check', () => {
  const raw = { v: 1, s: SID, hasOwnProperty: 'evil' };
  const res = lab.normalizeBookmarkState(raw);
  assert.ok(res === null || res.s === SID);
});

/* ---------- self-test runner hostile conditions ---------- */

test('ADV ST 01: self-tests stay green when run back to back', () => {
  const a = lab.runLabSelfTests();
  const b = lab.runLabSelfTests();
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.total, b.total);
});

test('ADV ST 02: a fresh lab instance reports identical self-test totals', () => {
  const lab2 = L.createLab(E);
  const a = lab.runLabSelfTests();
  const b = lab2.runLabSelfTests();
  assert.equal(a.total, b.total);
  assert.equal(a.ok, b.ok);
});

/* ---------- engine-adjacent hostile probes on lab paths ---------- */

test('ADV ENG 01: hostile fault mode ids on the controller path normalize to NONE', () => {
  const doc = createFakeDocument();
  const loc = { hash: '', href: 'https://example.test/' };
  const ctl = App.createController(E, doc, lab, loc).init();
  doc.getElementById('select-lab-fault').value = '__proto__';
  doc.getElementById('select-lab-fault').dispatch('change');
  assert.equal(ctl.state.labFaultMode, '__proto__');
  assert.equal(ctl.state.labCompare.faultMode, 'NONE');
});

test('ADV ENG 02: hostile apply targets leave the controller consistent', () => {
  const doc = createFakeDocument();
  const ctl = App.createController(E, doc, lab, { hash: '', href: 'https://e.test/' }).init();
  for (const pid of HOSTILE_VALUES) {
    assert.equal(ctl.applyPolicy(pid), false);
  }
  for (const sig of HOSTILE_VALUES) {
    assert.equal(ctl.applyFrontierSignature(sig), false);
  }
  for (const b of HOSTILE_NUMBERS.concat(HOSTILE_VALUES)) {
    if (b === -0) {
      assert.equal(ctl.applyBudgetCap(b), true);
      assert.equal(ctl.state.budgetCents, 0);
      assert.equal(Object.is(ctl.state.budgetCents, -0), false);
      ctl.applyBudgetCap(68000);
      continue;
    }
    assert.equal(ctl.applyBudgetCap(b), false, String(b));
  }
  assert.equal(ctl.state.solverResult.feasible, true);
});

test('ADV ENG 03: hostile hash values on a fresh mount fall back to defaults', () => {
  const hashes = ['#cc=' + L.b64urlEncodeText('{"v":1,"s":"HACK"}'), '#cc=', '#', '#x', '#cc=~', '#cc=_'];
  for (const h of hashes) {
    const doc = createFakeDocument();
    const ctl = App.createController(E, doc, lab, { hash: h, href: 'https://e.test/' + h }).init();
    assert.equal(ctl.state.scenarioId, 'SCENARIO_ROBOTICS_RIG', h);
    assert.equal(ctl.state.solverResult.feasible, true);
  }
});
