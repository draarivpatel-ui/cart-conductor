'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine.js');
const App = require('../app.js');
const { createFakeDocument } = require('./helpers/fake-dom.js');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function mount() {
  const doc = createFakeDocument();
  const ctl = App.createController(E, doc).init();
  return { doc, ctl, el: (id) => doc.getElementById(id) };
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

test('DOM 01: index.html has valid doctype, lang, charset, viewport, and descriptive title', () => {
  assert.match(html.trimStart(), /^<!DOCTYPE html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<title>CartConductor:[^<]{25,}<\/title>/);
});

test('DOM 02: styles.css defines the Stripe Press / FT ledger color tokens', () => {
  assert.match(css, /--bg-ledger:\s*#F7F4ED/i);
  assert.match(css, /--bg-panel:\s*#EDE8DD/i);
  assert.match(css, /--ink-primary:\s*#141516/i);
  assert.match(css, /--navy-settlement:\s*#1B4D8E/i);
  assert.match(css, /--green-authorized:\s*#1B6B50/i);
  assert.match(css, /--vermilion-rollback:\s*#C84B31/i);
});

test('DOM 03: package.json has zero external dependencies and uses node --test', () => {
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.equal(pkg.scripts.test, 'node --test');
});

test('DOM 04: createController validates arguments and initializes default Robotics Rig state', () => {
  assert.throws(() => App.createController(null), /CartConductorEngine/);
  const { ctl, el } = mount();
  assert.equal(ctl.state.scenarioId, 'SCENARIO_ROBOTICS_RIG');
  assert.equal(ctl.state.strategy, 'LOWEST_COST');
  assert.equal(ctl.state.solverResult.feasible, true);
  assert.match(el('kpi-landed-total').textContent, /^\$\d+\.\d{2}$/);
  assert.match(el('kpi-savings-greedy').textContent, /^\+\$\d+\.\d{2}$/);
});

test('DOM 05: SKU allocation and merchant purchase_unit tables populate on init', () => {
  const { el } = mount();
  const skuHtml = el('tbody-sku-allocations').innerHTML;
  const unitHtml = el('tbody-merchant-units').innerHTML;
  const catHtml = el('tbody-catalog-merchants').innerHTML;

  assert.match(skuHtml, /SKU-NPU-24TOPS/);
  assert.match(skuHtml, /SKU-LIDAR-SOLID/);
  assert.match(skuHtml, /SKU-SERVO-BUS/);
  assert.match(skuHtml, /SKU-PSU-GAN48V/);
  assert.match(unitHtml, /PU_01_/);
  assert.match(catHtml, /ALLOCATED/);
  assert.match(catHtml, /STANDBY/);
});

test('DOM 06: Pareto SVG chart renders gridlines, circles, and active selection highlight', () => {
  const { el } = mount();
  const svgHtml = el('svg-pareto-chart').innerHTML;
  assert.match(svgHtml, /<rect /);
  assert.match(svgHtml, /<circle /);
  assert.match(svgHtml, /#1B6B50/);
  assert.match(svgHtml, /Max Guaranteed Delivery Window/);
});

test('DOM 07: switching optimization strategy via dropdown or mode cards updates active plan', () => {
  const { ctl, el } = mount();
  const initialHours = ctl.state.solverResult.recommended.maxDeliveryHours;

  el('btn-mode-fastest').dispatch('click');
  assert.equal(ctl.state.strategy, 'FASTEST_DELIVERY');
  assert.ok(ctl.state.solverResult.recommended.maxDeliveryHours <= initialHours);
  assert.match(el('btn-mode-fastest').className, /active/);

  el('btn-mode-fewest').dispatch('click');
  assert.equal(ctl.state.strategy, 'FEWEST_SHIPMENTS');
  assert.equal(ctl.state.solverResult.recommended.shipmentCount, 1);
  assert.match(el('btn-mode-fewest').className, /active/);

  el('select-strategy').value = 'LOWEST_COST';
  el('select-strategy').dispatch('change');
  assert.equal(ctl.state.strategy, 'LOWEST_COST');
});

test('DOM 08: switching procurement scenario updates SKUs, budget slider, and SLA slider', () => {
  const { ctl, el } = mount();
  el('select-scenario').value = 'SCENARIO_BIO_BENCH';
  el('select-scenario').dispatch('change');

  assert.equal(ctl.state.scenarioId, 'SCENARIO_BIO_BENCH');
  assert.equal(ctl.state.budgetCents, 82000);
  assert.equal(ctl.state.maxSlaHours, 36);
  assert.match(el('tbody-sku-allocations').innerHTML, /SKU-PELTIER-ARRAY/);

  ctl.selectScenario('SCENARIO_RACK_CLUSTER');
  assert.equal(ctl.state.scenarioId, 'SCENARIO_RACK_CLUSTER');
  assert.match(el('tbody-sku-allocations').innerHTML, /SKU-QSFP-400G/);
});

test('DOM 09: adjusting budget and SLA range sliders updates solver state and handles infeasibility', () => {
  const { ctl, el } = mount();
  el('input-budget').value = '45000';
  el('input-budget').dispatch('input');
  assert.equal(ctl.state.budgetCents, 45000);
  assert.equal(ctl.state.solverResult.feasible, false);
  assert.equal(el('kpi-landed-total').textContent, 'Infeasible');
  assert.match(el('svg-pareto-chart').innerHTML, /No feasible allocation/);

  el('input-budget').value = '75000';
  el('input-budget').dispatch('input');
  el('input-sla').value = '44';
  el('input-sla').dispatch('input');
  assert.equal(ctl.state.solverResult.feasible, true);
});

test('DOM 10: injecting capture faults updates saga banner, timeline steps, and voided authorizations', () => {
  const { ctl, el } = mount();
  assert.equal(el('saga-status-tag').textContent, 'SETTLED_NOMINAL');

  el('select-fault-type').value = 'OUT_OF_STOCK_AT_CAPTURE';
  el('select-fault-type').dispatch('change');
  assert.equal(ctl.state.sagaResult.sagaStatus, 'RECOVERED_AND_CAPTURED');
  assert.equal(el('saga-status-tag').textContent, 'RECOVERED_AND_CAPTURED');
  assert.match(el('list-saga-timeline').innerHTML, /COMPENSATING_VOID/);
  assert.match(el('list-saga-timeline').innerHTML, /SAGA_REROUTE/);

  ctl.injectFault('THREE_DS_CHALLENGE_REQUIRED');
  assert.equal(ctl.state.sagaResult.faultType, 'THREE_DS_CHALLENGE_REQUIRED');
  assert.equal(el('saga-status-tag').textContent, 'RECOVERED_AND_CAPTURED');
});

test('DOM 11: PayPal JSON payload inspector toggles between Primary Orders v2 JSON and Saga REST Sequence', () => {
  const { ctl, el } = mount();
  const primaryJson = JSON.parse(el('pre-paypal-json').textContent);
  assert.equal(primaryJson.endpoint, 'POST /v2/checkout/orders');
  assert.ok(Array.isArray(primaryJson.body.purchase_units));

  el('tab-btn-saga-calls').dispatch('click');
  assert.equal(ctl.state.payloadView, 'SAGA_CALLS');
  const sagaJson = JSON.parse(el('pre-paypal-json').textContent);
  assert.equal(sagaJson.sagaStatus, 'SETTLED_NOMINAL');
  assert.ok(Array.isArray(sagaJson.restCalls));

  el('tab-btn-primary-order').dispatch('click');
  assert.equal(ctl.state.payloadView, 'PRIMARY_ORDER');
});

test('DOM 12: escapeHtml sanitizes HTML special characters', () => {
  assert.equal(App.escapeHtml('<script>"alert(\'x\')&"</script>'), '&lt;script&gt;&quot;alert(&#39;x&#39;)&amp;&quot;&lt;/script&gt;');
});

test('DOM 13: anti-slop check verifies zero em-dashes, zero en-dashes, and zero forbidden emails across all repo files', () => {
  const files = walkFiles(root);
  assert.ok(files.length >= 6);
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!['.js', '.html', '.css', '.json', '.md', '.txt'].includes(ext)) continue;
    const content = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    assert.equal(content.includes('\u2014'), false, 'Em-dash found in ' + rel);
    assert.equal(content.includes('\u2013'), false, 'En-dash found in ' + rel);
    assert.equal(/draarivpatel@gmail\.com/i.test(content), false, 'Forbidden email found in ' + rel);
  }
});

test('DOM 14: setStrategy programmatic helper updates state and re-renders', () => {
  const { ctl, el } = mount();
  ctl.setStrategy('FEWEST_SHIPMENTS');
  assert.equal(ctl.state.strategy, 'FEWEST_SHIPMENTS');
  assert.match(el('btn-mode-fewest').className, /active/);
});

test('DOM 15: selecting target fault merchant from dropdown triggers saga re-execution on that merchant', () => {
  const { ctl, el } = mount();
  // Switch to FASTEST_DELIVERY which uses multiple merchants
  ctl.setStrategy('FASTEST_DELIVERY');
  const merchList = ctl.state.solverResult.recommended.merchantBreakdowns;
  assert.ok(merchList.length >= 2);
  const secondMerchId = merchList[1].merchantId;

  el('select-fault-type').value = 'SHIPPING_SLA_SLIPPAGE';
  el('select-fault-type').dispatch('change');
  el('select-fault-merchant').value = secondMerchId;
  el('select-fault-merchant').dispatch('change');

  assert.equal(ctl.state.faultMerchantId, secondMerchId);
  assert.equal(ctl.state.sagaResult.faultedMerchantId, secondMerchId);
  assert.equal(ctl.state.sagaResult.sagaStatus, 'RECOVERED_AND_CAPTURED');
});

test('DOM 16: Execute Atomic Saga button re-runs simulation and preserves valid SHA-256 badge', () => {
  const { el } = mount();
  el('btn-run-saga').dispatch('click');
  assert.match(el('badge-chain-status').textContent, /^SHA-256 Verified \(\d+ steps\)$/);
});

test('DOM 17: full rollback state renders ROLLED_BACK_SAFE banner when budget leaves zero fallback room', () => {
  const { ctl, el } = mount();
  const minCost = ctl.state.solverResult.modes.LOWEST_COST.totalLandedCents;
  el('input-budget').value = String(minCost);
  el('input-budget').dispatch('input');
  el('select-fault-type').value = 'OUT_OF_STOCK_AT_CAPTURE';
  el('select-fault-type').dispatch('change');

  assert.equal(ctl.state.sagaResult.sagaStatus, 'ROLLED_BACK_SAFE');
  assert.equal(el('saga-status-tag').textContent, 'ROLLED_BACK_SAFE');
  assert.match(el('saga-status-banner').className, /fault-rolledback/);
});

test('DOM 18: inspector metadata displays deterministic Order ID, PayPal-Request-Id, and VALID badge', () => {
  const { el } = mount();
  assert.match(el('inspect-order-id').textContent, /^ORD-PP-[0-9A-F]{12}$/);
  assert.match(el('inspect-request-id').textContent, /^[0-9a-f-]{36}$/);
  assert.match(el('inspect-schema-badge').textContent, /^VALID \(\d+ units, \$\d+\.\d{2}\)$/);
});
