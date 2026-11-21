'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CartConductorApp = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createController(engine, doc) {
    if (!engine) {
      throw new Error('createController requires CartConductorEngine');
    }
    const documentRef = doc || (typeof document !== 'undefined' ? document : null);
    if (!documentRef) {
      throw new Error('createController requires a document reference');
    }

    const state = {
      scenarioId: engine.SCENARIOS[0].id,
      strategy: 'LOWEST_COST',
      budgetCents: engine.SCENARIOS[0].defaultBudgetCents,
      maxSlaHours: engine.SCENARIOS[0].defaultSlaHours,
      minReliability: engine.SCENARIOS[0].defaultMinReliability,
      sensitivitySteps: 12,
      faultType: 'NONE',
      faultMerchantId: null,
      payloadView: 'PRIMARY_ORDER',
      solverResult: null,
      sagaResult: null,
      orderPayload: null,
      validationResult: null
    };

    function el(id) {
      return documentRef.getElementById(id);
    }

    function renderParetoSvg(solverResult) {
      const svg = el('svg-pareto-chart');
      if (!svg) return;
      if (!solverResult || !solverResult.feasible || solverResult.allFeasibleSolutions.length === 0) {
        svg.innerHTML = '<text x="310" y="160" text-anchor="middle" fill="#B0412B" font-family="IBM Plex Mono, monospace" font-size="13">No feasible allocation satisfies current budget and SLA constraints.</text>';
        return;
      }

      const W = 620;
      const H = 320;
      const padL = 68;
      const padR = 28;
      const padT = 24;
      const padB = 44;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;

      const all = solverResult.allFeasibleSolutions;
      const paretoSigs = new Set(solverResult.paretoFrontier.map((p) => p.signature));
      const activeSig = solverResult.recommended ? solverResult.recommended.signature : '';

      let minHours = Infinity, maxHours = -Infinity;
      let minCost = Infinity, maxCost = -Infinity;
      for (const s of all) {
        if (s.maxDeliveryHours < minHours) minHours = s.maxDeliveryHours;
        if (s.maxDeliveryHours > maxHours) maxHours = s.maxDeliveryHours;
        if (s.totalLandedCents < minCost) minCost = s.totalLandedCents;
        if (s.totalLandedCents > maxCost) maxCost = s.totalLandedCents;
      }

      if (minHours === maxHours) { minHours -= 4; maxHours += 4; }
      if (minCost === maxCost) { minCost -= 2000; maxCost += 2000; }

      const xFor = (hours) => padL + ((hours - minHours) / (maxHours - minHours)) * plotW;
      const yFor = (cents) => padT + plotH - ((cents - minCost) / (maxCost - minCost)) * plotH;

      const parts = [];
      parts.push('<rect x="' + padL + '" y="' + padT + '" width="' + plotW + '" height="' + plotH + '" fill="#FBF9F5" stroke="#D3CCC0" stroke-width="1"/>');

      // Horizontal cost gridlines
      for (let g = 0; g <= 4; g++) {
        const frac = g / 4;
        const y = (padT + plotH - frac * plotH).toFixed(1);
        const valCents = Math.round(minCost + frac * (maxCost - minCost));
        parts.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '" stroke="#E5DFD3" stroke-dasharray="3,3"/>');
        parts.push('<text x="' + (padL - 8) + '" y="' + (Number(y) + 4) + '" text-anchor="end" fill="#494C50" font-family="IBM Plex Mono, monospace" font-size="10">' + engine.formatUsd(valCents) + '</text>');
      }

      // Vertical SLA gridlines
      for (let g = 0; g <= 4; g++) {
        const frac = g / 4;
        const x = (padL + frac * plotW).toFixed(1);
        const valHours = Math.round(minHours + frac * (maxHours - minHours));
        parts.push('<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + plotH) + '" stroke="#E5DFD3" stroke-dasharray="3,3"/>');
        parts.push('<text x="' + x + '" y="' + (padT + plotH + 16) + '" text-anchor="middle" fill="#494C50" font-family="IBM Plex Mono, monospace" font-size="10">' + valHours + 'h</text>');
      }

      // Axis labels
      parts.push('<text x="' + (padL + plotW / 2) + '" y="' + (H - 8) + '" text-anchor="middle" fill="#141516" font-family="Plus Jakarta Sans, sans-serif" font-size="11" font-weight="600">Max Guaranteed Delivery Window (Hours)</text>');

      // Deduplicate coordinates for dominated points to keep SVG crisp
      const seenCoords = new Set();
      for (const s of all) {
        if (paretoSigs.has(s.signature)) continue;
        const cx = xFor(s.maxDeliveryHours).toFixed(1);
        const cy = yFor(s.totalLandedCents).toFixed(1);
        const key = cx + ',' + cy;
        if (seenCoords.has(key)) continue;
        seenCoords.add(key);
        parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="3.5" fill="#8A8478" opacity="0.65"/>');
      }

      // Connect 2D cost-vs-hours non-dominated step polyline
      const frontier2D = solverResult.paretoFrontier
        .slice()
        .sort((a, b) => a.maxDeliveryHours - b.maxDeliveryHours || a.totalLandedCents - b.totalLandedCents);

      if (frontier2D.length > 1) {
        const polyPts = frontier2D.map((p) => xFor(p.maxDeliveryHours).toFixed(1) + ',' + yFor(p.totalLandedCents).toFixed(1)).join(' ');
        parts.push('<polyline fill="none" stroke="#1B4D8E" stroke-width="2" points="' + polyPts + '"/>');
      }

      // Draw Pareto frontier points and highlight active selection
      for (const p of solverResult.paretoFrontier) {
        const cx = xFor(p.maxDeliveryHours).toFixed(1);
        const cy = yFor(p.totalLandedCents).toFixed(1);
        const isSelected = p.signature === activeSig;
        if (isSelected) {
          parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="8" fill="none" stroke="#1B6B50" stroke-width="2"/>');
          parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="#1B6B50"/>');
          parts.push('<text x="' + (Number(cx) + 10) + '" y="' + (Number(cy) - 8) + '" fill="#1B6B50" font-family="IBM Plex Mono, monospace" font-size="10" font-weight="600">' + engine.formatUsd(p.totalLandedCents) + ' / ' + p.maxDeliveryHours + 'h</text>');
        } else {
          parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="4.5" fill="#1B4D8E"/>');
        }
      }

      svg.innerHTML = parts.join('');
    }

    function renderAllocationTables(solverResult) {
      const tbodySku = el('tbody-sku-allocations');
      const tbodyUnits = el('tbody-merchant-units');
      const tbodyCatalog = el('tbody-catalog-merchants');

      if (!solverResult || !solverResult.feasible || !solverResult.recommended) {
        if (tbodySku) {
          tbodySku.innerHTML = '<tr><td colspan="6">No feasible cart under current budget (' + engine.formatUsd(state.budgetCents) + ') and SLA (' + state.maxSlaHours + 'h) ceiling. Increase budget or SLA window.</td></tr>';
        }
        if (tbodyUnits) {
          tbodyUnits.innerHTML = '<tr><td colspan="6">No PayPal purchase_units[] generated.</td></tr>';
        }
        return;
      }

      const plan = solverResult.recommended;

      if (tbodySku) {
        tbodySku.innerHTML = plan.itemAllocations.map((line) => (
          '<tr>' +
            '<td><strong>' + escapeHtml(line.sku) + '</strong><br><span class="text-muted">' + escapeHtml(line.name) + '</span></td>' +
            '<td class="num">' + line.qty + '</td>' +
            '<td><span class="badge-tag badge-navy">' + escapeHtml(line.merchantName) + '</span></td>' +
            '<td class="num">' + engine.formatUsd(line.unitPriceCents) + '</td>' +
            '<td class="num"><strong>' + engine.formatUsd(line.lineSubtotalCents) + '</strong></td>' +
            '<td class="num">' + line.deliveryHours + 'h</td>' +
          '</tr>'
        )).join('');
      }

      if (tbodyUnits) {
        tbodyUnits.innerHTML = plan.merchantBreakdowns.map((mb, idx) => {
          const refId = 'PU_' + String(idx + 1).padStart(2, '0') + '_' + mb.merchantId;
          const discBadge = mb.qualifiesBundle
            ? '<span class="badge-tag badge-green">-' + engine.formatUsd(mb.discountCents) + '</span>'
            : '<span class="badge-tag badge-muted">$0.00</span>';
          const shipHdl = mb.shippingCents + mb.handlingCents;
          const shipBadge = mb.qualifiesFreeShipping
            ? engine.formatUsd(shipHdl) + ' <span class="badge-tag badge-green">FREE SHIP</span>'
            : engine.formatUsd(shipHdl);

          return (
            '<tr>' +
              '<td><code>' + escapeHtml(refId) + '</code><br><strong>' + escapeHtml(mb.merchantName) + '</strong> (' + mb.distinctSkuCount + ' SKU)</td>' +
              '<td class="num">' + engine.formatUsd(mb.itemSubtotalCents) + '</td>' +
              '<td class="num">' + discBadge + '</td>' +
              '<td class="num">' + shipBadge + '</td>' +
              '<td class="num">' + engine.formatUsd(mb.taxCents) + '</td>' +
              '<td class="num"><strong>' + engine.formatUsd(mb.unitTotalCents) + '</strong></td>' +
            '</tr>'
          );
        }).join('');
      }

      if (tbodyCatalog) {
        const activeIds = new Set(plan.merchantBreakdowns.map((m) => m.merchantId));
        tbodyCatalog.innerHTML = engine.MERCHANTS.map((m) => {
          const isAllocated = activeIds.has(m.id);
          const statusBadge = isAllocated
            ? '<span class="badge-tag badge-green">ALLOCATED</span>'
            : '<span class="badge-tag badge-muted">STANDBY</span>';
          return (
            '<tr>' +
              '<td><strong>' + escapeHtml(m.name) + '</strong><br><code>' + escapeHtml(m.merchantId) + '</code></td>' +
              '<td class="num">' + (m.reliabilityScore * 100).toFixed(1) + '%</td>' +
              '<td class="num">' + engine.formatUsd(m.freeShippingThresholdCents) + '</td>' +
              '<td class="num">' + (m.bundleDiscountBps / 100).toFixed(1) + '% (' + m.bundleThresholdItems + '+ SKU)</td>' +
              '<td>' + statusBadge + '</td>' +
            '</tr>'
          );
        }).join('');
      }
    }

    function renderModeCardsAndKpis(solverResult) {
      const setTxt = (id, text) => {
        const node = el(id);
        if (node) node.textContent = text;
      };

      setTxt('label-budget-val', engine.formatUsd(state.budgetCents));
      setTxt('label-sla-val', state.maxSlaHours + 'h');

      const btnCost = el('btn-mode-lowest-cost');
      const btnFast = el('btn-mode-fastest');
      const btnFew = el('btn-mode-fewest');
      [
        [btnCost, 'LOWEST_COST'],
        [btnFast, 'FASTEST_DELIVERY'],
        [btnFew, 'FEWEST_SHIPMENTS']
      ].forEach(([btn, strat]) => {
        if (!btn) return;
        btn.className = 'mode-card' + (state.strategy === strat ? ' active' : '');
      });

      if (!solverResult || !solverResult.feasible) {
        setTxt('metric-mode-cost', 'Infeasible');
        setTxt('metric-mode-fast', 'Infeasible');
        setTxt('metric-mode-ship', 'Infeasible');
        setTxt('kpi-landed-total', 'Infeasible');
        setTxt('kpi-budget-headroom', 'Exceeds cap or SLA');
        setTxt('kpi-savings-greedy', '$0.00');
        setTxt('kpi-savings-single', 'No valid assignment');
        setTxt('kpi-delivery-hours', '--');
        setTxt('kpi-shipment-splits', '0 purchase_units[]');
        setTxt('kpi-reliability', '--');
        setTxt('kpi-pareto-count', '0 feasible');
        return;
      }

      const mCost = solverResult.modes.LOWEST_COST;
      const mFast = solverResult.modes.FASTEST_DELIVERY;
      const mShip = solverResult.modes.FEWEST_SHIPMENTS;

      setTxt('metric-mode-cost', engine.formatUsd(mCost.totalLandedCents));
      setTxt('meta-mode-cost', mCost.maxDeliveryHours + 'h SLA | ' + mCost.shipmentCount + ' unit(s)');

      setTxt('metric-mode-fast', mFast.maxDeliveryHours + 'h SLA');
      setTxt('meta-mode-fast', engine.formatUsd(mFast.totalLandedCents) + ' | ' + mFast.shipmentCount + ' unit(s)');

      setTxt('metric-mode-ship', mShip.shipmentCount + ' Purchase Unit' + (mShip.shipmentCount === 1 ? '' : 's'));
      setTxt('meta-mode-ship', engine.formatUsd(mShip.totalLandedCents) + ' | ' + mShip.maxDeliveryHours + 'h SLA');

      const rec = solverResult.recommended;
      setTxt('badge-solver-nodes', solverResult.nodesExplored + ' nodes / ' + solverResult.branchesPruned + ' pruned');
      setTxt('kpi-landed-total', engine.formatUsd(rec.totalLandedCents));
      setTxt('kpi-budget-headroom', engine.formatUsd(rec.budgetRemainingCents) + ' under buyer cap');

      const greedySign = solverResult.savingsVsGreedyCents >= 0 ? '+' : '';
      setTxt('kpi-savings-greedy', greedySign + engine.formatUsd(solverResult.savingsVsGreedyCents));
      const savingsEl = el('kpi-savings-greedy');
      if (savingsEl) {
        savingsEl.className = 'kpi-value ' +
          (solverResult.savingsVsGreedyCents < 0 ? 'kpi-negative' : 'kpi-positive');
      }
      const singleText = solverResult.baselines.singleMerchant
        ? (solverResult.savingsVsSingleMerchantCents >= 0 ? '+' : '') + engine.formatUsd(solverResult.savingsVsSingleMerchantCents) + ' vs single-merchant'
        : 'No single merchant stocks all SKUs';
      setTxt('kpi-savings-single', singleText);

      setTxt('kpi-delivery-hours', rec.maxDeliveryHours + 'h');
      setTxt('kpi-shipment-splits', rec.shipmentCount + ' PayPal purchase_units[]');
      setTxt('kpi-reliability', (rec.jointReliability * 100).toFixed(2) + '%');
      setTxt('kpi-pareto-count', solverResult.totalFeasibleCount + ' feasible / ' + solverResult.paretoFrontier.length + ' Pareto');
    }

    function syncFaultMerchantDropdown(solverResult) {
      const sel = el('select-fault-merchant');
      if (!sel) return;
      if (!solverResult || !solverResult.feasible || !solverResult.recommended) {
        sel.innerHTML = '<option value="">No allocated merchants</option>';
        state.faultMerchantId = null;
        return;
      }
      const breakdowns = solverResult.recommended.merchantBreakdowns;
      const validIds = breakdowns.map((m) => m.merchantId);
      if (!state.faultMerchantId || !validIds.includes(state.faultMerchantId)) {
        state.faultMerchantId = validIds[0];
      }
      sel.innerHTML = breakdowns.map((mb) => (
        '<option value="' + escapeHtml(mb.merchantId) + '">' +
          escapeHtml(mb.merchantName) + ' (' + engine.formatUsd(mb.unitTotalCents) + ')' +
        '</option>'
      )).join('');
      sel.value = state.faultMerchantId;
    }

    function renderSagaAndPayload() {
      const sagaBanner = el('saga-status-banner');
      const sagaTag = el('saga-status-tag');
      const sagaDelta = el('saga-cost-delta');
      const sagaSummary = el('saga-summary-text');
      const sagaHash = el('saga-head-hash');
      const sagaList = el('list-saga-timeline');
      const chainBadge = el('badge-chain-status');

      if (!state.solverResult || !state.solverResult.feasible) {
        if (sagaTag) sagaTag.textContent = 'SOLVER_INFEASIBLE';
        if (sagaSummary) sagaSummary.textContent = 'Relax budget cap or SLA window to run PayPal Orders v2 saga simulation.';
        if (sagaList) sagaList.innerHTML = '';
        const pre = el('pre-paypal-json');
        if (pre) pre.textContent = '// No feasible order payload.';
        return;
      }

      const saga = state.sagaResult;
      const chainCheck = engine.verifySagaReceiptChain(saga.timeline);
      const chainOk = chainCheck.valid && chainCheck.headHash === saga.receiptChainHeadHash;

      if (chainBadge) {
        chainBadge.textContent = chainOk
          ? 'SHA-256 Verified (' + chainCheck.verifiedSteps + ' steps)'
          : 'Chain Mismatch';
      }

      if (sagaBanner && sagaTag) {
        if (saga.sagaStatus === 'SETTLED_NOMINAL') {
          sagaBanner.className = 'saga-banner';
          sagaTag.className = 'saga-status-tag';
        } else if (saga.sagaStatus === 'RECOVERED_AND_CAPTURED') {
          sagaBanner.className = 'saga-banner fault-recovered';
          sagaTag.className = 'saga-status-tag tag-recovered';
        } else {
          sagaBanner.className = 'saga-banner fault-rolledback';
          sagaTag.className = 'saga-status-tag tag-rolledback';
        }
        sagaTag.textContent = saga.sagaStatus;
      }

      if (sagaDelta) {
        const cSign = saga.costDeltaCents >= 0 ? '+' : '';
        const hSign = saga.deliveryDeltaHours >= 0 ? '+' : '';
        sagaDelta.textContent = 'Cost Delta: ' + cSign + engine.formatUsd(saga.costDeltaCents) + ' | SLA Delta: ' + hSign + saga.deliveryDeltaHours + 'h';
      }

      if (sagaSummary) {
        if (saga.sagaStatus === 'SETTLED_NOMINAL') {
          sagaSummary.textContent = 'All ' + saga.captures.length + ' PayPal purchase units authorized, locked in warehouse inventory, and captured on first pass totaling ' + engine.formatUsd(saga.finalPlan.totalLandedCents) + '.';
        } else if (saga.sagaStatus === 'RECOVERED_AND_CAPTURED') {
          sagaSummary.textContent = 'Fault (' + saga.faultLabel + ') on ' + saga.faultedMerchantName + ' triggered automatic void of ' + saga.voidedAuthorizations.length + ' hold(s) and instant re-allocation within buyer budget cap (' + engine.formatUsd(saga.finalPlan.totalLandedCents) + ').';
        } else {
          sagaSummary.textContent = 'Fault (' + saga.faultLabel + ') on ' + saga.faultedMerchantName + ' exceeded fallback budget ceiling; coordinator voided all ' + saga.voidedAuthorizations.length + ' holds for zero stranded buyer liability.';
        }
      }

      if (sagaHash) {
        sagaHash.textContent = saga.receiptChainHeadHash;
      }

      if (sagaList) {
        sagaList.innerHTML = saga.timeline.map((ev) => {
          let stepCls = 'saga-step';
          if (ev.status === 'CAPTURED') stepCls += ' step-captured';
          if (ev.status === 'FAULT' || ev.status === 'VOIDED') stepCls += ' step-fault';
          const endpointTxt = ev.apiRecord
            ? '<code>' + escapeHtml(ev.apiRecord.method + ' ' + ev.apiRecord.endpoint) + ' (' + ev.apiRecord.httpStatus + ')</code>'
            : '<code>INTERNAL_SOLVER</code>';
          return (
            '<li class="' + stepCls + '">' +
              '<div class="saga-step-head">' +
                '<span>Step ' + ev.step + ' | ' + escapeHtml(ev.phase) + ' [' + escapeHtml(ev.status) + ']</span>' +
                endpointTxt +
              '</div>' +
              '<div class="saga-step-title">' + escapeHtml(ev.title) + '</div>' +
              '<p class="saga-step-detail">' + escapeHtml(ev.detail) + '</p>' +
              '<div class="saga-step-hash">sha256: ' + ev.eventHash.slice(0, 28) + '... (prev: ' + ev.prevHash.slice(0, 14) + '...)</div>' +
            '</li>'
          );
        }).join('');
      }

      // Inspector Metadata & JSON Viewer
      const activeOrder = (saga.replacementOrder && state.faultType !== 'NONE')
        ? saga.replacementOrder
        : state.orderPayload;
      const valCheck = engine.validatePayPalOrderPayload(activeOrder);
      state.validationResult = valCheck;

      const ordEl = el('inspect-order-id');
      const reqEl = el('inspect-request-id');
      const badgeEl = el('inspect-schema-badge');
      const preEl = el('pre-paypal-json');

      if (ordEl) ordEl.textContent = activeOrder.orderId;
      if (reqEl) reqEl.textContent = activeOrder.headers['PayPal-Request-Id'];
      if (badgeEl) {
        badgeEl.textContent = valCheck.valid
          ? 'VALID (' + valCheck.purchaseUnitCount + ' units, ' + engine.formatUsd(valCheck.grandTotalCents) + ')'
          : 'INVALID (' + valCheck.errors.length + ' errors)';
      }

      const tabPrimary = el('tab-btn-primary-order');
      const tabSaga = el('tab-btn-saga-calls');
      if (tabPrimary) tabPrimary.className = 'tab-btn' + (state.payloadView === 'PRIMARY_ORDER' ? ' active' : '');
      if (tabSaga) tabSaga.className = 'tab-btn' + (state.payloadView === 'SAGA_CALLS' ? ' active' : '');

      if (preEl) {
        if (state.payloadView === 'PRIMARY_ORDER') {
          preEl.textContent = JSON.stringify(activeOrder, null, 2);
        } else {
          preEl.textContent = JSON.stringify({
            sagaStatus: saga.sagaStatus,
            receiptChainHeadHash: saga.receiptChainHeadHash,
            voidedAuthorizations: saga.voidedAuthorizations,
            captures: saga.captures,
            restCalls: saga.apiCalls
          }, null, 2);
        }
      }
    }

    function renderCostWaterfall(solverResult) {
      const svg = el('svg-cost-waterfall');
      const list = el('list-cost-waterfall');
      const caption = el('caption-cost-waterfall');
      if (!svg) return;
      if (!solverResult || !solverResult.feasible || !solverResult.recommended) {
        svg.innerHTML = '<text x="240" y="120" text-anchor="middle" fill="#B0412B" font-family="monospace" font-size="12">No feasible plan to decompose.</text>';
        if (list) list.innerHTML = '';
        if (caption) caption.textContent = 'Relax the buyer constraints to rebuild the waterfall.';
        return;
      }
      const wf = engine.costWaterfall(solverResult.recommended);
      const W = 480, H = 240, padL = 16, padR = 16, padT = 22, padB = 34;
      const plotW = W - padL - padR, plotH = H - padT - padB;
      const positives = wf.stages.filter((s) => s.cents > 0);
      const maxRunning = Math.max.apply(null, wf.stages.map((s) => Math.abs(s.runningCents)).concat([wf.totalCents, 1]));
      const scaleY = (v) => plotH - (Math.abs(v) / maxRunning) * plotH;
      const colors = {
        ITEMS: '#1B4D8E',
        BUNDLE_DISCOUNT: '#1B6B50',
        SHIPPING: '#C8892A',
        HANDLING: '#7B5EA7',
        TAX: '#B0412B'
      };
      const barW = plotW / wf.stages.length;
      let running = 0;
      let bars = '';
      wf.stages.forEach((s, i) => {
        const x = padL + i * barW + barW * 0.18;
        const w = barW * 0.64;
        const from = running;
        running += s.cents;
        const yTop = padT + scaleY(Math.max(from, running));
        const h = Math.abs(scaleY(from) - scaleY(running));
        bars += '<rect x="' + x.toFixed(2) + '" y="' + yTop.toFixed(2) + '" width="' + w.toFixed(2) +
          '" height="' + h.toFixed(2) + '" fill="' + (colors[s.key] || '#141516') + '" opacity="0.88"><title>' +
          escapeHtml(s.label + ': ' + engine.formatUsd(s.cents)) + '</title></rect>';
        const labelY = padT + plotH + 16;
        bars += '<text x="' + (x + w / 2).toFixed(2) + '" y="' + labelY + '" text-anchor="middle" font-family="monospace" font-size="8" fill="#141516">' +
          escapeHtml(s.key.replace('_', ' ').slice(0, 9)) + '</text>';
      });
      const totalY = padT + scaleY(wf.totalCents);
      const grid = '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="#141516" stroke-width="1"/>' +
        '<line x1="' + padL + '" y1="' + totalY.toFixed(2) + '" x2="' + (W - padR) + '" y2="' + totalY.toFixed(2) + '" stroke="#1B6B50" stroke-dasharray="4 3" stroke-width="1"/>' +
        '<text x="' + (W - padR) + '" y="' + (totalY - 4).toFixed(2) + '" text-anchor="end" font-family="monospace" font-size="9" fill="#1B6B50">landed ' + escapeHtml(engine.formatUsd(wf.totalCents)) + '</text>';
      svg.innerHTML = grid + bars;
      if (list) {
        list.innerHTML = wf.stages.map((s) => (
          '<li><span>' + escapeHtml(s.label) + '</span><span>' + escapeHtml(engine.formatUsd(s.cents)) +
          ' (' + (s.shareOfLanded * 100).toFixed(1) + '%)</span></li>'
        )).join('');
      }
      if (caption) {
        caption.textContent = wf.ok
          ? 'Stages reconstruct ' + engine.formatUsd(wf.reconstructedCents) + ' exactly from ' + positives.length + ' positive stages. Discounts are negative.'
          : 'Reconstruction mismatch: staged total differs from landed total.';
      }
    }

    function renderSensitivityCurve() {
      const svg = el('svg-sensitivity');
      const caption = el('caption-sensitivity');
      if (!svg) return;
      const scenario = engine.getScenarioById(state.scenarioId);
      const curve = engine.budgetSensitivityCurve(scenario, {
        budgetCents: state.budgetCents,
        maxSlaHours: state.maxSlaHours,
        minReliability: state.minReliability,
        strategy: state.strategy
      }, state.sensitivitySteps);
      const W = 480, H = 240, padL = 44, padR = 64, padT = 20, padB = 40;
      const plotW = W - padL - padR, plotH = H - padT - padB;
      const maxCount = Math.max.apply(null, curve.points.map((p) => p.feasibleCount).concat([1]));
      const xAt = (i) => padL + (plotW * i) / (curve.points.length - 1);
      const yAt = (v) => padT + plotH - (v / maxCount) * plotH;
      const linePts = curve.points.map((p, i) => xAt(i).toFixed(2) + ',' + yAt(p.feasibleCount).toFixed(2)).join(' ');
      const costMax = Math.max.apply(null, curve.points.filter((p) => p.recommendedCostCents !== null).map((p) => p.recommendedCostCents).concat([1]));
      const costYAt = (v) => padT + plotH - (v / costMax) * plotH;
      const costPts = curve.points.map((p, i) => (p.recommendedCostCents === null ? null : xAt(i).toFixed(2) + ',' + costYAt(p.recommendedCostCents).toFixed(2))).filter(Boolean).join(' ');
      let dots = '';
      curve.points.forEach((p, i) => {
        dots += '<circle cx="' + xAt(i).toFixed(2) + '" cy="' + yAt(p.feasibleCount).toFixed(2) + '" r="3.2" fill="' +
          (p.feasible ? '#1B6B50' : '#B0412B') + '"><title>' + escapeHtml(engine.formatUsd(p.budgetCents) + ': ' + p.feasibleCount + ' feasible') + '</title></circle>';
      });
      const firstIdx = curve.firstFeasibleBudgetCents === null ? -1 : curve.points.findIndex((p) => p.budgetCents === curve.firstFeasibleBudgetCents);
      const marker = firstIdx >= 0
        ? '<line x1="' + xAt(firstIdx).toFixed(2) + '" y1="' + padT + '" x2="' + xAt(firstIdx).toFixed(2) + '" y2="' + (padT + plotH) + '" stroke="#1B4D8E" stroke-dasharray="3 3"/>' +
          '<text x="' + (xAt(firstIdx) + 3).toFixed(2) + '" y="' + (padT + 10) + '" font-family="monospace" font-size="8" fill="#1B4D8E">feasible</text>'
        : '';
      svg.innerHTML =
        '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="#141516"/>' +
        '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) + '" stroke="#141516"/>' +
        '<text x="6" y="' + (padT + 8) + '" font-family="monospace" font-size="8" fill="#141516">' + maxCount + ' plans</text>' +
        (costPts ? '<line x1="' + (W - padR) + '" y1="' + padT + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="#C8892A"/>' +
          '<text x="' + (W - padR + 4) + '" y="' + (padT + 8) + '" font-family="monospace" font-size="8" fill="#141516">' + escapeHtml(engine.formatUsd(costMax)) + '</text>' +
          '<text x="' + (W - padR + 4) + '" y="' + (padT + plotH) + '" font-family="monospace" font-size="8" fill="#141516">$0</text>' : '') +
        marker +
        '<polyline points="' + linePts + '" fill="none" stroke="#1B4D8E" stroke-width="2"/>' +
        (costPts ? '<polyline points="' + costPts + '" fill="none" stroke="#C8892A" stroke-width="1.5" stroke-dasharray="5 3"/>' : '') +
        dots +
        '<text x="' + (W / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-family="monospace" font-size="9" fill="#141516">blue uses the left count axis, gold uses the right cost axis</text>';
      if (caption) {
        caption.textContent = 'First sampled feasible cap ' + (curve.firstFeasibleBudgetCents === null ? 'not reached' : engine.formatUsd(curve.firstFeasibleBudgetCents)) +
          '. Minimum sampled cost ' + (curve.minimumSampledCostCents === null ? 'n/a' : engine.formatUsd(curve.minimumSampledCostCents)) +
          ' across ' + curve.steps + ' re-solves.';
      }
    }

    function renderDiagnostics(solverResult) {
      const list = el('list-diagnostics');
      const crowding = el('list-crowding');
      if (!list) return;
      const d = engine.solverDiagnostics(solverResult);
      if (!d.ok) {
        list.innerHTML = '<dt>Status</dt><dd>Unavailable</dd>';
        if (crowding) crowding.innerHTML = '';
        return;
      }
      const pct = (v) => v === null ? 'Unavailable (baseline infeasible)' : (v * 100).toFixed(2) + '%';
      list.innerHTML =
        '<dt>Nodes explored</dt><dd>' + d.nodesExplored.toLocaleString('en-US') + '</dd>' +
        '<dt>Branches pruned</dt><dd>' + d.branchesPruned.toLocaleString('en-US') + ' (' + pct(d.pruneRatio) + ')</dd>' +
        '<dt>Feasible allocations</dt><dd>' + d.feasibleCount.toLocaleString('en-US') + '</dd>' +
        '<dt>Pareto frontier size</dt><dd>' + d.frontierSize + '</dd>' +
        '<dt>Dominance compression</dt><dd>' + pct(d.dominanceCompressionRatio) + '</dd>' +
        (d.recommended
          ? '<dt>Savings vs greedy</dt><dd>' + pct(d.recommended.savingsVsGreedyRate) + '</dd>' +
            '<dt>Savings vs single vendor</dt><dd>' + pct(d.recommended.savingsVsSingleMerchantRate) + '</dd>'
          : '<dt>Recommendation</dt><dd>None (infeasible)</dd>');
      if (crowding) {
        const rows = d.frontierCrowding.slice(0, 8);
        crowding.innerHTML = rows.map((r) => (
          '<li><span>' + escapeHtml(r.signature.split('|')[0]) + '</span><span>' +
          (Number.isFinite(r.crowdingDistance) ? r.crowdingDistance.toFixed(3) : 'boundary') + '</span></li>'
        )).join('') || '<li><span>No frontier points</span><span></span></li>';
      }
    }

    function recomputeAndRender() {
      const scenario = engine.getScenarioById(state.scenarioId);
      const solverResult = engine.solveCart(scenario, {
        budgetCents: state.budgetCents,
        maxSlaHours: state.maxSlaHours,
        minReliability: state.minReliability,
        strategy: state.strategy
      });
      state.solverResult = solverResult;

      syncFaultMerchantDropdown(solverResult);

      if (solverResult.feasible && solverResult.recommended) {
        state.orderPayload = engine.buildPayPalOrderPayload(scenario, solverResult.recommended, {
          intent: 'AUTHORIZE',
          stageTag: 'PRIMARY_AUTH'
        });
        state.sagaResult = engine.simulateSagaExecution(scenario, solverResult, {
          faultType: state.faultType,
          targetMerchantId: state.faultMerchantId
        });
      } else {
        state.orderPayload = null;
        state.sagaResult = null;
      }

      renderModeCardsAndKpis(solverResult);
      renderAllocationTables(solverResult);
      renderParetoSvg(solverResult);
      renderCostWaterfall(solverResult);
      renderSensitivityCurve();
      renderDiagnostics(solverResult);
      renderSagaAndPayload();
    }

    function bindEvents() {
      const selScenario = el('select-scenario');
      if (selScenario) {
        selScenario.addEventListener('change', (e) => {
          const nextId = e.target.value;
          const sc = engine.getScenarioById(nextId);
          state.scenarioId = sc.id;
          state.budgetCents = sc.defaultBudgetCents;
          state.maxSlaHours = sc.defaultSlaHours;
          state.minReliability = sc.defaultMinReliability;
          state.faultMerchantId = null;

          const inpBudget = el('input-budget');
          const inpSla = el('input-sla');
          if (inpBudget) inpBudget.value = String(state.budgetCents);
          if (inpSla) inpSla.value = String(state.maxSlaHours);
          recomputeAndRender();
        });
      }

      const selStrategy = el('select-strategy');
      if (selStrategy) {
        selStrategy.addEventListener('change', (e) => {
          state.strategy = e.target.value;
          recomputeAndRender();
        });
      }

      const inpBudget = el('input-budget');
      if (inpBudget) {
        inpBudget.addEventListener('input', (e) => {
          state.budgetCents = Number(e.target.value);
          recomputeAndRender();
        });
      }

      const inpSla = el('input-sla');
      if (inpSla) {
        inpSla.addEventListener('input', (e) => {
          state.maxSlaHours = Number(e.target.value);
          recomputeAndRender();
        });
      }

      ['btn-mode-lowest-cost', 'btn-mode-fastest', 'btn-mode-fewest'].forEach((btnId) => {
        const btn = el(btnId);
        if (!btn) return;
        btn.addEventListener('click', () => {
          const strat = btn.getAttribute('data-strategy') || (btn.dataset && btn.dataset.strategy);
          if (strat) {
            state.strategy = strat;
            if (selStrategy) selStrategy.value = strat;
            recomputeAndRender();
          }
        });
      });

      const selFaultType = el('select-fault-type');
      if (selFaultType) {
        selFaultType.addEventListener('change', (e) => {
          state.faultType = e.target.value;
          recomputeAndRender();
        });
      }

      const selFaultMerch = el('select-fault-merchant');
      if (selFaultMerch) {
        selFaultMerch.addEventListener('change', (e) => {
          state.faultMerchantId = e.target.value;
          recomputeAndRender();
        });
      }

      const btnRunSaga = el('btn-run-saga');
      if (btnRunSaga) {
        btnRunSaga.addEventListener('click', () => {
          recomputeAndRender();
        });
      }

      const tabPrimary = el('tab-btn-primary-order');
      if (tabPrimary) {
        tabPrimary.addEventListener('click', () => {
          state.payloadView = 'PRIMARY_ORDER';
          renderSagaAndPayload();
        });
      }

      const tabSaga = el('tab-btn-saga-calls');
      if (tabSaga) {
        tabSaga.addEventListener('click', () => {
          state.payloadView = 'SAGA_CALLS';
          renderSagaAndPayload();
        });
      }

      const rangeSteps = el('range-sensitivity-steps');
      const outSteps = el('output-sensitivity-steps');
      if (rangeSteps) {
        rangeSteps.addEventListener('input', (e) => {
          const n = Number(e.target.value);
          state.sensitivitySteps = Number.isFinite(n) && n >= 4 ? Math.min(24, Math.floor(n)) : 12;
          if (outSteps) outSteps.textContent = String(state.sensitivitySteps);
          renderSensitivityCurve();
        });
      }
    }

    function init() {
      bindEvents();
      recomputeAndRender();
      return api;
    }

    const api = {
      state,
      init,
      recomputeAndRender,
      selectScenario(scenarioId) {
        const sc = engine.getScenarioById(scenarioId);
        state.scenarioId = sc.id;
        state.budgetCents = sc.defaultBudgetCents;
        state.maxSlaHours = sc.defaultSlaHours;
        state.minReliability = sc.defaultMinReliability;
        state.faultMerchantId = null;
        recomputeAndRender();
      },
      setStrategy(strategy) {
        state.strategy = strategy;
        recomputeAndRender();
      },
      injectFault(faultType, targetMerchantId) {
        state.faultType = faultType;
        if (targetMerchantId) state.faultMerchantId = targetMerchantId;
        recomputeAndRender();
      }
    };

    return api;
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.CartConductorEngine) {
    window.addEventListener('DOMContentLoaded', () => {
      window.cartConductorController = createController(window.CartConductorEngine, document).init();
    });
  }

  return { createController, escapeHtml };
});
