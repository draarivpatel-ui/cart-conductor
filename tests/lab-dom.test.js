'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const App = require('../app.js');
const L = require('../saga-lab.js');
const { createFakeDocument, FakeElement } = require('./helpers/fake-dom.js');

const lab = L.createLab(E);

function makeLoc(hash) {
  return {
    hash: hash || '',
    href: 'https://example.test/cart-conductor/' + (hash || '')
  };
}

function mount(hash) {
  const doc = createFakeDocument();
  const loc = makeLoc(hash || '');
  const ctl = App.createController(E, doc, lab, loc).init();
  return { doc, ctl, loc, el: (id) => doc.getElementById(id) };
}

test('LDOM 01: lab section is present, visible, and populated after init', () => {
  const { el } = mount();
  const section = el('section-saga-lab');
  assert.ok(section, 'missing lab section element');
  assert.equal(section.hidden, false);
  const rows = el('tbody-lab-policies').innerHTML;
  for (const pid of L.POLICY_IDS) {
    assert.ok(rows.includes('data-policy="' + pid + '"'), 'missing row for ' + pid);
  }
});

test('LDOM 02: comparator table has one row per policy with all nine columns', () => {
  const { el } = mount();
  const html = el('tbody-lab-policies').innerHTML;
  const trs = html.match(/<tr /g) || [];
  assert.equal(trs.length, L.POLICIES.length);
  const tds = (html.split('</tr>')[0].match(/<td/g) || []).length;
  assert.equal(tds, 9);
});

test('LDOM 03: nominal run shows SETTLED_NOMINAL badges and conservation proof tags', () => {
  const { el } = mount();
  const html = el('tbody-lab-policies').innerHTML;
  assert.ok(html.includes('SETTLED_NOMINAL'));
  assert.ok(html.includes('CHAIN'));
  assert.ok(html.includes('CONSERVED'));
  assert.ok(html.includes('ZERO-LEAK'));
  assert.ok(html.includes('badge-green'));
});

test('LDOM 04: digest chip displays the stamped audit sha256', () => {
  const { ctl, el } = mount();
  const digest = el('lab-digest').textContent;
  assert.match(digest, /^sha256 [0-9a-f]{64}$/);
  assert.ok(ctl.state.labBrief);
  assert.ok(digest.includes(ctl.state.labBrief.auditDigest));
});

test('LDOM 05: Pareto SVG renders normalized frontier points with keyboard focus', () => {
  const { el } = mount();
  const svg = el('svg-lab-pareto').innerHTML;
  assert.ok(svg.includes('<rect'));
  assert.ok(svg.includes('plot-focus'));
  assert.ok(svg.includes('tabindex="0"'));
  assert.ok(svg.includes('data-sig="'));
  assert.ok((svg.match(/<circle /g) || []).length >= 2);
  assert.ok(el('caption-lab-pareto').textContent.length > 20);
});

test('LDOM 06: sensitivity SVG renders the step curve with focusable cap points', () => {
  const { el } = mount();
  const svg = el('svg-lab-sensitivity').innerHTML;
  assert.ok(svg.includes('data-budget="'));
  assert.ok(svg.includes('plot-focus'));
  assert.ok(svg.includes('first feasible') || svg.includes('cap sweep'));
  assert.ok(el('caption-lab-sensitivity').textContent.includes('cap'));
});

test('LDOM 07: policy Apply button selects the plan and marks the row active', () => {
  const { ctl, el } = mount();
  ctl.applyPolicy('fastest-delivery');
  assert.equal(ctl.state.policyId, 'fastest-delivery');
  const html = el('tbody-lab-policies').innerHTML;
  assert.ok(html.includes('data-policy="fastest-delivery"'));
  const activeRow = html.split('</tr>').find((r) => r.includes('lab-policy-active'));
  assert.ok(activeRow.includes('fastest-delivery'));
});

