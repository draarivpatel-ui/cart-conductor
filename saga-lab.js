'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CartConductorSagaLab = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* ---------- Lab catalogs ---------- */

  const BRIEF_FORMAT = 'CARTCONDUCTOR_AUDIT_BRIEF_V1';
  const BRIEF_DISCLOSURE = 'Deterministic local simulation of catalog, checkout payloads and fault recovery. No live payment authorization or capture is performed.';
  const BOOKMARK_PREFIX = 'cc=';
  const BOOKMARK_VERSION = 1;
  const MAX_BUDGET_CENTS = 100000000;
  const MIN_SENSITIVITY_STEPS = 2;
  const MAX_SENSITIVITY_STEPS = 64;
  const DEFAULT_SENSITIVITY_STEPS = 12;
  const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const B64URL_RE = /^[A-Za-z0-9_-]+$/;
  const B64URL_CUT_RE = /[^A-Za-z0-9_-]/;
  const BLOCKED_STATE_KEYS = ['__proto__', 'prototype', 'constructor'];

  const POLICIES = Object.freeze([
    { id: 'greedy-min-cost', label: 'Greedy Min Cost', detail: 'Cheapest landed total under the hard cap.' },
    { id: 'single-merchant', label: 'Single Merchant', detail: 'Best one-vendor fulfillment when stock and cap allow.' },
    { id: 'pareto-balanced', label: 'Pareto Balanced', detail: 'Frontier knee balancing cost against joint reliability.' },
    { id: 'max-reliability', label: 'Max Reliability', detail: 'Highest joint clearing reliability still inside the cap.' },
    { id: 'fastest-delivery', label: 'Fastest Delivery', detail: 'Minimum guaranteed delivery window inside the cap.' }
  ]);
  const POLICY_IDS = Object.freeze(POLICIES.map((p) => p.id));

  const FAULT_MODES = Object.freeze([
    { id: 'NONE', label: 'Nominal Settlement', engineFault: 'NONE', kind: 'none' },
    { id: 'DECLINE_OUT_OF_STOCK', label: 'Inventory Decline at Capture', engineFault: 'OUT_OF_STOCK_AT_CAPTURE', kind: 'decline' },
    { id: 'AUTH_3DS_TIMEOUT', label: '3DS Challenge Timeout', engineFault: 'THREE_DS_CHALLENGE_REQUIRED', kind: 'timeout' },
    { id: 'SLA_SLIPPAGE', label: 'Dispatch SLA Timeout', engineFault: 'SHIPPING_SLA_SLIPPAGE', kind: 'timeout' },
    { id: 'PARTIAL_STOCK', label: 'Partial Stock Shortfall', engineFault: 'PARTIAL_FULFILLMENT', kind: 'partial-stock' },
    { id: 'DUPLICATE_RETRY', label: 'Duplicate Capture Retry', engineFault: 'NONE', kind: 'duplicate-retry' }
  ]);
  const FAULT_MODE_IDS = Object.freeze(FAULT_MODES.map((f) => f.id));

  function getPolicyById(id) {
    return POLICIES.find((p) => p.id === id) || null;
  }

  function getFaultModeById(id) {
    return FAULT_MODES.find((f) => f.id === id) || null;
  }

  function normalizeFaultMode(id) {
    return getFaultModeById(id) || FAULT_MODES[0];
  }

  /* ---------- Policy plan selection ---------- */

  function selectPolicyPlan(solveResult, policyId) {
    if (!solveResult || solveResult.feasible !== true) return null;
    if (policyId === 'greedy-min-cost') {
      return (solveResult.modes && solveResult.modes.LOWEST_COST) || null;
    }
    if (policyId === 'fastest-delivery') {
      return (solveResult.modes && solveResult.modes.FASTEST_DELIVERY) || null;
    }
    if (policyId === 'single-merchant') {
      const s = solveResult.baselines && solveResult.baselines.singleMerchant;
      return (s && s.feasible === true) ? s : null;
    }
    if (policyId === 'max-reliability') {
      const all = Array.isArray(solveResult.allFeasibleSolutions) ? solveResult.allFeasibleSolutions : [];
      let best = null;
      for (const s of all) {
        if (!best || s.jointReliability > best.jointReliability ||
          (s.jointReliability === best.jointReliability && s.totalLandedCents < best.totalLandedCents)) {
          best = s;
        }
      }
      return best;
    }
    if (policyId === 'pareto-balanced') {
      const frontier = Array.isArray(solveResult.paretoFrontier) ? solveResult.paretoFrontier : [];
      if (frontier.length === 0) return null;
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      for (const p of frontier) {
        if (p.totalLandedCents < minC) minC = p.totalLandedCents;
        if (p.totalLandedCents > maxC) maxC = p.totalLandedCents;
        if (p.jointReliability < minR) minR = p.jointReliability;
        if (p.jointReliability > maxR) maxR = p.jointReliability;
      }
      const spanC = maxC - minC;
      const spanR = maxR - minR;
      let best = null;
      let bestScore = Infinity;
      for (const p of frontier) {
        const nc = spanC <= 0 ? 0 : (p.totalLandedCents - minC) / spanC;
        const nr = spanR <= 0 ? 0 : (p.jointReliability - minR) / spanR;
        const score = nc + (1 - nr);
        if (score < bestScore - 1e-9 ||
          (Math.abs(score - bestScore) <= 1e-9 && best && p.totalLandedCents < best.totalLandedCents)) {
          best = p;
          bestScore = score;
        }
      }
      return best;
    }
    return null;
  }

  /* ---------- Saga settlement accounting ---------- */

  function summarizeSaga(saga) {
    const capturedCents = saga.captures.reduce((a, c) => a + c.amountCents, 0);
    const voidedCents = saga.voidedAuthorizations.reduce((a, v) => a + v.voidedAmountCents, 0);
    // Voids release authorized-but-uncaptured holds. No leg in this simulator
    // refunds post-capture money, so refunded cents are exactly zero.
    const refundedCents = 0;
    const netSettledCents = capturedCents - refundedCents;
    const expectedNetCents = saga.finalPlan ? saga.finalPlan.totalLandedCents : 0;
    const resolved = new Set();
    for (const c of saga.captures) resolved.add(c.merchantId);
    for (const v of saga.voidedAuthorizations) resolved.add(v.merchantId);
    const zeroLeak = saga.initialPlan.merchantBreakdowns.every((mb) => resolved.has(mb.merchantId));
    return {
      capturedCents,
      voidedCents,
      refundedCents,
      netSettledCents,
      expectedNetCents,
      conservationOk: netSettledCents === expectedNetCents,
      zeroLeak
    };
  }

  function retryReplayMatches(saga, replay) {
    if (!saga || !replay) return false;
    if (replay.receiptChainHeadHash !== saga.receiptChainHeadHash) return false;
    if (!replay.initialOrder || !saga.initialOrder) return false;
    if (replay.initialOrder.orderId !== saga.initialOrder.orderId) return false;
    if (replay.initialOrder.headers['PayPal-Request-Id'] !== saga.initialOrder.headers['PayPal-Request-Id']) return false;
    if (replay.captures.length !== saga.captures.length) return false;
    for (let i = 0; i < saga.captures.length; i++) {
      if (replay.captures[i].captureId !== saga.captures[i].captureId) return false;
      if (replay.captures[i].amountCents !== saga.captures[i].amountCents) return false;
    }
    return true;
  }

  function buildPolicyRow(engine, scenario, solve, constraints, policy, faultMode, opts) {
    const row = {
      policyId: policy.id,
      label: policy.label,
      feasible: false,
      sagaStatus: 'NO_PLAN',
      plan: null
    };
    if (!solve || solve.feasible !== true) return row;
    const plan = selectPolicyPlan(solve, policy.id);
    if (!plan || plan.feasible !== true) return row;
    if (policy.id === 'single-merchant' &&
      Number.isSafeInteger(constraints.budgetCents) && plan.totalLandedCents > constraints.budgetCents) {
      row.sagaStatus = 'OVER_BUDGET';
      row.totalLandedCents = plan.totalLandedCents;
      return row;
    }
    const syntheticSolve = Object.assign({}, solve, {
      recommended: plan,
      selectedMode: 'POLICY_' + policy.id
    });
    const allocatedIds = plan.merchantBreakdowns.map((m) => m.merchantId);
    const target = (opts.targetMerchantId && allocatedIds.includes(opts.targetMerchantId))
      ? opts.targetMerchantId
      : allocatedIds[0];
    let saga;
    let replay = null;
    try {
      saga = engine.simulateSagaExecution(scenario, syntheticSolve, {
        faultType: faultMode.engineFault,
        targetMerchantId: target
      });
      if (faultMode.kind === 'duplicate-retry') {
        replay = engine.simulateSagaExecution(scenario, syntheticSolve, {
          faultType: 'NONE',
          targetMerchantId: target
        });
      }
    } catch (err) {
      row.sagaStatus = 'SAGA_ERROR';
      row.error = String((err && err.message) || err);
      return row;
    }
    const chain = engine.verifySagaReceiptChain(saga.timeline);
    const sums = summarizeSaga(saga);
    row.feasible = true;
    row.sagaStatus = saga.sagaStatus;
    row.plan = plan;
    row.signature = plan.signature;
    row.totalLandedCents = plan.totalLandedCents;
    row.jointReliability = plan.jointReliability;
    row.maxDeliveryHours = plan.maxDeliveryHours;
    row.shipmentCount = plan.shipmentCount;
    row.saga = saga;
    row.capturedCents = sums.capturedCents;
    row.voidedCents = sums.voidedCents;
    row.refundedCents = sums.refundedCents;
    row.netSettledCents = sums.netSettledCents;
    row.expectedNetCents = sums.expectedNetCents;
    row.conservationOk = sums.conservationOk;
    row.zeroLeak = sums.zeroLeak;
    row.chainValid = chain.valid === true && chain.headHash === saga.receiptChainHeadHash;
    row.receiptChainHeadHash = saga.receiptChainHeadHash;
    row.costDeltaCents = saga.costDeltaCents;
    row.deliveryDeltaHours = saga.deliveryDeltaHours;
    row.voidedCount = saga.voidedAuthorizations.length;
    row.capturedCount = saga.captures.length;
    row.faultedMerchantId = saga.faultedMerchantId;
    row.idempotentRetry = replay ? retryReplayMatches(saga, replay) : null;
    return row;
  }

  function comparePolicies(engine, scenarioInput, options) {
    if (!engine) {
      throw new Error('comparePolicies requires CartConductorEngine');
    }
    const scenario = typeof scenarioInput === 'string'
      ? engine.getScenarioById(scenarioInput)
      : (scenarioInput || engine.SCENARIOS[0]);
    if (!scenario || !Array.isArray(scenario.items)) {
      throw new Error('comparePolicies requires a valid scenario');
    }
    const opts = (options && typeof options === 'object' && !Array.isArray(options)) ? options : {};
    const constraints = {
      budgetCents: Number.isSafeInteger(opts.budgetCents) && opts.budgetCents >= 0 && opts.budgetCents <= MAX_BUDGET_CENTS
        ? opts.budgetCents
        : scenario.defaultBudgetCents,
      maxSlaHours: Number.isFinite(opts.maxSlaHours) ? opts.maxSlaHours : scenario.defaultSlaHours,
      minReliability: Number.isFinite(opts.minReliability) ? opts.minReliability : scenario.defaultMinReliability,
      strategy: 'LOWEST_COST',
      excludedMerchants: opts.excludedMerchants !== undefined ? opts.excludedMerchants : []
    };
    const faultMode = normalizeFaultMode(opts.faultMode);
    let solve;
    try {
      solve = engine.solveCart(scenario, constraints);
    } catch (err) {
      return {
        ok: false,
        reason: 'SOLVER_ERROR',
        error: String((err && err.message) || err),
        scenarioId: scenario.id,
        faultMode: faultMode.id,
        constraints,
        rows: POLICIES.map((p) => ({ policyId: p.id, label: p.label, feasible: false, sagaStatus: 'NO_PLAN', plan: null })),
        solveResult: null
      };
    }
    const rows = POLICIES.map((policy) =>
      buildPolicyRow(engine, scenario, solve, constraints, policy, faultMode, opts));
    return {
      ok: rows.some((r) => r.feasible),
      scenarioId: scenario.id,
      faultMode: faultMode.id,
      faultModeLabel: faultMode.label,
      constraints,
      rows,
      solveResult: solve
    };
  }

  /* ---------- Normalized Pareto plot data (cost vs reliability) ---------- */

  function paretoPlotData(engine, solveResult) {
    const empty = {
      ok: false,
      reason: 'NO_FEASIBLE_SOLUTIONS',
      points: [],
      frontierCount: 0,
      xMin: 0,
      xMax: 1,
      yMin: 0,
      yMax: 1,
      policyMarks: {}
    };
    if (!engine) {
      throw new Error('paretoPlotData requires CartConductorEngine');
    }
    if (!solveResult || solveResult.feasible !== true ||
      !Array.isArray(solveResult.allFeasibleSolutions) || solveResult.allFeasibleSolutions.length === 0) {
      return empty;
    }
    const all = solveResult.allFeasibleSolutions.filter((s) =>
      s && typeof s === 'object' &&
      Number.isFinite(s.jointReliability) &&
      Number.isFinite(s.totalLandedCents));
    if (all.length === 0) return empty;
    const frontierSet = new Set(
      (Array.isArray(solveResult.paretoFrontier) ? solveResult.paretoFrontier : [])
        .map((p) => (p && typeof p === 'object' ? p.signature : null))
        .filter((sig) => typeof sig === 'string'));
    const policyMarks = {};
    for (const pol of POLICIES) {
      const plan = selectPolicyPlan(solveResult, pol.id);
      if (plan && typeof plan.signature === 'string') {
        (policyMarks[plan.signature] = policyMarks[plan.signature] || []).push(pol.id);
      }
    }
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const s of all) {
      if (s.jointReliability < minR) minR = s.jointReliability;
      if (s.jointReliability > maxR) maxR = s.jointReliability;
      if (s.totalLandedCents < minC) minC = s.totalLandedCents;
      if (s.totalLandedCents > maxC) maxC = s.totalLandedCents;
    }
    const spanR = maxR - minR;
    const spanC = maxC - minC;
    const selectedSig = (solveResult.recommended && typeof solveResult.recommended.signature === 'string')
      ? solveResult.recommended.signature
      : null;
    const points = all.map((s) => ({
      signature: s.signature,
      reliability: s.jointReliability,
      costCents: s.totalLandedCents,
      x: Number((spanR <= 0 ? 0.5 : (s.jointReliability - minR) / spanR).toFixed(6)),
      y: Number((spanC <= 0 ? 0.5 : (s.totalLandedCents - minC) / spanC).toFixed(6)),
      frontier: frontierSet.has(s.signature),
      policyIds: policyMarks[s.signature] || [],
      selected: s.signature === selectedSig
    }));
    return {
      ok: true,
      points,
      frontierCount: frontierSet.size,
      xMin: minR,
      xMax: maxR,
      yMin: minC,
      yMax: maxC,
      policyMarks
    };
  }

  /* ---------- Budget sensitivity plot data ---------- */

  function sensitivityPlotData(engine, scenarioInput, constraints, steps) {
    if (!engine) {
      throw new Error('sensitivityPlotData requires CartConductorEngine');
    }
    const scenario = typeof scenarioInput === 'string'
      ? engine.getScenarioById(scenarioInput)
      : (scenarioInput || engine.SCENARIOS[0]);
    if (!scenario || !Array.isArray(scenario.items)) {
      throw new Error('sensitivityPlotData requires a valid scenario');
    }
    const cons = (constraints && typeof constraints === 'object') ? constraints : {};
    const baseBudget = Number.isSafeInteger(cons.budgetCents) ? cons.budgetCents : scenario.defaultBudgetCents;
    const curve = engine.budgetSensitivityCurve(scenario, cons, steps);
    if (!curve.ok) {
      return {
        ok: false,
        reason: curve.reason,
        scenarioId: scenario.id,
        points: [],
        baseBudgetCents: baseBudget
      };
    }
    const solved = engine.solveCart(scenario, cons);
    const greedy = solved.baselines && solved.baselines.greedyUnbundled;
    const single = solved.baselines && solved.baselines.singleMerchant;
    const greedyTotal = greedy && greedy.feasible ? greedy.totalLandedCents : null;
    const singleTotal = single && single.feasible ? single.totalLandedCents : null;
    const points = curve.points.map((p) => ({
      index: p.index,
      budgetCents: p.budgetCents,
      feasible: p.feasible,
      costCents: p.recommendedCostCents,
      feasibleCount: p.feasibleCount,
      savingsVsGreedyCents: (p.recommendedCostCents !== null && greedyTotal !== null)
        ? greedyTotal - p.recommendedCostCents
        : null,
      savingsVsSingleMerchantCents: (p.recommendedCostCents !== null && singleTotal !== null)
        ? singleTotal - p.recommendedCostCents
        : null
    }));
    return {
      ok: true,
      scenarioId: scenario.id,
      points,
      steps: curve.steps,
      lowCents: curve.lowCents,
      highCents: curve.highCents,
      baseBudgetCents: baseBudget,
      firstFeasibleBudgetCents: curve.firstFeasibleBudgetCents,
      minimumSampledCostCents: curve.minimumSampledCostCents,
      greedyTotalCents: greedyTotal,
      singleMerchantTotalCents: singleTotal
    };
  }

  /* ---------- Canonical JSON, digest, audited brief ---------- */

  function canonicalize(value, seen) {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      const visited = seen || new Set();
      if (visited.has(value)) return null;
      visited.add(value);
      let out;
      if (Array.isArray(value)) {
        out = value.map((v) => canonicalize(v, visited));
      } else {
        out = {};
        const keys = Object.keys(value).sort();
        for (const k of keys) {
          if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
          if (BLOCKED_STATE_KEYS.indexOf(k) >= 0) continue;
          const v = value[k];
          if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
          out[k] = canonicalize(v, visited);
        }
      }
      visited.delete(value);
      return out;
    }
    return null;
  }

  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(value, k)) deepFreeze(value[k]);
      }
      return Object.freeze(value);
    }
    return value;
  }

  function stripDigest(brief) {
    const out = {};
    for (const k of Object.keys(brief)) {
      if (k !== 'auditDigest' && Object.prototype.hasOwnProperty.call(brief, k)) {
        out[k] = brief[k];
      }
    }
    return out;
  }

  function digestOfPayload(engine, payloadSansDigest) {
    return engine.sha256Hex(BRIEF_FORMAT + '|' + canonicalJson(payloadSansDigest));
  }

  function buildAuditPayload(engine, snapshot) {
    const snap = (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) ? snapshot : {};
    const scenario = engine.getScenarioById(snap.scenarioId);
    const cons = (snap.constraints && typeof snap.constraints === 'object') ? snap.constraints : {};
    const compare = (snap.compare && typeof snap.compare === 'object') ? snap.compare : null;
    const sens = (snap.sensitivity && typeof snap.sensitivity === 'object') ? snap.sensitivity : null;

    const policies = (compare && Array.isArray(compare.rows) ? compare.rows : []).map((r) => ({
      policyId: typeof r.policyId === 'string' ? r.policyId : 'unknown',
      feasible: r.feasible === true,
      sagaStatus: typeof r.sagaStatus === 'string' ? r.sagaStatus : 'NO_PLAN',
      totalLandedCents: Number.isSafeInteger(r.totalLandedCents) ? r.totalLandedCents : null,
      jointReliability: Number.isFinite(r.jointReliability) ? r.jointReliability : null,
      maxDeliveryHours: Number.isFinite(r.maxDeliveryHours) ? r.maxDeliveryHours : null,
      shipmentCount: Number.isSafeInteger(r.shipmentCount) ? r.shipmentCount : null,
      capturedCents: Number.isSafeInteger(r.capturedCents) ? r.capturedCents : 0,
      voidedCents: Number.isSafeInteger(r.voidedCents) ? r.voidedCents : 0,
      refundedCents: Number.isSafeInteger(r.refundedCents) ? r.refundedCents : 0,
      netSettledCents: Number.isSafeInteger(r.netSettledCents) ? r.netSettledCents : 0,
      conservationOk: r.conservationOk === true,
      zeroLeak: r.zeroLeak === true,
      chainValid: r.chainValid === true,
      idempotentRetry: r.idempotentRetry === undefined ? null : r.idempotentRetry
    }));

    const activePolicy = getPolicyById(snap.activePolicy) ? snap.activePolicy : 'greedy-min-cost';
    const activeRow = policies.find((r) => r.policyId === activePolicy) || null;

    return {
      format: BRIEF_FORMAT,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      constraints: {
        budgetCents: Number.isSafeInteger(cons.budgetCents) && cons.budgetCents >= 0
          ? cons.budgetCents
          : scenario.defaultBudgetCents,
        maxSlaHours: Number.isFinite(cons.maxSlaHours) ? cons.maxSlaHours : scenario.defaultSlaHours,
        minReliability: Number.isFinite(cons.minReliability) ? cons.minReliability : scenario.defaultMinReliability
      },
      activePolicy,
      faultMode: normalizeFaultMode(snap.faultMode).id,
      policies,
      settlement: activeRow ? {
        policyId: activeRow.policyId,
        sagaStatus: activeRow.sagaStatus,
        capturedCents: activeRow.capturedCents,
        voidedCents: activeRow.voidedCents,
        refundedCents: activeRow.refundedCents,
        netSettledCents: activeRow.netSettledCents,
        conservationOk: activeRow.conservationOk,
        zeroLeak: activeRow.zeroLeak,
        chainValid: activeRow.chainValid
      } : null,
      sensitivity: sens && sens.ok === true ? {
        steps: sens.steps,
        lowCents: sens.lowCents,
        highCents: sens.highCents,
        baseBudgetCents: sens.baseBudgetCents,
        firstFeasibleBudgetCents: sens.firstFeasibleBudgetCents,
        minimumSampledCostCents: sens.minimumSampledCostCents,
        greedyTotalCents: sens.greedyTotalCents,
        singleMerchantTotalCents: sens.singleMerchantTotalCents
      } : null,
      disclosure: BRIEF_DISCLOSURE
    };
  }

  function verifyAuditBrief(engine, brief) {
    if (!engine) {
      throw new Error('verifyAuditBrief requires CartConductorEngine');
    }
    if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
      return { ok: false, reason: 'MALFORMED_BRIEF', expectedDigest: null, actualDigest: null };
    }
    if (typeof brief.auditDigest !== 'string' || !/^[0-9a-f]{64}$/.test(brief.auditDigest)) {
      return {
        ok: false,
        reason: 'MISSING_DIGEST',
        expectedDigest: null,
        actualDigest: typeof brief.auditDigest === 'string' ? brief.auditDigest : null
      };
    }
    const expected = digestOfPayload(engine, stripDigest(brief));
    return {
      ok: expected === brief.auditDigest,
      reason: expected === brief.auditDigest ? 'OK' : 'DIGEST_MISMATCH',
      expectedDigest: expected,
      actualDigest: brief.auditDigest
    };
  }

  function tamperAuditBrief(brief) {
    if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return brief;
    let clone;
    try {
      clone = JSON.parse(JSON.stringify(brief));
    } catch (e) {
      return brief;
    }
    if (!clone || typeof clone !== 'object' || Array.isArray(clone)) return brief;
    if (Array.isArray(clone.policies) && clone.policies.length > 0 &&
      clone.policies[0] && typeof clone.policies[0] === 'object' &&
      Number.isSafeInteger(clone.policies[0].capturedCents)) {
      clone.policies[0].capturedCents += 1;
    } else {
      clone.scenarioTitle = String(clone.scenarioTitle || '') + ' ';
    }
    return clone;
  }

  /* ---------- Formula-safe CSV + export formats ---------- */

  function csvEscapeCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    const formulaStart = /^[=+\-@\t\r]/.test(s);
    const needsQuote = /[",\n\r]/.test(s);
    if (formulaStart) s = "'" + s;
    if (needsQuote) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportJsonBrief(stamped) {
    if (!stamped || typeof stamped !== 'object') return 'null';
    return JSON.stringify(stamped, null, 2);
  }

  function exportCsvBrief(stamped) {
    if (!stamped || typeof stamped !== 'object') return '';
    const lines = [];
    lines.push('# cartconductor audited procurement brief');
    lines.push('# format ' + stamped.format);
    lines.push('# sha256 ' + stamped.auditDigest);
    lines.push('# scenario ' + stamped.scenarioId + ' fault ' + stamped.faultMode + ' policy ' + stamped.activePolicy);
    lines.push('# ' + stamped.disclosure);
    lines.push('policy_id,saga_status,feasible,total_landed_cents,joint_reliability,max_delivery_hours,shipment_count,captured_cents,voided_cents,refunded_cents,net_settled_cents,conservation_ok,zero_leak,chain_valid,idempotent_retry');
    for (const r of (stamped.policies || [])) {
      lines.push([
        r.policyId,
        r.sagaStatus,
        r.feasible,
        r.totalLandedCents,
        r.jointReliability,
        r.maxDeliveryHours,
        r.shipmentCount,
        r.capturedCents,
        r.voidedCents,
        r.refundedCents,
        r.netSettledCents,
        r.conservationOk,
        r.zeroLeak,
        r.chainValid,
        r.idempotentRetry
      ].map(csvEscapeCell).join(','));
    }
    return lines.join('\n') + '\n';
  }

  function exportMarkdownBrief(engine, stamped) {
    if (!engine) {
      throw new Error('exportMarkdownBrief requires CartConductorEngine');
    }
    if (!stamped || typeof stamped !== 'object' || Array.isArray(stamped)) return '';
    const fmt = (c) => (Number.isSafeInteger(c) ? '$' + engine.centsToDollars(c) : 'n/a');
    const cons = (stamped.constraints && typeof stamped.constraints === 'object') ? stamped.constraints : {};
    const sens = (stamped.sensitivity && typeof stamped.sensitivity === 'object') ? stamped.sensitivity : null;
    const lines = [];
    lines.push('# CartConductor Audited Procurement Brief');
    lines.push('');
    lines.push('Scenario: ' + String(stamped.scenarioTitle || 'n/a') + ' (' + String(stamped.scenarioId || 'n/a') + ')');
    lines.push('Constraints: budget ' + fmt(cons.budgetCents) +
      ', SLA ' + String(cons.maxSlaHours === undefined ? 'n/a' : cons.maxSlaHours) +
      'h, reliability floor ' + String(cons.minReliability === undefined ? 'n/a' : cons.minReliability));
    lines.push('Fault mode: ' + String(stamped.faultMode || 'n/a') + '. Active policy: ' + String(stamped.activePolicy || 'n/a') + '.');
    lines.push('');
    lines.push('| Policy | Saga status | Landed | Captured | Voided | Net settled | Proofs |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of (Array.isArray(stamped.policies) ? stamped.policies : [])) {
      const proofs = [
        r.chainValid ? 'chain' : 'no-chain',
        r.conservationOk ? 'conserved' : 'drift',
        r.zeroLeak ? 'zero-leak' : 'leak'
      ].join(', ');
      lines.push('| ' + r.policyId + ' | ' + r.sagaStatus + ' | ' + fmt(r.totalLandedCents) +
        ' | ' + fmt(r.capturedCents) + ' | ' + fmt(r.voidedCents) + ' | ' + fmt(r.netSettledCents) +
        ' | ' + proofs + ' |');
    }
    if (sens) {
      lines.push('');
      lines.push('Sensitivity: first feasible sampled cap ' + fmt(sens.firstFeasibleBudgetCents) +
        ', minimum sampled cost ' + fmt(sens.minimumSampledCostCents) +
        ' across ' + String(sens.steps === undefined ? 'n/a' : sens.steps) + ' re-solves.');
    }
    lines.push('');
    lines.push(String(stamped.disclosure || ''));
    lines.push('');
    lines.push('sha256: ' + stamped.auditDigest);
    lines.push('');
    return lines.join('\n');
  }

  /* ---------- Strict #cc= bookmark codec ---------- */

  function utf8EncodeBytes(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length &&
        s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) < 0xe000) {
        const c2 = s.charCodeAt(++i);
        const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else if (c >= 0xd800 && c < 0xe000) {
        out.push(0xef, 0xbf, 0xbd);
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function utf8DecodeStrict(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < 0x80) {
        s += String.fromCharCode(b);
        continue;
      }
      let cp;
      let need;
      if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; need = 1; }
      else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; need = 2; }
      else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; need = 3; }
      else return null;
      if (i + need >= bytes.length) return null;
      for (let j = 1; j <= need; j++) {
        const cb = bytes[i + j];
        if ((cb & 0xc0) !== 0x80) return null;
        cp = (cp << 6) | (cb & 0x3f);
      }
      i += need;
      if ((need === 1 && cp < 0x80) || (need === 2 && cp < 0x800) || (need === 3 && cp < 0x10000)) return null;
      if (cp >= 0xd800 && cp <= 0xdfff) return null;
      if (cp > 0x10ffff) return null;
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      } else {
        s += String.fromCharCode(cp);
      }
    }
    return s;
  }

  function b64urlEncodeText(str) {
    const bytes = utf8EncodeBytes(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : null;
      const c = i + 2 < bytes.length ? bytes[i + 2] : null;
      out += B64URL_ALPHABET[a >> 2];
      out += B64URL_ALPHABET[((a & 3) << 4) | (b === null ? 0 : b >> 4)];
      out += b === null ? '' : B64URL_ALPHABET[((b & 15) << 2) | (c === null ? 0 : c >> 6)];
      out += c === null ? '' : B64URL_ALPHABET[c & 63];
    }
    return out;
  }

  function b64urlDecodeText(token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096 || !B64URL_RE.test(token)) {
      return null;
    }
    const vals = [];
    for (let i = 0; i < token.length; i++) {
      vals.push(B64URL_ALPHABET.indexOf(token[i]));
    }
    if (vals.length % 4 === 1) return null;
    const bytes = [];
    for (let i = 0; i < vals.length; i += 4) {
      const a = vals[i];
      const b = vals[i + 1];
      if (b === undefined) return null;
      bytes.push((a << 2) | (b >> 4));
      const c = vals[i + 2];
      if (c !== undefined) {
        bytes.push(((b & 15) << 4) | (c >> 2));
        const d = vals[i + 3];
        if (d !== undefined) {
          bytes.push(((c & 3) << 6) | d);
        }
      }
    }
    return utf8DecodeStrict(bytes);
  }

  function normalizeBookmarkState(engine, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    for (const k of Object.keys(raw)) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) return null;
      if (BLOCKED_STATE_KEYS.indexOf(k) >= 0) return null;
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'v') || raw.v !== BOOKMARK_VERSION) return null;
    if (!Object.prototype.hasOwnProperty.call(raw, 's') || typeof raw.s !== 'string') return null;
    const scenario = engine.getScenarioById(raw.s);
    if (!scenario || scenario.id !== raw.s) return null;
    const out = {
      v: BOOKMARK_VERSION,
      s: raw.s,
      p: 'greedy-min-cost',
      b: scenario.defaultBudgetCents,
      f: 'NONE',
      n: DEFAULT_SENSITIVITY_STEPS
    };
    if (Object.prototype.hasOwnProperty.call(raw, 'p')) {
      if (typeof raw.p !== 'string' || !getPolicyById(raw.p)) return null;
      out.p = raw.p;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'b')) {
      if (!Number.isSafeInteger(raw.b) || raw.b < 0 || raw.b > MAX_BUDGET_CENTS) return null;
      out.b = raw.b;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'f')) {
      if (typeof raw.f !== 'string' || !getFaultModeById(raw.f)) return null;
      out.f = raw.f;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'n')) {
      if (!Number.isSafeInteger(raw.n) || raw.n < MIN_SENSITIVITY_STEPS || raw.n > MAX_SENSITIVITY_STEPS) return null;
      out.n = raw.n;
    }
    return out;
  }

  function encodeBookmarkHash(engine, rawState) {
    if (!engine) {
      throw new Error('encodeBookmarkHash requires CartConductorEngine');
    }
    const norm = normalizeBookmarkState(engine, rawState);
    if (!norm) return null;
    return '#' + BOOKMARK_PREFIX + b64urlEncodeText(JSON.stringify(norm));
  }

  function decodeBookmarkHash(engine, input) {
    if (!engine) {
      throw new Error('decodeBookmarkHash requires CartConductorEngine');
    }
    if (typeof input !== 'string') {
      return { ok: false, reason: 'NON_STRING_HASH', state: null };
    }
    let idx = input.indexOf('#' + BOOKMARK_PREFIX);
    if (idx < 0) idx = input.indexOf(BOOKMARK_PREFIX);
    if (idx < 0) {
      return { ok: false, reason: 'MISSING_PREFIX', state: null };
    }
    let token = input.slice(idx + (input[idx] === '#' ? 1 : 0) + BOOKMARK_PREFIX.length);
    const cut = token.search(B64URL_CUT_RE);
    if (cut >= 0) token = token.slice(0, cut);
    if (!token || token.length > 4096 || !B64URL_RE.test(token)) {
      return { ok: false, reason: 'INVALID_TOKEN', state: null };
    }
    const text = b64urlDecodeText(token);
    if (text === null) {
      return { ok: false, reason: 'INVALID_BASE64URL', state: null };
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, reason: 'INVALID_JSON', state: null };
    }
    const norm = normalizeBookmarkState(engine, parsed);
    if (!norm) {
      return { ok: false, reason: 'INVALID_STATE', state: null };
    }
    return { ok: true, reason: 'OK', state: norm };
  }

  /* ---------- In-page deterministic self-tests ---------- */

  const SHA256_KATS = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['CartConductor audit ledger', '7d2988abf6421a70c77f81a5eb3d931ee84e9dbe215f3ce4c89f29c5c573e6d7'],
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', '72996563049cc84daa2c3f31fd5c3d10770e69d6ebbb8da5b6d76db303dbae43'],
    ['line1\nline2', '683376e290829b482c2655745caffa7a1dccfa10afaa62dac2b42dd6c68d0f83'],
    ['tab\tsep', '018f0f844e2222bca764785fd7a4d7cae39d12c2f895560771dcecf9a7d99944']
  ];

  function runLabSelfTests(engine) {
    if (!engine) {
      throw new Error('runLabSelfTests requires CartConductorEngine');
    }
    const lab = createLab(engine);
    const results = [];
    const rec = (id, name, fn) => {
      try {
        const r = fn();
        const ok = r === true || (r && r.ok === true);
        results.push({ id, name, ok, detail: (r && r.detail) || (ok ? 'ok' : String(r)) });
      } catch (err) {
        results.push({ id, name, ok: false, detail: 'threw ' + String((err && err.message) || err) });
      }
    };

    rec('sha256-kat', 'SHA-256 known-answer vectors match', () => {
      for (const pair of SHA256_KATS) {
        if (engine.sha256Hex(pair[0]) !== pair[1]) {
          return { ok: false, detail: 'mismatch on vector ' + JSON.stringify(pair[0].slice(0, 16)) };
        }
      }
      return { ok: true, detail: SHA256_KATS.length + ' vectors verified' };
    });

    rec('waterfall-exactness', 'Cost waterfall reconstructs landed total in exact integer cents', () => {
      for (const sc of engine.SCENARIOS) {
        const solved = engine.solveCart(sc.id);
        const wf = engine.costWaterfall(solved.recommended);
        if (!wf.ok || wf.reconstructedCents !== wf.totalCents) return { ok: false, detail: 'mismatch on ' + sc.id };
        for (const st of wf.stages) {
          if (!Number.isSafeInteger(st.cents) || !Number.isSafeInteger(st.runningCents)) {
            return { ok: false, detail: 'non-integer stage on ' + sc.id };
          }
        }
      }
      return { ok: true, detail: 'exact reconstruction across ' + engine.SCENARIOS.length + ' scenarios' };
    });

    rec('conservation', 'Integer-cent conservation holds for every policy and fault', () => {
      for (const sc of engine.SCENARIOS) {
        for (const fm of FAULT_MODES) {
          const cmp = comparePolicies(engine, sc.id, { faultMode: fm.id });
          for (const row of cmp.rows) {
            if (!row.feasible) continue;
            const lhs = row.capturedCents - row.refundedCents;
            if (lhs !== row.netSettledCents || row.netSettledCents !== row.expectedNetCents) {
              return { ok: false, detail: 'drift on ' + sc.id + ' ' + fm.id + ' ' + row.policyId };
            }
          }
        }
      }
      return { ok: true, detail: 'zero penny drift across the matrix' };
    });

    rec('rollback-zero-leak', 'Every authorized hold is captured or voided with zero leak', () => {
      for (const sc of engine.SCENARIOS) {
        for (const fm of FAULT_MODES) {
          const cmp = comparePolicies(engine, sc.id, { faultMode: fm.id });
          for (const row of cmp.rows) {
            if (row.feasible && row.zeroLeak !== true) {
              return { ok: false, detail: 'stranded hold on ' + sc.id + ' ' + fm.id + ' ' + row.policyId };
            }
          }
        }
      }
      return { ok: true, detail: 'no stranded authorizations' };
    });

    rec('pareto-non-dominance', 'No frontier point dominates another frontier point', () => {
      for (const sc of engine.SCENARIOS) {
        const solved = engine.solveCart(sc.id);
        const pf = solved.paretoFrontier;
        for (let i = 0; i < pf.length; i++) {
          for (let j = 0; j < pf.length; j++) {
            if (i !== j && engine.dominates(pf[i], pf[j])) {
              return { ok: false, detail: 'dominance inside frontier of ' + sc.id };
            }
          }
        }
      }
      return { ok: true, detail: 'frontier pairwise non-dominated' };
    });

    rec('infeasible-graceful', 'Zero and unreachable budgets fail closed without throwing', () => {
      const cmp = comparePolicies(engine, engine.SCENARIOS[0].id, { budgetCents: 0 });
      if (cmp.rows.some((r) => r.feasible)) return { ok: false, detail: 'phantom feasible plan at zero cap' };
      const sens = sensitivityPlotData(engine, engine.SCENARIOS[0].id, { budgetCents: 0 }, 4);
      if (sens.ok !== true && sens.ok !== false) return { ok: false, detail: 'malformed sensitivity result' };
      const bad = sensitivityPlotData(engine, engine.SCENARIOS[0].id, { budgetCents: NaN }, 4);
      if (bad.ok !== false) return { ok: false, detail: 'NaN cap accepted' };
      return { ok: true, detail: 'infeasible states degrade cleanly' };
    });

    rec('csv-formula-escape', 'CSV cells neutralize formula injection', () => {
      const hostile = ['=CMD()', '+SUM(A1)', '-10+1', '@echo', '\t=1+1'];
      for (const h of hostile) {
        const esc = csvEscapeCell(h);
        if (esc.charAt(0) !== "'") return { ok: false, detail: 'unescaped formula cell ' + JSON.stringify(h) };
      }
      if (csvEscapeCell('plain').indexOf("'") >= 0) return { ok: false, detail: 'over-escaped plain cell' };
      return { ok: true, detail: 'formula leads are quoted with a prefix apostrophe' };
    });

    rec('tamper-detection', 'Brief digest verification detects single-cent tampering', () => {
      const cmp = comparePolicies(engine, engine.SCENARIOS[0].id, {});
      const brief = lab.buildAuditBrief({
        scenarioId: engine.SCENARIOS[0].id,
        compare: cmp
      });
      const good = verifyAuditBrief(engine, brief);
      if (!good.ok) return { ok: false, detail: 'clean brief failed verification' };
      const tampered = tamperAuditBrief(brief);
      const bad = verifyAuditBrief(engine, tampered);
      if (bad.ok) return { ok: false, detail: 'tampered brief passed verification' };
      return { ok: true, detail: 'digest mismatch detected on tampered copy' };
    });

    rec('digest-parity', 'On-page digest equals JSON, CSV and Markdown digests', () => {
      const cmp = comparePolicies(engine, engine.SCENARIOS[0].id, {});
      const brief = lab.buildAuditBrief({ scenarioId: engine.SCENARIOS[0].id, compare: cmp });
      const json = exportJsonBrief(brief);
      const csv = exportCsvBrief(brief);
      const md = exportMarkdownBrief(engine, brief);
      const d = brief.auditDigest;
      if (json.indexOf(d) < 0) return { ok: false, detail: 'digest missing from JSON export' };
      if (csv.indexOf(d) < 0) return { ok: false, detail: 'digest missing from CSV export' };
      if (md.indexOf(d) < 0) return { ok: false, detail: 'digest missing from Markdown export' };
      const again = lab.buildAuditBrief({ scenarioId: engine.SCENARIOS[0].id, compare: cmp });
      if (again.auditDigest !== d) return { ok: false, detail: 'cached digest drifted' };
      if (again !== brief) return { ok: false, detail: 'cache returned a different object' };
      return { ok: true, detail: 'one canonical digest stamps every surface' };
    });

    rec('cc-round-trip', 'Bookmark codec round-trips the full lab state', () => {
      const source = { v: 1, s: engine.SCENARIOS[1].id, p: 'max-reliability', b: 70000, f: 'PARTIAL_STOCK', n: 8 };
      const hash = encodeBookmarkHash(engine, source);
      if (typeof hash !== 'string' || hash.indexOf('#cc=') !== 0) return { ok: false, detail: 'encode failed' };
      const decoded = decodeBookmarkHash(engine, hash);
      if (!decoded.ok) return { ok: false, detail: 'decode failed: ' + decoded.reason };
      const st = decoded.state;
      if (st.s !== source.s || st.p !== source.p || st.b !== source.b || st.f !== source.f || st.n !== source.n) {
        return { ok: false, detail: 'state drift after round-trip' };
      }
      return { ok: true, detail: 'state restored exactly' };
    });

    rec('cc-hostile', 'Bookmark codec fails closed on hostile input', () => {
      const bads = [
        '{"v":1,"s":"' + engine.SCENARIOS[0].id + '","__proto__":{"x":1}}',
        '{"v":1,"s":"' + engine.SCENARIOS[0].id + '","constructor":{"x":1}}',
        '{"v":2,"s":"' + engine.SCENARIOS[0].id + '"}',
        '{"v":1,"s":"NOPE"}',
        '{"v":1,"s":"' + engine.SCENARIOS[0].id + '","b":-5}',
        '{"v":1,"s":"' + engine.SCENARIOS[0].id + '","b":1.5}',
        '{"v":1,"s":"' + engine.SCENARIOS[0].id + '","f":"HACK"}',
        '{"v":1,"s":"' + engine.SCENARIOS[0].id + '","p":"HACK"}',
        'not json at all',
        '[1,2,3]'
      ];
      for (const raw of bads) {
        const token = b64urlEncodeText(raw);
        const res = decodeBookmarkHash(engine, '#cc=' + token);
        if (res.ok) return { ok: false, detail: 'accepted hostile payload ' + raw.slice(0, 40) };
      }
      const garbage = ['#cc=', '#cc=!!!', '#cc=AAAA', '', null, 42, {}];
      for (const g of garbage) {
        const res = decodeBookmarkHash(engine, g);
        if (res.ok) return { ok: false, detail: 'accepted garbage input ' + JSON.stringify(g) };
      }
      return { ok: true, detail: 'hostile and malformed hashes rejected' };
    });

    rec('duplicate-retry', 'Duplicate capture retry replays identically under one idempotency domain', () => {
      const cmp = comparePolicies(engine, engine.SCENARIOS[0].id, { faultMode: 'DUPLICATE_RETRY' });
      for (const row of cmp.rows) {
        if (!row.feasible) continue;
        if (row.idempotentRetry !== true) {
          return { ok: false, detail: 'retry diverged on ' + row.policyId };
        }
      }
      return { ok: true, detail: 'replayed capture chain is byte-identical' };
    });

    rec('policy-matrix', 'All policies on all scenarios keep verified receipt chains under injected faults', () => {
      let checked = 0;
      for (const sc of engine.SCENARIOS) {
        for (const fm of FAULT_MODES) {
          const cmp = comparePolicies(engine, sc.id, { faultMode: fm.id });
          for (const row of cmp.rows) {
            if (!row.feasible) continue;
            checked += 1;
            if (!row.chainValid) {
              return { ok: false, detail: 'broken chain on ' + sc.id + ' ' + fm.id + ' ' + row.policyId };
            }
          }
        }
      }
      return { ok: true, detail: checked + ' policy rows verified' };
    });

    rec('single-merchant-graceful', 'Single-merchant and reliability policies degrade without throwing', () => {
      for (const sc of engine.SCENARIOS) {
        const cmp = comparePolicies(engine, sc.id, {});
        const single = cmp.rows.find((r) => r.policyId === 'single-merchant');
        if (!single) return { ok: false, detail: 'missing single-merchant row on ' + sc.id };
        if (single.feasible) {
          const greedyRow = cmp.rows.find((r) => r.policyId === 'greedy-min-cost');
          if (greedyRow.feasible && single.totalLandedCents < greedyRow.totalLandedCents) {
            return { ok: false, detail: 'single merchant beat dedicated solver on ' + sc.id };
          }
        }
        const maxRel = cmp.rows.find((r) => r.policyId === 'max-reliability');
        if (maxRel && maxRel.feasible) {
          for (const r of cmp.rows) {
            if (r.feasible && r.jointReliability > maxRel.jointReliability + 1e-9) {
              return { ok: false, detail: 'max-reliability plan not maximal on ' + sc.id };
            }
          }
        }
      }
      return { ok: true, detail: 'policy extremes stay within their guarantees' };
    });

    rec('bookmark-normalize', 'State normalization rejects non-plain shapes and bad fields', () => {
      const engineSc = engine.SCENARIOS[0].id;
      const cases = [
        null, undefined, 5, 'x', [], [{ v: 1, s: engineSc }],
        { v: 1, s: engineSc, n: 1 }, { v: 1, s: engineSc, n: 1000 },
        { v: 1, s: engineSc, b: Number.MAX_SAFE_INTEGER + 1 },
        { v: 1, s: engineSc, p: 'single-merchant', extra: { deep: [{ proto: 1 }] } }
      ];
      const verdicts = cases.map((c) => normalizeBookmarkState(engine, c));
      if (verdicts[0] !== null || verdicts[1] !== null || verdicts[2] !== null ||
        verdicts[3] !== null || verdicts[4] !== null || verdicts[5] !== null) {
        return { ok: false, detail: 'non-plain shapes accepted' };
      }
      if (verdicts[6] !== null || verdicts[7] !== null || verdicts[8] !== null) {
        return { ok: false, detail: 'bad field values accepted' };
      }
      if (verdicts[9] === null) {
        return { ok: false, detail: 'unknown extra key should be ignored, not rejected' };
      }
      return { ok: true, detail: 'normalization is strict where it matters' };
    });

    const passed = results.filter((r) => r.ok).length;
    return {
      total: results.length,
      passed,
      ok: passed === results.length,
      results
    };
  }

  /* ---------- Lab context factory ---------- */

  function createLab(engine) {
    if (!engine) {
      throw new Error('createLab requires CartConductorEngine');
    }
    const briefCache = new Map();

    function buildAuditBrief(snapshot) {
      const payload = buildAuditPayload(engine, snapshot);
      const key = canonicalJson(payload);
      if (briefCache.has(key)) {
        return briefCache.get(key);
      }
      const stamped = deepFreeze(Object.assign({}, payload, {
        auditDigest: engine.sha256Hex(BRIEF_FORMAT + '|' + key)
      }));
      briefCache.set(key, stamped);
      return stamped;
    }

    return {
      POLICIES,
      FAULT_MODES,
      getPolicyById,
      getFaultModeById,
      normalizeFaultMode,
      selectPolicyPlan: (solveResult, policyId) => selectPolicyPlan(solveResult, policyId),
      summarizeSaga,
      comparePolicies: (scenarioInput, options) => comparePolicies(engine, scenarioInput, options),
      paretoPlotData: (solveResult) => paretoPlotData(engine, solveResult),
      sensitivityPlotData: (scenarioInput, constraints, steps) => sensitivityPlotData(engine, scenarioInput, constraints, steps),
      buildAuditBrief,
      verifyAuditBrief: (brief) => verifyAuditBrief(engine, brief),
      tamperAuditBrief,
      exportJsonBrief,
      exportCsvBrief,
      exportMarkdownBrief: (stamped) => exportMarkdownBrief(engine, stamped),
      csvEscapeCell,
      canonicalJson,
      encodeBookmarkHash: (state) => encodeBookmarkHash(engine, state),
      decodeBookmarkHash: (hash) => decodeBookmarkHash(engine, hash),
      normalizeBookmarkState: (raw) => normalizeBookmarkState(engine, raw),
      runLabSelfTests: () => runLabSelfTests(engine),
      _briefCacheSize: () => briefCache.size
    };
  }

  return {
    BRIEF_FORMAT,
    BRIEF_DISCLOSURE,
    POLICIES,
    POLICY_IDS,
    FAULT_MODES,
    FAULT_MODE_IDS,
    SHA256_KATS,
    getPolicyById,
    getFaultModeById,
    normalizeFaultMode,
    selectPolicyPlan,
    summarizeSaga,
    comparePolicies,
    paretoPlotData,
    sensitivityPlotData,
    canonicalize,
    canonicalJson,
    buildAuditPayload,
    digestOfPayload,
    verifyAuditBrief,
    tamperAuditBrief,
    csvEscapeCell,
    exportJsonBrief,
    exportCsvBrief,
    exportMarkdownBrief,
    b64urlEncodeText,
    b64urlDecodeText,
    normalizeBookmarkState,
    encodeBookmarkHash,
    decodeBookmarkHash,
    runLabSelfTests,
    createLab
  };
});