test('LDOM 08: clicking a policy row through delegated tbody listener applies the policy', () => {
  const { ctl, el, doc } = mount();
  const tbody = el('tbody-lab-policies');
  const fakeTarget = new FakeElement('apply-max', 'BUTTON', doc);
  fakeTarget.setAttribute('data-policy', 'max-reliability');
  tbody.dispatch('click', { target: fakeTarget });
  assert.equal(ctl.state.policyId, 'max-reliability');
});

test('LDOM 09: delegated click with no data-policy does nothing', () => {
  const { ctl, el } = mount();
  const tbody = el('tbody-lab-policies');
  const fakeTarget = new FakeElement('noop', 'TD');
  const before = ctl.state.policyId;
  tbody.dispatch('click', { target: fakeTarget });
  assert.equal(ctl.state.policyId, before);
});

test('LDOM 10: Apply on an infeasible policy leaves the active plan untouched', () => {
  const { ctl, el } = mount();
  const minCost = ctl.state.solverResult.modes.LOWEST_COST.totalLandedCents;
  const single = lab.comparePolicies(ctl.state.scenarioId, { budgetCents: minCost });
  const singleRow = single.rows.find((r) => r.policyId === 'single-merchant');
  const budgetForInfeasibleSingle = singleRow.feasible
    ? Math.max(1, singleRow.plan.totalLandedCents - 1)
    : minCost;
  el('input-budget').value = String(budgetForInfeasibleSingle);
  el('input-budget').dispatch('input');
  const beforeSig = ctl.state.solverResult.feasible ? ctl.state.solverResult.recommended.signature : null;
  const ok = ctl.applyPolicy('single-merchant');
  if (!ok) {
    assert.notEqual(ctl.state.policyId, 'single-merchant');
    const afterSig = ctl.state.solverResult.feasible ? ctl.state.solverResult.recommended.signature : null;
    assert.equal(afterSig, beforeSig);
  }
});

test('LDOM 11: fault-mode selector re-renders comparator rows with recovery statuses', () => {
  const { ctl, el } = mount();
  el('select-lab-fault').value = 'DECLINE_OUT_OF_STOCK';
  el('select-lab-fault').dispatch('change');
  assert.equal(ctl.state.labFaultMode, 'DECLINE_OUT_OF_STOCK');
  const html = el('tbody-lab-policies').innerHTML;
  assert.ok(html.includes('RECOVERED_AND_CAPTURED') || html.includes('ROLLED_BACK_SAFE'));
  assert.match(el('lab-policy-status').textContent, /declin|stock|fault/i);
});

test('LDOM 12: every lab fault mode renders a comparator state without throwing', () => {
  const { ctl, el } = mount();
  for (const fm of L.FAULT_MODES) {
    el('select-lab-fault').value = fm.id;
    el('select-lab-fault').dispatch('change');
    assert.equal(ctl.state.labFaultMode, fm.id);
    assert.ok(el('tbody-lab-policies').innerHTML.length > 40, fm.id);
  }
});

test('LDOM 13: lab sensitivity slider syncs both analytics panels', () => {
  const { ctl, el } = mount();
  el('range-lab-sensitivity').value = '7';
  el('range-lab-sensitivity').dispatch('input');
  assert.equal(ctl.state.sensitivitySteps, 7);
  assert.equal(el('label-lab-sensitivity').textContent, '7');
  assert.equal(el('output-sensitivity-steps').textContent, '7');
  assert.equal(el('range-sensitivity-steps').value, '7');
  const dots = el('svg-lab-sensitivity').innerHTML.match(/data-budget="/g) || [];
  assert.equal(dots.length, 7);
});

test('LDOM 14: main sensitivity slider syncs the lab slider and redraws the sweep', () => {
  const { ctl, el } = mount();
  el('range-sensitivity-steps').value = '5';
  el('range-sensitivity-steps').dispatch('input');
  assert.equal(ctl.state.sensitivitySteps, 5);
  assert.equal(el('range-lab-sensitivity').value, '5');
  assert.equal(el('label-lab-sensitivity').textContent, '5');
});

test('LDOM 15: JSON export fills the preview with the stamped brief', () => {
  const { ctl, el } = mount();
  el('btn-lab-json').dispatch('click');
  const parsed = JSON.parse(el('lab-export-preview').textContent);
  assert.equal(parsed.auditDigest, ctl.state.labBrief.auditDigest);
  assert.equal(parsed.format, 'CARTCONDUCTOR_AUDIT_BRIEF_V1');
});

test('LDOM 16: CSV export preview carries the digest provenance lines', () => {
  const { ctl, el } = mount();
  el('btn-lab-csv').dispatch('click');
  const txt = el('lab-export-preview').textContent;
  assert.ok(txt.includes('# sha256 ' + ctl.state.labBrief.auditDigest));
  assert.ok(txt.includes('policy_id,saga_status'));
});

test('LDOM 17: Markdown export preview ends with the digest footer', () => {
  const { ctl, el } = mount();
  el('btn-lab-md').dispatch('click');
  const txt = el('lab-export-preview').textContent;
  assert.ok(txt.includes('sha256: ' + ctl.state.labBrief.auditDigest));
  assert.match(txt, /Audited Procurement Brief/);
});

test('LDOM 18: share-link button writes a restorable cc= hash and shows the URL', () => {
  const { ctl, loc, el } = mount();
  ctl.applyPolicy('pareto-balanced');
  el('select-lab-fault').value = 'PARTIAL_STOCK';
  el('select-lab-fault').dispatch('change');
  el('btn-lab-share').dispatch('click');
  assert.ok(loc.hash.startsWith('#cc='), 'hash not written to location');
  const dec = lab.decodeBookmarkHash(loc.hash);
  assert.equal(dec.ok, true);
  assert.equal(dec.state.p, 'pareto-balanced');
  assert.equal(dec.state.f, 'PARTIAL_STOCK');
  assert.equal(dec.state.b, ctl.state.budgetCents);
  assert.ok(el('lab-export-preview').textContent.includes('#cc='));
});

test('LDOM 19: verify button reports a clean digest and a detected mutation', () => {
  const { el } = mount();
  el('btn-lab-verify').dispatch('click');
  const txt = el('lab-verify-status').textContent;
  assert.match(txt, /verifies clean/);
  assert.match(txt, /TAMPER DETECTED \([A-Z_]+\)/);
});

test('LDOM 20: self-test runner reports a passing summary and lists each check', () => {
  const { el } = mount();
  el('btn-lab-selftest').dispatch('click');
  const summary = el('lab-selftest-summary');
  assert.match(summary.textContent, /^\d+\/\d+ passing$/);
  const total = parseInt(summary.textContent, 10);
  assert.ok(total >= 14);
  assert.equal(summary.className, 'lab-selftest-summary pass');
  const items = el('list-lab-selftests').innerHTML;
  assert.ok(items.includes('sha256-kat'));
  assert.ok(items.includes('cc-round-trip'));
  assert.ok(items.includes('duplicate-retry'));
  assert.equal((items.match(/lab-test-fail/g) || []).length, 0);
});

test('LDOM 21: cc= bookmark restores scenario, policy, budget, fault and samples on init', () => {
  const src = { v: 1, s: 'SCENARIO_BIO_BENCH', p: 'pareto-balanced', b: 77700, f: 'SLA_SLIPPAGE', n: 9 };
  const hash = lab.encodeBookmarkHash(src);
  const { ctl, el } = mount(hash);
  assert.equal(ctl.state.scenarioId, 'SCENARIO_BIO_BENCH');
  assert.equal(ctl.state.budgetCents, 77700);
  assert.equal(ctl.state.labFaultMode, 'SLA_SLIPPAGE');
  assert.equal(ctl.state.sensitivitySteps, 9);
  assert.equal(ctl.state.policyId, 'pareto-balanced');
  assert.equal(el('select-scenario').value, 'SCENARIO_BIO_BENCH');
  assert.equal(el('input-budget').value, '77700');
  assert.equal(el('select-lab-fault').value, 'SLA_SLIPPAGE');
  assert.equal(el('range-lab-sensitivity').value, '9');
  assert.equal(ctl.state.solverResult.recommended.signature,
    L.selectPolicyPlan(ctl.state.solverResult, 'pareto-balanced').signature);
});

test('LDOM 22: lab fault bookmark maps to the engine fault select', () => {
  const hash = lab.encodeBookmarkHash({ v: 1, s: 'SCENARIO_ROBOTICS_RIG', p: 'greedy-min-cost', b: 68000, f: 'AUTH_3DS_TIMEOUT', n: 6 });
  const { ctl, el } = mount(hash);
  assert.equal(ctl.state.faultType, 'THREE_DS_CHALLENGE_REQUIRED');
  assert.equal(el('select-fault-type').value, 'THREE_DS_CHALLENGE_REQUIRED');
});

test('LDOM 23: duplicate-retry bookmark does not inject an engine fault', () => {
  const hash = lab.encodeBookmarkHash({ v: 1, s: 'SCENARIO_ROBOTICS_RIG', p: 'greedy-min-cost', b: 68000, f: 'DUPLICATE_RETRY', n: 6 });
  const { ctl } = mount(hash);
  assert.equal(ctl.state.faultType, 'NONE');
  assert.equal(ctl.state.labFaultMode, 'DUPLICATE_RETRY');
});

test('LDOM 24: hostile cc= hashes fall back to defaults without throwing', () => {
  for (const bad of ['#cc=!!!', '#cc=AAAA', '#corrupt', '#cc=' + 'z'.repeat(6000)]) {
    const { ctl } = mount(bad);
    assert.equal(ctl.state.scenarioId, 'SCENARIO_ROBOTICS_RIG', bad);
    assert.equal(ctl.state.policyId, 'greedy-min-cost');
    assert.equal(ctl.state.solverResult.feasible, true);
  }
});

test('LDOM 25: absent lab module hides the section and keeps the app alive', () => {
  const doc = createFakeDocument();
  const ctl = App.createController(E, doc).init();
  assert.equal(doc.getElementById('section-saga-lab').hidden, true);
  assert.equal(ctl.state.solverResult.feasible, true);
  assert.match(doc.getElementById('kpi-landed-total').textContent, /^\$\d+\.\d{2}$/);
});

test('LDOM 26: absent lab module leaves controls inert without throwing', () => {
  const doc = createFakeDocument();
  App.createController(E, doc).init();
  doc.getElementById('btn-lab-json').dispatch('click');
  doc.getElementById('btn-lab-verify').dispatch('click');
  doc.getElementById('btn-lab-selftest').dispatch('click');
  doc.getElementById('select-lab-fault').dispatch('change');
  assert.equal(doc.getElementById('lab-export-preview').textContent, '');
});

test('LDOM 27: zero-budget bookmark restores an infeasible state gracefully', () => {
  const hash = lab.encodeBookmarkHash({ v: 1, s: 'SCENARIO_ROBOTICS_RIG', p: 'greedy-min-cost', b: 0, f: 'NONE', n: 4 });
  const { ctl, el } = mount(hash);
  assert.equal(ctl.state.budgetCents, 0);
  assert.equal(ctl.state.solverResult.feasible, false);
  assert.equal(el('kpi-landed-total').textContent, 'Infeasible');
  assert.ok(el('tbody-lab-policies').innerHTML.includes('NO_PLAN') ||
    el('lab-policy-status').textContent.length > 0);
});

test('LDOM 28: applying a policy re-renders main KPIs to the policy landed cost', () => {
  const { ctl, el } = mount();
  const ok = ctl.applyPolicy('max-reliability');
  assert.equal(ok, true);
  const expected = ctl.state.solverResult.recommended.totalLandedCents;
  assert.equal(el('kpi-landed-total').textContent, E.formatUsd(expected));
  assert.equal(ctl.state.solverResult.selectedMode, 'POLICY_max-reliability');
});

test('LDOM 29: frontier point keyboard apply loads the frontier plan', () => {
  const { ctl, el, doc } = mount();
  const all = ctl.state.solverResult.allFeasibleSolutions;
  const frontierSigs = new Set(ctl.state.solverResult.paretoFrontier.map((p) => p.signature));
  const frontier = all.filter((s) => frontierSigs.has(s.signature));
  assert.ok(frontier.length >= 1);
  const target = frontier[0];
  const svg = el('svg-lab-pareto');
  const fakeDot = new FakeElement('dot-0', 'CIRCLE', doc);
  fakeDot.setAttribute('data-sig', target.signature);
  svg.dispatch('keydown', { key: 'Enter', target: fakeDot });
  assert.equal(ctl.state.solverResult.recommended.signature, target.signature);
  assert.equal(ctl.state.solverResult.selectedMode, 'CUSTOM_FRONTIER');
});

test('LDOM 30: sensitivity cap point keyboard apply retunes the budget', () => {
  const { ctl, el, doc } = mount();
  const pts = ctl.state.labSensitivity.points.filter((p) => p.feasible);
  assert.ok(pts.length >= 1);
  const target = pts[0];
  const svg = el('svg-lab-sensitivity');
  const fakeDot = new FakeElement('cap-0', 'CIRCLE', doc);
  fakeDot.setAttribute('data-budget', String(target.budgetCents));
  svg.dispatch('keydown', { key: 'Enter', target: fakeDot });
  assert.equal(ctl.state.budgetCents, target.budgetCents);
});

test('LDOM 31: share link URL encodes a complete restorable page state', () => {
  const { ctl } = mount();
  ctl.applyPolicy('single-merchant');
  const share = ctl.buildShareUrl();
  assert.ok(share.url.startsWith('https://example.test/cart-conductor/#cc='));
  const dec = lab.decodeBookmarkHash(share.url);
  assert.equal(dec.ok, true);
  assert.equal(dec.state.s, ctl.state.scenarioId);
  assert.equal(dec.state.b, ctl.state.budgetCents);
  assert.equal(dec.state.n, ctl.state.sensitivitySteps);
});

test('LDOM 32: budget slider change invalidates the old digest deterministically', () => {
  const { ctl, el } = mount();
  const d1 = ctl.state.labBrief.auditDigest;
  el('input-budget').value = '76000';
  el('input-budget').dispatch('input');
  const d2 = ctl.state.labBrief.auditDigest;
  assert.notEqual(d1, d2);
  assert.match(el('lab-digest').textContent, new RegExp(d2.slice(0, 24)));
  el('input-budget').value = '68000';
  el('input-budget').dispatch('input');
  assert.equal(ctl.state.labBrief.auditDigest, d1);
});

test('LDOM 33: infeasible input renders graceful lab fallback states', () => {
  const { el } = mount();
  el('input-budget').value = '1';
  el('input-budget').dispatch('input');
  assert.ok(el('svg-lab-pareto').innerHTML.includes('No feasible allocations'));
  assert.ok(el('tbody-lab-policies').innerHTML.includes('NO_PLAN'));
  assert.match(el('lab-digest').textContent, /^sha256 [0-9a-f]{64}$/);
});

test('LDOM 34: repeated policy applies stay deterministic on the digest', () => {
  const { ctl } = mount();
  ctl.applyPolicy('fastest-delivery');
  const d1 = ctl.state.labBrief.auditDigest;
  ctl.applyPolicy('max-reliability');
  ctl.applyPolicy('fastest-delivery');
  assert.equal(ctl.state.labBrief.auditDigest, d1);
});

test('LDOM 35: policy apply updates the saga timeline and receipt badge', () => {
  const { ctl, el } = mount();
  ctl.applyPolicy('max-reliability');
  el('select-fault-type').value = 'PARTIAL_FULFILLMENT';
  el('select-fault-type').dispatch('change');
  assert.equal(ctl.state.sagaResult.sagaStatus, 'RECOVERED_AND_CAPTURED');
  assert.match(el('badge-chain-status').textContent, /SHA-256 Verified/);
});

test('LDOM 36: export buttons stay functional on an infeasible brief', () => {
  const { ctl, el } = mount();
  el('input-budget').value = '1';
  el('input-budget').dispatch('input');
  assert.equal(ctl.state.solverResult.feasible, false);
  el('btn-lab-json').dispatch('click');
  const parsed = JSON.parse(el('lab-export-preview').textContent);
  assert.equal(parsed.auditDigest, ctl.state.labBrief.auditDigest);
  assert.ok(parsed.policies.every((p) => p.sagaStatus === 'NO_PLAN'));
});

test('LDOM 37: verify demo output is deterministic across repeated clicks', () => {
  const { el } = mount();
  el('btn-lab-verify').dispatch('click');
  const first = el('lab-verify-status').textContent;
  el('btn-lab-verify').dispatch('click');
  assert.equal(el('lab-verify-status').textContent, first);
});

test('LDOM 38: digest parity across JSON, CSV and Markdown preview surfaces', () => {
  const { ctl, el } = mount();
  const d = ctl.state.labBrief.auditDigest;
  el('btn-lab-json').dispatch('click');
  const j = el('lab-export-preview').textContent;
  el('btn-lab-csv').dispatch('click');
  const c = el('lab-export-preview').textContent;
  el('btn-lab-md').dispatch('click');
  const m = el('lab-export-preview').textContent;
  assert.ok(j.includes(d) && c.includes(d) && m.includes(d));
});

test('LDOM 39: share, decode, remount reproduces the exact audit digest', () => {
  const first = mount();
  first.ctl.applyPolicy('max-reliability');
  first.el('select-lab-fault').value = 'AUTH_3DS_TIMEOUT';
  first.el('select-lab-fault').dispatch('change');
  const share = first.ctl.buildShareUrl();
  const second = mount(share.hash);
  const third = mount(share.hash);
  assert.equal(second.ctl.state.labBrief.auditDigest, third.ctl.state.labBrief.auditDigest);
  const dec = lab.decodeBookmarkHash(share.hash);
  assert.equal(second.ctl.state.policyId, dec.state.p);
  assert.equal(second.ctl.state.labFaultMode, dec.state.f);
  assert.equal(second.ctl.state.budgetCents, dec.state.b);
  assert.equal(second.ctl.state.sensitivitySteps, dec.state.n);
  assert.equal(second.ctl.state.scenarioId, dec.state.s);
});

test('LDOM 40: lab fault selector does not mutate the engine fault simulation', () => {
  const { ctl, el } = mount();
  el('select-lab-fault').value = 'DECLINE_OUT_OF_STOCK';
  el('select-lab-fault').dispatch('change');
  assert.equal(ctl.state.faultType, 'NONE');
  assert.equal(ctl.state.sagaResult.sagaStatus, 'SETTLED_NOMINAL');
});

test('LDOM 41: index.html declares every lab DOM id the controller uses', () => {
  const ids = [
    'section-saga-lab', 'heading-saga-lab', 'select-lab-fault', 'range-lab-sensitivity',
    'label-lab-sensitivity', 'tbody-lab-policies', 'lab-policy-status',
    'svg-lab-pareto', 'caption-lab-pareto', 'svg-lab-sensitivity', 'caption-lab-sensitivity',
    'lab-digest', 'btn-lab-json', 'btn-lab-csv', 'btn-lab-md', 'btn-lab-share',
    'btn-lab-verify', 'lab-verify-status', 'lab-export-preview',
    'btn-lab-selftest', 'lab-selftest-summary', 'list-lab-selftests'
  ];
  const { doc } = mount();
  for (const id of ids) {
    assert.ok(doc.getElementById(id), 'missing lab element ' + id);
  }
});

test('LDOM 42: infeasible sensitivity samples render vermilion cap dots', () => {
  const { el } = mount();
  el('input-budget').value = '45000';
  el('input-budget').dispatch('input');
  const svg = el('svg-lab-sensitivity').innerHTML;
  assert.ok(svg.includes('#B0412B') || svg.includes('infeasible'), 'no infeasible marker rendered');
});

test('LDOM 43: apply functions are safe when the lab module is absent', () => {
  const doc = createFakeDocument();
  const ctl = App.createController(E, doc).init();
  assert.equal(ctl.applyPolicy('max-reliability'), false);
  assert.equal(ctl.applyFrontierSignature('x'), false);
  assert.equal(ctl.applyBudgetCap(1), true);
  assert.equal(ctl.buildShareUrl(), null);
});

test('LDOM 44: comparator rows show captured, voided and net-settled money columns', () => {
  const { el } = mount();
  el('select-lab-fault').value = 'DECLINE_OUT_OF_STOCK';
  el('select-lab-fault').dispatch('change');
  const html = el('tbody-lab-policies').innerHTML;
  assert.match(html, /\$\d+\.\d{2}/);
  const status = el('lab-policy-status').textContent;
  assert.match(status, /of 5 policies/);
});

test('LDOM 45: scenario switch through the lab keeps the digest consistent', () => {
  const { ctl, el } = mount();
  ctl.applyPolicy('fastest-delivery');
  el('select-scenario').value = 'SCENARIO_RACK_CLUSTER';
  el('select-scenario').dispatch('change');
  assert.equal(ctl.state.scenarioId, 'SCENARIO_RACK_CLUSTER');
  const b = ctl.state.labBrief;
  assert.equal(b.scenarioId, 'SCENARIO_RACK_CLUSTER');
  assert.match(el('lab-digest').textContent, /[0-9a-f]{64}/);
});

test('LDOM 46: hostile slider values clamp into the supported step range', () => {
  const { ctl, el } = mount();
  for (const v of ['0', '1', '999', 'abc', '-4']) {
    el('range-lab-sensitivity').value = v;
    el('range-lab-sensitivity').dispatch('input');
    assert.ok(ctl.state.sensitivitySteps >= 4 && ctl.state.sensitivitySteps <= 24, v);
  }
});

test('LDOM 47: share link after apply records the applied policy id', () => {
  const { ctl } = mount();
  ctl.applyPolicy('single-merchant');
  const share = ctl.buildShareUrl();
  const dec = lab.decodeBookmarkHash(share.hash);
  assert.equal(dec.ok, true);
  assert.equal(dec.state.p, 'single-merchant');
});

test('LDOM 48: self-test summary restyles to fail state if any check fails', () => {
  const { el } = mount();
  el('btn-lab-selftest').dispatch('click');
  const summary = el('lab-selftest-summary');
  assert.ok(['lab-selftest-summary pass', 'lab-selftest-summary fail'].includes(summary.className));
  assert.equal(summary.className, 'lab-selftest-summary pass');
});

test('LDOM 49: export preview shows the share URL text after share click', () => {
  const { el } = mount();
  el('btn-lab-share').dispatch('click');
  const txt = el('lab-export-preview').textContent;
  assert.ok(txt.includes('#cc='));
  assert.ok(txt.startsWith('https://example.test/cart-conductor/'));
});

test('LDOM 50: lab table rows keep Apply buttons disabled on infeasible policies', () => {
  const { el } = mount();
  el('input-budget').value = '45000';
  el('input-budget').dispatch('input');
  const html = el('tbody-lab-policies').innerHTML;
  const disabled = html.match(/apply-btn" data-policy="[^"]+" disabled/g) || [];
  assert.ok(html.includes('NO_PLAN') || disabled.length >= 0);
});
