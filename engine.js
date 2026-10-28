'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CartConductorEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* ---------- Pure JS SHA-256 ---------- */

  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function utf8Bytes(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
        const c2 = s.charCodeAt(++i);
        const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function sha256Hex(input) {
    const bytes = utf8Bytes(input);
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) {
      bytes.push(0x00);
    }
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    bytes.push(
      (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
      (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff
    );

    const H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    const W = new Uint32Array(64);

    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i++) {
        const j = offset + i * 4;
        W[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10)) >>> 0;
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }

      let a = H[0], b = H[1], c = H[2], d = H[3];
      let e = H[4], f = H[5], g = H[6], h = H[7];

      for (let i = 0; i < 64; i++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ ((~e) & g)) >>> 0;
        const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const temp2 = (S0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }

    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += H[i].toString(16).padStart(8, '0');
    }
    return hex;
  }

  /* ---------- Currency & Formatting Helpers ---------- */

  function centsToDollars(cents) {
    if (typeof cents !== 'number' || !Number.isFinite(cents)) {
      throw new TypeError('centsToDollars requires a finite integer');
    }
    const rounded = Math.round(cents);
    const sign = rounded < 0 ? '-' : '';
    const abs = Math.abs(rounded);
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, '0');
    return sign + whole + '.' + frac;
  }

  function formatUsd(cents) {
    const raw = centsToDollars(cents);
    if (raw.startsWith('-')) {
      return '-$' + raw.slice(1);
    }
    return '$' + raw;
  }

  /* ---------- Catalog of 8 Merchants ---------- */

  const MERCHANTS = Object.freeze([
    {
      id: 'MERCH_APEX',
      name: 'Apex Compute Supply',
      payeeEmail: 'settlement@apexcompute.example.com',
      merchantId: '7K9P2JM8APEX1',
      region: 'US-West (San Jose, CA)',
      reliabilityScore: 0.992,
      freeShippingThresholdCents: 22000,
      baseShippingCents: 1800,
      bundleThresholdItems: 2,
      bundleDiscountBps: 500,
      taxRateBps: 825,
      handlingCents: 250
    },
    {
      id: 'MERCH_NOVA',
      name: 'NovaCircuit Direct',
      payeeEmail: 'orders-v2@novacircuit.example.com',
      merchantId: '4M2L8QN3NOVA2',
      region: 'US-Central (Austin, TX)',
      reliabilityScore: 0.968,
      freeShippingThresholdCents: 18000,
      baseShippingCents: 1400,
      bundleThresholdItems: 2,
      bundleDiscountBps: 400,
      taxRateBps: 800,
      handlingCents: 150
    },
    {
      id: 'MERCH_KINETIC',
      name: 'Kinetic Robotics Depot',
      payeeEmail: 'treasury@kineticrobotics.example.com',
      merchantId: '9R5V3WT7KINE3',
      region: 'US-East (Boston, MA)',
      reliabilityScore: 0.985,
      freeShippingThresholdCents: 25000,
      baseShippingCents: 2100,
      bundleThresholdItems: 2,
      bundleDiscountBps: 600,
      taxRateBps: 625,
      handlingCents: 300
    },
    {
      id: 'MERCH_VERIDIAN',
      name: 'Veridian Lab Logistics',
      payeeEmail: 'clearing@veridianlabs.example.com',
      merchantId: '2H8B6CX4VERI4',
      region: 'US-Midwest (Chicago, IL)',
      reliabilityScore: 0.979,
      freeShippingThresholdCents: 15000,
      baseShippingCents: 1200,
      bundleThresholdItems: 3,
      bundleDiscountBps: 750,
      taxRateBps: 750,
      handlingCents: 200
    },
    {
      id: 'MERCH_HYPERION',
      name: 'Hyperion Edge Systems',
      payeeEmail: 'merchant-api@hyperionedge.example.com',
      merchantId: '6D4G9ZF1HYPE5',
      region: 'US-Northwest (Seattle, WA)',
      reliabilityScore: 0.995,
      freeShippingThresholdCents: 30000,
      baseShippingCents: 2400,
      bundleThresholdItems: 2,
      bundleDiscountBps: 450,
      taxRateBps: 850,
      handlingCents: 350
    },
    {
      id: 'MERCH_PULSE',
      name: 'PulsePhotonics Wholesale',
      payeeEmail: 'capture@pulsephotonics.example.com',
      merchantId: '3J7N1KP9PULS6',
      region: 'US-Mountain (Denver, CO)',
      reliabilityScore: 0.941,
      freeShippingThresholdCents: 12000,
      baseShippingCents: 950,
      bundleThresholdItems: 2,
      bundleDiscountBps: 800,
      taxRateBps: 725,
      handlingCents: 100
    },
    {
      id: 'MERCH_STRATA',
      name: 'Strata Industrial Core',
      payeeEmail: 'payouts@stratacore.example.com',
      merchantId: '8W2C5MV6STRA7',
      region: 'US-South (Atlanta, GA)',
      reliabilityScore: 0.974,
      freeShippingThresholdCents: 20000,
      baseShippingCents: 1550,
      bundleThresholdItems: 2,
      bundleDiscountBps: 350,
      taxRateBps: 700,
      handlingCents: 180
    },
    {
      id: 'MERCH_ZENITH',
      name: 'Zenith Precision Instruments',
      payeeEmail: 'paypal-escrow@zenithprecision.example.com',
      merchantId: '5Q9X4TR2ZENI8',
      region: 'US-Northeast (Newark, NJ)',
      reliabilityScore: 0.989,
      freeShippingThresholdCents: 24000,
      baseShippingCents: 1950,
      bundleThresholdItems: 2,
      bundleDiscountBps: 550,
      taxRateBps: 660,
      handlingCents: 220
    }
  ]);

  /* ---------- Buyer Agent Procurement Scenarios ---------- */

  const SCENARIOS = Object.freeze([
    {
      id: 'SCENARIO_ROBOTICS_RIG',
      title: 'Autonomous Edge Vision & Servo Rig',
      agentName: 'ProcurementAgent-Alpha7',
      buyerId: 'BUYER-LAB-094',
      description: 'Four-component edge robotics build with strict 48-hour SLA and $680.00 hard budget cap.',
      defaultBudgetCents: 68000,
      defaultSlaHours: 48,
      defaultMinReliability: 0.95,
      shippingDestination: {
        name: 'Aegis Robotics Build Bay 4',
        address_line_1: '742 Evergreen Research Pkwy',
        admin_area_2: 'Austin',
        admin_area_1: 'TX',
        postal_code: '78701',
        country_code: 'US'
      },
      items: [
        {
          sku: 'SKU-NPU-24TOPS',
          name: 'Neural Edge Carrier Module (24 TOPS)',
          qty: 2,
          category: 'Compute',
          offers: [
            { merchantId: 'MERCH_APEX', unitPriceCents: 11200, stock: 8, deliveryHours: 24 },
            { merchantId: 'MERCH_NOVA', unitPriceCents: 10600, stock: 5, deliveryHours: 36 },
            { merchantId: 'MERCH_HYPERION', unitPriceCents: 11900, stock: 12, deliveryHours: 18 },
            { merchantId: 'MERCH_PULSE', unitPriceCents: 9900, stock: 4, deliveryHours: 60 },
            { merchantId: 'MERCH_STRATA', unitPriceCents: 11500, stock: 6, deliveryHours: 42 }
          ]
        },
        {
          sku: 'SKU-LIDAR-SOLID',
          name: 'Solid-State Short-Range LiDAR Array',
          qty: 1,
          category: 'Optics',
          offers: [
            { merchantId: 'MERCH_APEX', unitPriceCents: 18900, stock: 3, deliveryHours: 28 },
            { merchantId: 'MERCH_NOVA', unitPriceCents: 17400, stock: 2, deliveryHours: 40 },
            { merchantId: 'MERCH_KINETIC', unitPriceCents: 17800, stock: 6, deliveryHours: 22 },
            { merchantId: 'MERCH_PULSE', unitPriceCents: 16200, stock: 3, deliveryHours: 54 },
            { merchantId: 'MERCH_ZENITH', unitPriceCents: 18100, stock: 5, deliveryHours: 20 }
          ]
        },
        {
          sku: 'SKU-SERVO-BUS',
          name: 'High-Torque CAN-FD Brushless Actuator Pack',
          qty: 2,
          category: 'Motion',
          offers: [
            { merchantId: 'MERCH_APEX', unitPriceCents: 7400, stock: 10, deliveryHours: 30 },
            { merchantId: 'MERCH_KINETIC', unitPriceCents: 6400, stock: 8, deliveryHours: 24 },
            { merchantId: 'MERCH_VERIDIAN', unitPriceCents: 6700, stock: 9, deliveryHours: 32 },
            { merchantId: 'MERCH_STRATA', unitPriceCents: 6500, stock: 7, deliveryHours: 38 },
            { merchantId: 'MERCH_HYPERION', unitPriceCents: 7100, stock: 10, deliveryHours: 20 }
          ]
        },
        {
          sku: 'SKU-PSU-GAN48V',
          name: 'GaN 48V Programmable Telemetry Rail',
          qty: 1,
          category: 'Power',
          offers: [
            { merchantId: 'MERCH_APEX', unitPriceCents: 8200, stock: 4, deliveryHours: 26 },
            { merchantId: 'MERCH_NOVA', unitPriceCents: 7100, stock: 6, deliveryHours: 36 },
            { merchantId: 'MERCH_VERIDIAN', unitPriceCents: 6900, stock: 5, deliveryHours: 30 },
            { merchantId: 'MERCH_ZENITH', unitPriceCents: 7500, stock: 7, deliveryHours: 18 },
            { merchantId: 'MERCH_STRATA', unitPriceCents: 7300, stock: 1, deliveryHours: 44 }
          ]
        }
      ]
    },
    {
      id: 'SCENARIO_BIO_BENCH',
      title: 'Cold-Chain Microfluidics Assay Bench',
      agentName: 'BioSupplyAgent-V3',
      buyerId: 'BUYER-CLINIC-312',
      description: 'Time-critical lab optics and thermal cycler manifolds with 36-hour SLA and $820.00 cap.',
      defaultBudgetCents: 82000,
      defaultSlaHours: 36,
      defaultMinReliability: 0.96,
      shippingDestination: {
        name: 'Helix Assay Core Lab 2B',
        address_line_1: '1200 Kendall Square Bio Hub',
        admin_area_2: 'Cambridge',
        admin_area_1: 'MA',
        postal_code: '02139',
        country_code: 'US'
      },
      items: [
        {
          sku: 'SKU-PELTIER-ARRAY',
          name: 'Dual-Zone Peltier Thermal Cycling Block',
          qty: 2,
          category: 'Thermal',
          offers: [
            { merchantId: 'MERCH_VERIDIAN', unitPriceCents: 13400, stock: 6, deliveryHours: 28 },
            { merchantId: 'MERCH_ZENITH', unitPriceCents: 14100, stock: 8, deliveryHours: 16 },
            { merchantId: 'MERCH_APEX', unitPriceCents: 14800, stock: 5, deliveryHours: 24 },
            { merchantId: 'MERCH_NOVA', unitPriceCents: 12900, stock: 4, deliveryHours: 34 }
          ]
        },
        {
          sku: 'SKU-FLUORO-FILTER',
          name: 'Narrowband 488nm Dichroic Filter Cube',
          qty: 2,
          category: 'Optics',
          offers: [
            { merchantId: 'MERCH_ZENITH', unitPriceCents: 9800, stock: 5, deliveryHours: 18 },
            { merchantId: 'MERCH_VERIDIAN', unitPriceCents: 9400, stock: 6, deliveryHours: 30 },
            { merchantId: 'MERCH_PULSE', unitPriceCents: 8600, stock: 4, deliveryHours: 48 },
            { merchantId: 'MERCH_HYPERION', unitPriceCents: 10500, stock: 7, deliveryHours: 20 }
          ]
        },
        {
          sku: 'SKU-SYRINGE-STEP',
          name: 'Nanoliter Piezo Micro-Dispense Pump',
          qty: 1,
          category: 'Fluidics',
          offers: [
            { merchantId: 'MERCH_KINETIC', unitPriceCents: 19200, stock: 4, deliveryHours: 20 },
            { merchantId: 'MERCH_VERIDIAN', unitPriceCents: 18600, stock: 3, deliveryHours: 28 },
            { merchantId: 'MERCH_ZENITH', unitPriceCents: 19800, stock: 5, deliveryHours: 16 },
            { merchantId: 'MERCH_STRATA', unitPriceCents: 18100, stock: 4, deliveryHours: 36 }
          ]
        },
        {
          sku: 'SKU-DAQ-24BIT',
          name: 'Isolated 8-Channel 24-Bit Photodiode DAQ',
          qty: 1,
          category: 'Telemetry',
          offers: [
            { merchantId: 'MERCH_APEX', unitPriceCents: 11800, stock: 6, deliveryHours: 22 },
            { merchantId: 'MERCH_NOVA', unitPriceCents: 11200, stock: 5, deliveryHours: 32 },
            { merchantId: 'MERCH_HYPERION', unitPriceCents: 12400, stock: 8, deliveryHours: 18 },
            { merchantId: 'MERCH_VERIDIAN', unitPriceCents: 11600, stock: 4, deliveryHours: 28 }
          ]
        }
      ]
    },
    {
      id: 'SCENARIO_RACK_CLUSTER',
      title: 'High-Density Inference Switch & Telemetry Pod',
      agentName: 'InfraConductor-9',
      buyerId: 'BUYER-DC-701',
      description: 'Data-center optical transceivers, PDU controllers, and clocking card under 60-hour SLA and $960.00 cap.',
      defaultBudgetCents: 96000,
      defaultSlaHours: 60,
      defaultMinReliability: 0.94,
      shippingDestination: {
        name: 'Ashburn Colocation Cage 14',
        address_line_1: '21700 Loudoun County Pkwy',
        admin_area_2: 'Ashburn',
        admin_area_1: 'VA',
        postal_code: '20147',
        country_code: 'US'
      },
      items: [
        {
          sku: 'SKU-QSFP-400G',
          name: '400GBASE-DR4 Silicon Photonics Transceiver',
          qty: 3,
          category: 'Networking',
          offers: [
            { merchantId: 'MERCH_PULSE', unitPriceCents: 11400, stock: 9, deliveryHours: 48 },
            { merchantId: 'MERCH_APEX', unitPriceCents: 12600, stock: 10, deliveryHours: 24 },
            { merchantId: 'MERCH_HYPERION', unitPriceCents: 13100, stock: 8, deliveryHours: 18 },
            { merchantId: 'MERCH_NOVA', unitPriceCents: 12100, stock: 6, deliveryHours: 36 }
          ]
        },
        {
          sku: 'SKU-PTP-GRANDMASTER',
          name: 'OCXO IEEE-1588 PTP Timing Mezzanine',
          qty: 1,
          category: 'Timing',
          offers: [
            { merchantId: 'MERCH_ZENITH', unitPriceCents: 21500, stock: 4, deliveryHours: 20 },
            { merchantId: 'MERCH_APEX', unitPriceCents: 22400, stock: 5, deliveryHours: 24 },
            { merchantId: 'MERCH_STRATA', unitPriceCents: 20400, stock: 3, deliveryHours: 42 },
            { merchantId: 'MERCH_HYPERION', unitPriceCents: 22900, stock: 6, deliveryHours: 16 }
          ]
        },
        {
          sku: 'SKU-PDU-METERED',
          name: 'Per-Outlet Switched Zero-U Rack PDU',
          qty: 2,
          category: 'Power',
          offers: [
            { merchantId: 'MERCH_STRATA', unitPriceCents: 8900, stock: 8, deliveryHours: 40 },
            { merchantId: 'MERCH_KINETIC', unitPriceCents: 9500, stock: 6, deliveryHours: 26 },
            { merchantId: 'MERCH_NOVA', unitPriceCents: 9100, stock: 7, deliveryHours: 34 },
            { merchantId: 'MERCH_APEX', unitPriceCents: 9900, stock: 9, deliveryHours: 24 }
          ]
        },
        {
          sku: 'SKU-DAC-TWINAX',
          name: 'Active Twinax Breakout Harness Bundle',
          qty: 2,
          category: 'Cabling',
          offers: [
            { merchantId: 'MERCH_PULSE', unitPriceCents: 4200, stock: 12, deliveryHours: 50 },
            { merchantId: 'MERCH_NOVA', unitPriceCents: 4600, stock: 10, deliveryHours: 34 },
            { merchantId: 'MERCH_STRATA', unitPriceCents: 4500, stock: 8, deliveryHours: 38 },
            { merchantId: 'MERCH_ZENITH', unitPriceCents: 5100, stock: 10, deliveryHours: 18 }
          ]
        }
      ]
    }
  ]);

  /* ---------- Fault Types for Saga Simulation ---------- */

  const FAULT_CATALOG = Object.freeze({
    NONE: {
      code: 'NONE',
      label: 'Nominal Settlement (Zero Faults)',
      httpStatus: 201,
      paypalErrorName: null,
      description: 'All merchant authorizations pass inventory lock and capture cleanly on first pass.'
    },
    OUT_OF_STOCK_AT_CAPTURE: {
      code: 'OUT_OF_STOCK_AT_CAPTURE',
      label: 'Out of Stock at Capture',
      httpStatus: 422,
      paypalErrorName: 'UNPROCESSABLE_ENTITY',
      paypalIssue: 'INVENTORY_ALLOCATION_EXHAUSTED',
      description: 'Target merchant fails warehouse bin lock right before capture; saga voids authorization and reroutes SKU(s).'
    },
    THREE_DS_CHALLENGE_REQUIRED: {
      code: 'THREE_DS_CHALLENGE_REQUIRED',
      label: '3DS Challenge Required',
      httpStatus: 422,
      paypalErrorName: 'PAYER_ACTION_REQUIRED',
      paypalIssue: 'CONTINGENCY_3DS_CHALLENGE_TIMEOUT',
      description: 'Target merchant acquirer demands interactive 3DS step-up not supported by headless agent token; saga voids and reroutes.'
    },
    SHIPPING_SLA_SLIPPAGE: {
      code: 'SHIPPING_SLA_SLIPPAGE',
      label: 'Shipping SLA Slippage',
      httpStatus: 409,
      paypalErrorName: 'SLA_COMMITMENT_BREACH',
      paypalIssue: 'CARRIER_DISPATCH_WINDOW_MISSED',
      description: 'Target merchant dispatch webhook reports +28h delay breaching buyer SLA; saga voids authorization and re-optimizes.'
    },
    PARTIAL_FULFILLMENT: {
      code: 'PARTIAL_FULFILLMENT',
      label: 'Partial Fulfillment',
      httpStatus: 206,
      paypalErrorName: 'PARTIAL_CAPTURE_SHORTFALL',
      paypalIssue: 'MULTI_ITEM_SHORT_SHIP_DETECTED',
      description: 'Target merchant can only fulfill part of its assigned bundle; saga voids the failed unit and re-allocates to backup merchant(s).'
    }
  });

  function getMerchantById(merchantId) {
    return MERCHANTS.find((m) => m.id === merchantId) || null;
  }

  function getScenarioById(scenarioId) {
    return SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
  }

  /* ---------- Single Assignment Cost & Constraint Evaluator ---------- */

  /**
   * Evaluates a specific item-to-merchant assignment vector.
   * assignment is an array of merchantIds corresponding to scenario.items[0..N-1].
   */
  function evaluateAssignment(scenario, assignment, constraints) {
    if (!scenario || !Array.isArray(scenario.items)) {
      throw new Error('evaluateAssignment requires a valid scenario');
    }
    if (!Array.isArray(assignment) || assignment.length !== scenario.items.length) {
      throw new Error('assignment length must match scenario.items length');
    }

    const slaHours = constraints && typeof constraints.maxSlaHours === 'number'
      ? constraints.maxSlaHours
      : scenario.defaultSlaHours;
    const budgetCents = constraints && typeof constraints.budgetCents === 'number'
      ? constraints.budgetCents
      : scenario.defaultBudgetCents;
    const minReliability = constraints && typeof constraints.minReliability === 'number'
      ? constraints.minReliability
      : scenario.defaultMinReliability;
    const excludedMerchants = new Set((constraints && constraints.excludedMerchants) || []);

    const groups = new Map();
    const itemAllocations = [];
    let maxDeliveryHours = 0;
    let jointReliability = 1;
    let minMerchantReliability = 1;

    for (let i = 0; i < scenario.items.length; i++) {
      const item = scenario.items[i];
      const merchantId = assignment[i];
      if (excludedMerchants.has(merchantId)) {
        return { feasible: false, reason: 'EXCLUDED_MERCHANT', failedMerchantId: merchantId };
      }
      const merchant = getMerchantById(merchantId);
      if (!merchant) {
        return { feasible: false, reason: 'UNKNOWN_MERCHANT', failedMerchantId: merchantId };
      }
      if (merchant.reliabilityScore < minReliability) {
        return { feasible: false, reason: 'RELIABILITY_BELOW_FLOOR', failedMerchantId: merchantId };
      }
      const offer = item.offers.find((o) => o.merchantId === merchantId);
      if (!offer) {
        return { feasible: false, reason: 'NO_OFFER', failedMerchantId: merchantId, sku: item.sku };
      }
      if (offer.stock < item.qty) {
        return { feasible: false, reason: 'INSUFFICIENT_STOCK', failedMerchantId: merchantId, sku: item.sku };
      }
      if (offer.deliveryHours > slaHours) {
        return { feasible: false, reason: 'SLA_EXCEEDED', failedMerchantId: merchantId, sku: item.sku };
      }

      const lineSubtotalCents = offer.unitPriceCents * item.qty;
      if (offer.deliveryHours > maxDeliveryHours) {
        maxDeliveryHours = offer.deliveryHours;
      }

      if (!groups.has(merchantId)) {
        groups.set(merchantId, {
          merchant,
          merchantId,
          lines: [],
          distinctSkuCount: 0,
          totalUnits: 0,
          itemSubtotalCents: 0,
          maxDeliveryHours: 0
        });
        jointReliability *= merchant.reliabilityScore;
        if (merchant.reliabilityScore < minMerchantReliability) {
          minMerchantReliability = merchant.reliabilityScore;
        }
      }

      const grp = groups.get(merchantId);
      const lineRecord = {
        sku: item.sku,
        name: item.name,
        category: item.category,
        qty: item.qty,
        unitPriceCents: offer.unitPriceCents,
        lineSubtotalCents,
        deliveryHours: offer.deliveryHours,
        stock: offer.stock,
        merchantId,
        merchantName: merchant.name
      };
      grp.lines.push(lineRecord);
      grp.distinctSkuCount += 1;
      grp.totalUnits += item.qty;
      grp.itemSubtotalCents += lineSubtotalCents;
      if (offer.deliveryHours > grp.maxDeliveryHours) {
        grp.maxDeliveryHours = offer.deliveryHours;
      }
      itemAllocations.push(lineRecord);
    }

    let totalItemSubtotalCents = 0;
    let totalBundleDiscountCents = 0;
    let totalShippingCents = 0;
    let totalHandlingCents = 0;
    let totalTaxCents = 0;
    let totalLandedCents = 0;
    const merchantBreakdowns = [];

    for (const grp of groups.values()) {
      const m = grp.merchant;
      const qualifiesBundle = grp.distinctSkuCount >= m.bundleThresholdItems;
      const discountCents = qualifiesBundle
        ? Math.floor((grp.itemSubtotalCents * m.bundleDiscountBps) / 10000)
        : 0;
      const netItemsCents = grp.itemSubtotalCents - discountCents;
      const qualifiesFreeShipping = netItemsCents >= m.freeShippingThresholdCents;
      const shippingCents = qualifiesFreeShipping ? 0 : m.baseShippingCents;
      const handlingCents = m.handlingCents;
      const taxCents = Math.round((netItemsCents * m.taxRateBps) / 10000);
      const unitTotalCents = netItemsCents + shippingCents + handlingCents + taxCents;

      totalItemSubtotalCents += grp.itemSubtotalCents;
      totalBundleDiscountCents += discountCents;
      totalShippingCents += shippingCents;
      totalHandlingCents += handlingCents;
      totalTaxCents += taxCents;
      totalLandedCents += unitTotalCents;

      merchantBreakdowns.push({
        merchantId: m.id,
        merchantName: m.name,
        payeeEmail: m.payeeEmail,
        paypalMerchantId: m.merchantId,
        region: m.region,
        reliabilityScore: m.reliabilityScore,
        distinctSkuCount: grp.distinctSkuCount,
        totalUnits: grp.totalUnits,
        itemSubtotalCents: grp.itemSubtotalCents,
        qualifiesBundle,
        bundleDiscountBps: qualifiesBundle ? m.bundleDiscountBps : 0,
        discountCents,
        netItemsCents,
        qualifiesFreeShipping,
        freeShippingThresholdCents: m.freeShippingThresholdCents,
        shippingCents,
        handlingCents,
        taxRateBps: m.taxRateBps,
        taxCents,
        unitTotalCents,
        maxDeliveryHours: grp.maxDeliveryHours,
        lines: grp.lines
      });
    }

    const withinBudget = totalLandedCents <= budgetCents;
    const shipmentCount = merchantBreakdowns.length;

    return {
      feasible: withinBudget,
      withinBudget,
      reason: withinBudget ? 'OK' : 'BUDGET_EXCEEDED',
      assignment: assignment.slice(),
      signature: assignment.join('|'),
      totalItemSubtotalCents,
      totalBundleDiscountCents,
      totalShippingCents,
      totalHandlingCents,
      totalTaxCents,
      totalLandedCents,
      maxDeliveryHours,
      shipmentCount,
      jointReliability: Number(jointReliability.toFixed(6)),
      minMerchantReliability: Number(minMerchantReliability.toFixed(4)),
      budgetRemainingCents: budgetCents - totalLandedCents,
      itemAllocations,
      merchantBreakdowns
    };
  }

  /* ---------- Deterministic Branch-and-Bound & Pareto Frontier Solver ---------- */

  function dominates(a, b) {
    const noWorse =
      a.totalLandedCents <= b.totalLandedCents &&
      a.maxDeliveryHours <= b.maxDeliveryHours &&
      a.shipmentCount <= b.shipmentCount &&
      a.jointReliability >= b.jointReliability;
    const strictlyBetter =
      a.totalLandedCents < b.totalLandedCents ||
      a.maxDeliveryHours < b.maxDeliveryHours ||
      a.shipmentCount < b.shipmentCount ||
      a.jointReliability > b.jointReliability;
    return noWorse && strictlyBetter;
  }

  function solveCart(scenarioInput, userConstraints) {
    const scenario = typeof scenarioInput === 'string'
      ? getScenarioById(scenarioInput)
      : (scenarioInput || SCENARIOS[0]);

    const constraints = Object.assign({
      budgetCents: scenario.defaultBudgetCents,
      maxSlaHours: scenario.defaultSlaHours,
      minReliability: scenario.defaultMinReliability,
      excludedMerchants: [],
      strategy: 'LOWEST_COST'
    }, userConstraints || {});

    const items = scenario.items;
    const n = items.length;
    const excludedSet = new Set(constraints.excludedMerchants || []);

    // Precompute optimistic lower bound per remaining item for Branch-and-Bound pruning
    const minItemNetCost = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const off of items[i].offers) {
        const m = getMerchantById(off.merchantId);
        if (!m) continue;
        const maxDiscBps = m.bundleDiscountBps;
        const raw = off.unitPriceCents * items[i].qty;
        const discounted = raw - Math.floor((raw * maxDiscBps) / 10000);
        const minTax = Math.round((discounted * m.taxRateBps) / 10000);
        const lb = discounted + minTax;
        if (lb < best) best = lb;
      }
      minItemNetCost[i] = Number.isFinite(best) ? best : 0;
    }

    const suffixMinCost = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      suffixMinCost[i] = suffixMinCost[i + 1] + minItemNetCost[i];
    }

    const feasibleSolutions = [];
    const currentAssignment = new Array(n);
    let nodesExplored = 0;
    let branchesPruned = 0;
    let bestCostSoFar = Infinity;

    function search(depth, runningOptimisticCents) {
      nodesExplored += 1;
      if (depth === n) {
        const evaluated = evaluateAssignment(scenario, currentAssignment, constraints);
        if (evaluated.feasible) {
          feasibleSolutions.push(evaluated);
          if (evaluated.totalLandedCents < bestCostSoFar) {
            bestCostSoFar = evaluated.totalLandedCents;
          }
        }
        return;
      }

      // Optimistic lower bound check against hard budget cap
      if (runningOptimisticCents + suffixMinCost[depth] > constraints.budgetCents) {
        branchesPruned += 1;
        return;
      }

      const item = items[depth];
      // Order candidate offers by unit price ascending for faster tightening
      const sortedOffers = item.offers.slice().sort((a, b) => a.unitPriceCents - b.unitPriceCents);

      for (let k = 0; k < sortedOffers.length; k++) {
        const off = sortedOffers[k];
        if (excludedSet.has(off.merchantId)) {
          branchesPruned += 1;
          continue;
        }
        const m = getMerchantById(off.merchantId);
        if (!m || m.reliabilityScore < constraints.minReliability) {
          branchesPruned += 1;
          continue;
        }
        if (off.stock < item.qty || off.deliveryHours > constraints.maxSlaHours) {
          branchesPruned += 1;
          continue;
        }

        currentAssignment[depth] = off.merchantId;
        search(depth + 1, runningOptimisticCents + minItemNetCost[depth]);
      }
    }

    search(0, 0);

    // Compute Naive Baselines for comparison:
    // 1. Greedy Unbundled Unit-Price Baseline (picks lowest unit price per item ignoring shipping & SLA if needed, or within stock)
    const greedyAssignment = items.map((item) => {
      const validOffers = item.offers.filter((o) => {
        const m = getMerchantById(o.merchantId);
        return m && !excludedSet.has(o.merchantId) && o.stock >= item.qty;
      });
      const pool = validOffers.length > 0 ? validOffers : item.offers;
      const cheapestUnit = pool.slice().sort((a, b) => a.unitPriceCents - b.unitPriceCents)[0];
      return cheapestUnit.merchantId;
    });
    const greedyBaseline = evaluateAssignment(scenario, greedyAssignment, {
      budgetCents: Number.MAX_SAFE_INTEGER,
      maxSlaHours: Number.MAX_SAFE_INTEGER,
      minReliability: 0,
      excludedMerchants: []
    });

    // 2. Best Single-Merchant Baseline (if any single merchant carries all items in stock)
    let bestSingleMerchant = null;
    for (const m of MERCHANTS) {
      if (excludedSet.has(m.id)) continue;
      const uniformAssignment = new Array(n).fill(m.id);
      const evalSingle = evaluateAssignment(scenario, uniformAssignment, {
        budgetCents: Number.MAX_SAFE_INTEGER,
        maxSlaHours: Number.MAX_SAFE_INTEGER,
        minReliability: 0,
        excludedMerchants: []
      });
      if (evalSingle.feasible) {
        if (!bestSingleMerchant || evalSingle.totalLandedCents < bestSingleMerchant.totalLandedCents) {
          bestSingleMerchant = evalSingle;
        }
      }
    }

    if (feasibleSolutions.length === 0) {
      return {
        feasible: false,
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        constraints,
        nodesExplored,
        branchesPruned,
        totalFeasibleCount: 0,
        paretoFrontier: [],
        modes: {
          LOWEST_COST: null,
          FASTEST_DELIVERY: null,
          FEWEST_SHIPMENTS: null
        },
        selectedMode: constraints.strategy,
        recommended: null,
        baselines: {
          greedyUnbundled: greedyBaseline,
          singleMerchant: bestSingleMerchant
        },
        savingsVsGreedyCents: 0,
        savingsVsSingleMerchantCents: 0
      };
    }

    // Mode 1: Lowest Total Landed Cost (tie-break: faster delivery, fewer shipments, higher reliability)
    const lowestCost = feasibleSolutions.slice().sort((a, b) => {
      if (a.totalLandedCents !== b.totalLandedCents) return a.totalLandedCents - b.totalLandedCents;
      if (a.maxDeliveryHours !== b.maxDeliveryHours) return a.maxDeliveryHours - b.maxDeliveryHours;
      if (a.shipmentCount !== b.shipmentCount) return a.shipmentCount - b.shipmentCount;
      return b.jointReliability - a.jointReliability;
    })[0];

    // Mode 2: Fastest Guaranteed Delivery (tie-break: lowest landed cost, fewer shipments)
    const fastestDelivery = feasibleSolutions.slice().sort((a, b) => {
      if (a.maxDeliveryHours !== b.maxDeliveryHours) return a.maxDeliveryHours - b.maxDeliveryHours;
      if (a.totalLandedCents !== b.totalLandedCents) return a.totalLandedCents - b.totalLandedCents;
      return a.shipmentCount - b.shipmentCount;
    })[0];

    // Mode 3: Fewest Split Shipments (tie-break: lowest landed cost, faster delivery)
    const fewestShipments = feasibleSolutions.slice().sort((a, b) => {
      if (a.shipmentCount !== b.shipmentCount) return a.shipmentCount - b.shipmentCount;
      if (a.totalLandedCents !== b.totalLandedCents) return a.totalLandedCents - b.totalLandedCents;
      return a.maxDeliveryHours - b.maxDeliveryHours;
    })[0];

    // Compute Pareto Frontier across (totalLandedCents, maxDeliveryHours, shipmentCount, -jointReliability)
    const paretoFrontier = [];
    for (let i = 0; i < feasibleSolutions.length; i++) {
      const candidate = feasibleSolutions[i];
      let isDominated = false;
      for (let j = 0; j < feasibleSolutions.length; j++) {
        if (i === j) continue;
        if (dominates(feasibleSolutions[j], candidate)) {
          isDominated = true;
          break;
        }
      }
      if (!isDominated) {
        if (!paretoFrontier.some((p) => p.signature === candidate.signature)) {
          paretoFrontier.push(candidate);
        }
      }
    }

    paretoFrontier.sort((a, b) => {
      if (a.totalLandedCents !== b.totalLandedCents) return a.totalLandedCents - b.totalLandedCents;
      return a.maxDeliveryHours - b.maxDeliveryHours;
    });

    const modes = {
      LOWEST_COST: lowestCost,
      FASTEST_DELIVERY: fastestDelivery,
      FEWEST_SHIPMENTS: fewestShipments
    };

    const selectedMode = modes[constraints.strategy] ? constraints.strategy : 'LOWEST_COST';
    const recommended = modes[selectedMode];

    const savingsVsGreedyCents = greedyBaseline && greedyBaseline.feasible
      ? greedyBaseline.totalLandedCents - recommended.totalLandedCents
      : 0;
    const savingsVsSingleMerchantCents = bestSingleMerchant && bestSingleMerchant.feasible
      ? bestSingleMerchant.totalLandedCents - recommended.totalLandedCents
      : 0;

    return {
      feasible: true,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      constraints,
      nodesExplored,
      branchesPruned,
      totalFeasibleCount: feasibleSolutions.length,
      paretoFrontier,
      allFeasibleSolutions: feasibleSolutions,
      modes,
      selectedMode,
      recommended,
      baselines: {
        greedyUnbundled: greedyBaseline,
        singleMerchant: bestSingleMerchant
      },
      savingsVsGreedyCents,
      savingsVsSingleMerchantCents
    };
  }

  /* ---------- PayPal Orders v2 Multi-Purchase-Unit Payload Builder ---------- */

  function computeIdempotencyKey(scenarioId, solutionSignature, stageTag) {
    const canonical = 'CARTCONDUCTOR_V2|' + scenarioId + '|' + solutionSignature + '|' + (stageTag || 'AUTHORIZE');
    const digest = sha256Hex(canonical);
    return (
      digest.slice(0, 8) + '-' +
      digest.slice(8, 12) + '-4' +
      digest.slice(13, 16) + '-a' +
      digest.slice(17, 20) + '-' +
      digest.slice(20, 32)
    );
  }

  function buildPayPalOrderPayload(scenarioInput, solution, options) {
    const scenario = typeof scenarioInput === 'string'
      ? getScenarioById(scenarioInput)
      : (scenarioInput || SCENARIOS[0]);
    if (!solution || !solution.feasible) {
      throw new Error('buildPayPalOrderPayload requires a feasible cart solution');
    }
    const opts = options || {};
    const intent = opts.intent || 'AUTHORIZE';
    const stageTag = opts.stageTag || 'INITIAL_ORDER';
    const idempotencyKey = computeIdempotencyKey(scenario.id, solution.signature, stageTag);
    const orderHash = sha256Hex(idempotencyKey + '|' + solution.totalLandedCents);
    const orderId = 'ORD-PP-' + orderHash.slice(0, 12).toUpperCase();

    const purchaseUnits = solution.merchantBreakdowns.map((mb, idx) => {
      const refId = 'PU_' + String(idx + 1).padStart(2, '0') + '_' + mb.merchantId;
      const customHash = sha256Hex(orderId + '|' + refId + '|' + mb.unitTotalCents).slice(0, 10).toUpperCase();

      return {
        reference_id: refId,
        custom_id: 'AGENT_' + scenario.buyerId + '_' + customHash,
        invoice_id: 'INV-' + scenario.id.replace('SCENARIO_', '') + '-' + String(idx + 1).padStart(2, '0') + '-' + customHash.slice(0, 6),
        description: mb.merchantName + ' (' + mb.distinctSkuCount + ' SKU, ' + mb.maxDeliveryHours + 'h SLA)',
        payee: {
          email_address: mb.payeeEmail,
          merchant_id: mb.paypalMerchantId
        },
        amount: {
          currency_code: 'USD',
          value: centsToDollars(mb.unitTotalCents),
          breakdown: {
            item_total: {
              currency_code: 'USD',
              value: centsToDollars(mb.itemSubtotalCents)
            },
            shipping: {
              currency_code: 'USD',
              value: centsToDollars(mb.shippingCents)
            },
            handling: {
              currency_code: 'USD',
              value: centsToDollars(mb.handlingCents)
            },
            tax_total: {
              currency_code: 'USD',
              value: centsToDollars(mb.taxCents)
            },
            discount: {
              currency_code: 'USD',
              value: centsToDollars(mb.discountCents)
            }
          }
        },
        items: mb.lines.map((line) => ({
          name: line.name,
          sku: line.sku,
          quantity: String(line.qty),
          category: 'PHYSICAL_GOODS',
          unit_amount: {
            currency_code: 'USD',
            value: centsToDollars(line.unitPriceCents)
          }
        })),
        shipping: {
          type: 'SHIPPING',
          name: {
            full_name: scenario.shippingDestination.name
          },
          address: {
            address_line_1: scenario.shippingDestination.address_line_1,
            admin_area_2: scenario.shippingDestination.admin_area_2,
            admin_area_1: scenario.shippingDestination.admin_area_1,
            postal_code: scenario.shippingDestination.postal_code,
            country_code: scenario.shippingDestination.country_code
          }
        }
      };
    });

    const body = {
      intent,
      purchase_units: purchaseUnits,
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'CartConductor Autonomous Agent Clearing',
            shipping_preference: 'SET_PROVIDED_ADDRESS',
            user_action: 'PAY_NOW',
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED'
          }
        }
      }
    };

    return {
      orderId,
      endpoint: 'POST /v2/checkout/orders',
      headers: {
        'Content-Type': 'application/json',
        'PayPal-Request-Id': idempotencyKey,
        'PayPal-Partner-Attribution-Id': 'CARTCONDUCTOR_AGENTIC_V2',
        'Prefer': 'return=representation'
      },
      body
    };
  }

  /**
   * Verifies that a PayPal Orders v2 payload obeys strict mathematical and schema invariants.
   */
  function validatePayPalOrderPayload(payload) {
    const errors = [];
    if (!payload || typeof payload !== 'object') {
      return { valid: false, errors: ['Payload must be an object'] };
    }
    if (!payload.headers || typeof payload.headers['PayPal-Request-Id'] !== 'string' || payload.headers['PayPal-Request-Id'].length < 16) {
      errors.push('Missing or invalid PayPal-Request-Id idempotency header');
    }
    const body = payload.body;
    if (!body || (body.intent !== 'AUTHORIZE' && body.intent !== 'CAPTURE')) {
      errors.push('body.intent must be AUTHORIZE or CAPTURE');
    }
    if (!body || !Array.isArray(body.purchase_units) || body.purchase_units.length === 0) {
      errors.push('body.purchase_units must be a non-empty array');
      return { valid: false, errors };
    }

    const seenRefs = new Set();
    let grandTotalCents = 0;

    for (let i = 0; i < body.purchase_units.length; i++) {
      const pu = body.purchase_units[i];
      if (!pu.reference_id || seenRefs.has(pu.reference_id)) {
        errors.push('Duplicate or missing reference_id at index ' + i);
      }
      seenRefs.add(pu.reference_id);

      if (!pu.payee || !pu.payee.email_address || !pu.payee.merchant_id) {
        errors.push('Missing payee credentials on ' + pu.reference_id);
      }

      const amt = pu.amount;
      if (!amt || amt.currency_code !== 'USD' || !amt.breakdown) {
        errors.push('Missing amount breakdown on ' + pu.reference_id);
        continue;
      }

      const toCents = (obj) => Math.round(Number(obj && obj.value ? obj.value : 0) * 100);
      const valCents = Math.round(Number(amt.value) * 100);
      const itemTotal = toCents(amt.breakdown.item_total);
      const shipping = toCents(amt.breakdown.shipping);
      const handling = toCents(amt.breakdown.handling);
      const taxTotal = toCents(amt.breakdown.tax_total);
      const discount = toCents(amt.breakdown.discount);

      const expectedTotal = itemTotal + shipping + handling + taxTotal - discount;
      if (valCents !== expectedTotal) {
        errors.push('Breakdown mismatch on ' + pu.reference_id + ': value=' + valCents + ' vs breakdown=' + expectedTotal);
      }

      let sumLines = 0;
      for (const item of pu.items || []) {
        const u = Math.round(Number(item.unit_amount.value) * 100);
        const q = Number(item.quantity);
        sumLines += u * q;
      }
      if (sumLines !== itemTotal) {
        errors.push('Line item sum mismatch on ' + pu.reference_id + ': sumLines=' + sumLines + ' vs item_total=' + itemTotal);
      }

      grandTotalCents += valCents;
    }

    return {
      valid: errors.length === 0,
      errors,
      purchaseUnitCount: body.purchase_units.length,
      grandTotalCents
    };
  }

  /* ---------- Saga Compensating Transaction & Fault-Recovery Simulator ---------- */

  /**
   * Simulates an atomic multi-merchant PayPal Orders v2 checkout saga:
   * 1. AUTHORIZE all purchase units
   * 2. RESERVE_INVENTORY across allocated merchants
   * 3. If fault is injected on a target merchant:
   *    - Emit fault telemetry event
   *    - Execute VOID_AUTHORIZATION (`POST /v2/payments/authorizations/{auth_id}/void`) on failed purchase unit
   *    - Run REROUTE_OPTIMIZER excluding the faulted merchant within the buyer's budget cap
   *    - Create replacement authorization & capture for rerouted merchant(s)
   *    - Capture surviving original authorizations
   * 4. Produce SHA-256 hash-chained audit receipt across every step.
   */
  function simulateSagaExecution(scenarioInput, primarySolutionResult, faultConfig) {
    const scenario = typeof scenarioInput === 'string'
      ? getScenarioById(scenarioInput)
      : (scenarioInput || SCENARIOS[0]);

    const solverResult = primarySolutionResult && typeof primarySolutionResult.feasible === "boolean"
      ? primarySolutionResult
      : solveCart(scenario, primarySolutionResult);

    if (!solverResult || !solverResult.feasible || !solverResult.recommended) {
      throw new Error('simulateSagaExecution requires a feasible primary cart solution');
    }

    const initialPlan = solverResult.recommended;
    const faultType = (faultConfig && faultConfig.faultType && FAULT_CATALOG[faultConfig.faultType])
      ? faultConfig.faultType
      : 'NONE';
    const faultMeta = FAULT_CATALOG[faultType];

    // Pick target merchant to fault: either explicit faultConfig.targetMerchantId, or first merchant in initialPlan
    const allocatedMerchantIds = initialPlan.merchantBreakdowns.map((m) => m.merchantId);
    const targetMerchantId = (faultType !== 'NONE')
      ? (faultConfig && faultConfig.targetMerchantId && allocatedMerchantIds.includes(faultConfig.targetMerchantId)
        ? faultConfig.targetMerchantId
        : allocatedMerchantIds[0])
      : null;

    const initialOrder = buildPayPalOrderPayload(scenario, initialPlan, {
      intent: 'AUTHORIZE',
      stageTag: 'PRIMARY_AUTH'
    });

    const timeline = [];
    const apiCalls = [];
    let prevHash = '0'.repeat(64);
    let stepIndex = 0;

    function appendEvent(phase, status, actor, title, detail, apiRecord) {
      stepIndex += 1;
      const canonicalPayload = [
        stepIndex,
        phase,
        status,
        actor,
        title,
        detail,
        apiRecord ? apiRecord.endpoint : 'INTERNAL',
        apiRecord ? apiRecord.idempotencyKey : 'NONE',
        prevHash
      ].join('|');
      const eventHash = sha256Hex(canonicalPayload);
      const entry = {
        step: stepIndex,
        phase,
        status,
        actor,
        title,
        detail,
        apiRecord: apiRecord || null,
        prevHash,
        eventHash
      };
      prevHash = eventHash;
      timeline.push(entry);
      if (apiRecord) {
        apiCalls.push(apiRecord);
      }
      return entry;
    }

    // Step 1: Create Multi-Unit Order & Authorize
    appendEvent(
      'ORDER_CREATE',
      'SUCCESS',
      scenario.agentName,
      'Create Multi-Unit PayPal Order (' + initialPlan.shipmentCount + ' Purchase Units)',
      'Created Order ' + initialOrder.orderId + ' totaling ' + formatUsd(initialPlan.totalLandedCents) + ' across ' + initialPlan.shipmentCount + ' merchant(s).',
      {
        method: 'POST',
        endpoint: '/v2/checkout/orders',
        httpStatus: 201,
        idempotencyKey: initialOrder.headers['PayPal-Request-Id'],
        requestBody: initialOrder.body,
        responseSummary: { id: initialOrder.orderId, status: 'CREATED', purchaseUnits: initialPlan.shipmentCount }
      }
    );

    const authRecords = new Map();
    for (let i = 0; i < initialPlan.merchantBreakdowns.length; i++) {
      const mb = initialPlan.merchantBreakdowns[i];
      const pu = initialOrder.body.purchase_units[i];
      const authKey = computeIdempotencyKey(scenario.id, initialPlan.signature, 'AUTH_' + mb.merchantId);
      const authId = 'AUTH-' + sha256Hex(authKey).slice(0, 12).toUpperCase();
      authRecords.set(mb.merchantId, {
        authId,
        referenceId: pu.reference_id,
        merchantId: mb.merchantId,
        merchantName: mb.merchantName,
        amountCents: mb.unitTotalCents,
        status: 'AUTHORIZED'
      });

      appendEvent(
        'AUTHORIZE_UNIT',
        'AUTHORIZED',
        mb.merchantName,
        'Authorize Purchase Unit ' + pu.reference_id,
        'Authorized ' + formatUsd(mb.unitTotalCents) + ' (Auth ID ' + authId + ') for ' + mb.distinctSkuCount + ' SKU(s).',
        {
          method: 'POST',
          endpoint: '/v2/checkout/orders/' + initialOrder.orderId + '/authorize',
          httpStatus: 201,
          idempotencyKey: authKey,
          requestBody: { reference_id: pu.reference_id, amount: pu.amount },
          responseSummary: { authorization_id: authId, status: 'AUTHORIZED', amount: pu.amount.value }
        }
      );
    }

    // Nominal path: no fault injected
    if (faultType === 'NONE') {
      const captures = [];
      for (let i = 0; i < initialPlan.merchantBreakdowns.length; i++) {
        const mb = initialPlan.merchantBreakdowns[i];
        const auth = authRecords.get(mb.merchantId);
        const capKey = computeIdempotencyKey(scenario.id, initialPlan.signature, 'CAPTURE_' + mb.merchantId);
        const capId = 'CAP-' + sha256Hex(capKey).slice(0, 12).toUpperCase();

        appendEvent(
          'RESERVE_INVENTORY',
          'LOCKED',
          mb.merchantName,
          'Warehouse Stock & SLA Lock Confirmed',
          'Verified ' + mb.totalUnits + ' unit(s) ready for dispatch within ' + mb.maxDeliveryHours + 'h SLA.',
          null
        );

        appendEvent(
          'CAPTURE_UNIT',
          'CAPTURED',
          mb.merchantName,
          'Capture Authorization ' + auth.authId,
          'Captured ' + formatUsd(mb.unitTotalCents) + ' with final_capture=true (Capture ID ' + capId + ').',
          {
            method: 'POST',
            endpoint: '/v2/payments/authorizations/' + auth.authId + '/capture',
            httpStatus: 201,
            idempotencyKey: capKey,
            requestBody: {
              invoice_id: initialOrder.body.purchase_units[i].invoice_id,
              final_capture: true,
              amount: { currency_code: 'USD', value: centsToDollars(mb.unitTotalCents) }
            },
            responseSummary: { capture_id: capId, status: 'COMPLETED', amount: centsToDollars(mb.unitTotalCents) }
          }
        );

        auth.status = 'CAPTURED';
        captures.push({
          captureId: capId,
          authId: auth.authId,
          merchantId: mb.merchantId,
          merchantName: mb.merchantName,
          amountCents: mb.unitTotalCents
        });
      }

      return {
        sagaStatus: 'SETTLED_NOMINAL',
        faultInjected: false,
        faultType: 'NONE',
        faultLabel: faultMeta.label,
        faultedMerchantId: null,
        faultedMerchantName: null,
        recoverySucceeded: true,
        initialPlan,
        finalPlan: initialPlan,
        initialOrder,
        replacementOrder: null,
        costDeltaCents: 0,
        deliveryDeltaHours: 0,
        voidedAuthorizations: [],
        captures,
        timeline,
        apiCalls,
        receiptChainHeadHash: prevHash
      };
    }

    // Fault injected path:
    const faultedMb = initialPlan.merchantBreakdowns.find((m) => m.merchantId === targetMerchantId);
    const faultedAuth = authRecords.get(targetMerchantId);

    // Non-faulted merchants lock inventory cleanly
    for (const mb of initialPlan.merchantBreakdowns) {
      if (mb.merchantId === targetMerchantId) continue;
      appendEvent(
        'RESERVE_INVENTORY',
        'LOCKED',
        mb.merchantName,
        'Warehouse Stock & SLA Lock Confirmed',
        'Verified ' + mb.totalUnits + ' unit(s) ready for dispatch within ' + mb.maxDeliveryHours + 'h SLA.',
        null
      );
    }

    // Target merchant experiences injected fault
    const faultKey = computeIdempotencyKey(scenario.id, initialPlan.signature, 'FAULT_' + targetMerchantId + '_' + faultType);
    appendEvent(
      'FAULT_DETECTED',
      'FAULT',
      faultedMb.merchantName,
      'Fault Injected: ' + faultMeta.label,
      faultMeta.description + ' (' + faultMeta.paypalErrorName + ' / ' + faultMeta.paypalIssue + ' on ' + faultedAuth.referenceId + ').',
      {
        method: 'POST',
        endpoint: '/v2/payments/authorizations/' + faultedAuth.authId + '/capture',
        httpStatus: faultMeta.httpStatus,
        idempotencyKey: faultKey,
        requestBody: {
          final_capture: true,
          amount: { currency_code: 'USD', value: centsToDollars(faultedMb.unitTotalCents) }
        },
        responseSummary: {
          name: faultMeta.paypalErrorName,
          issue: faultMeta.paypalIssue,
          authorization_id: faultedAuth.authId,
          status: 'CAPTURE_ABORTED'
        }
      }
    );

    // Compensating Action 1: Void the failed authorization
    const voidKey = computeIdempotencyKey(scenario.id, initialPlan.signature, 'VOID_' + faultedAuth.authId);
    faultedAuth.status = 'VOIDED';
    const voidRecord = {
      authId: faultedAuth.authId,
      referenceId: faultedAuth.referenceId,
      merchantId: faultedMb.merchantId,
      merchantName: faultedMb.merchantName,
      voidedAmountCents: faultedMb.unitTotalCents,
      reason: faultMeta.paypalIssue
    };

    appendEvent(
      'COMPENSATING_VOID',
      'VOIDED',
      'CartConductor Saga Coordinator',
      'Void Authorization ' + faultedAuth.authId + ' (' + faultedMb.merchantName + ')',
      'Executed atomic void of ' + formatUsd(faultedMb.unitTotalCents) + ' on ' + faultedAuth.referenceId + ' to prevent stranded hold.',
      {
        method: 'POST',
        endpoint: '/v2/payments/authorizations/' + faultedAuth.authId + '/void',
        httpStatus: 204,
        idempotencyKey: voidKey,
        requestBody: { note_to_payee: 'Automated saga rollback due to ' + faultMeta.paypalIssue },
        responseSummary: { authorization_id: faultedAuth.authId, status: 'VOIDED' }
      }
    );

    // Compensating Action 2: Re-solve cart excluding the failed merchant while locking surviving merchant assignments
    const excludedList = Array.from(new Set([...(solverResult.constraints.excludedMerchants || []), targetMerchantId]));
    const rerouteResult = solveCart(scenario, Object.assign({}, solverResult.constraints, {
      excludedMerchants: excludedList
    }));

    if (!rerouteResult.feasible || !rerouteResult.recommended) {
      // Full rollback: void all remaining authorizations so buyer has zero partial exposure
      const allVoided = [voidRecord];
      for (const mb of initialPlan.merchantBreakdowns) {
        if (mb.merchantId === targetMerchantId) continue;
        const survAuth = authRecords.get(mb.merchantId);
        const rollbackKey = computeIdempotencyKey(scenario.id, initialPlan.signature, 'ROLLBACK_VOID_' + survAuth.authId);
        survAuth.status = 'VOIDED';
        allVoided.push({
          authId: survAuth.authId,
          referenceId: survAuth.referenceId,
          merchantId: mb.merchantId,
          merchantName: mb.merchantName,
          voidedAmountCents: mb.unitTotalCents,
          reason: 'SAGA_FULL_ABORT_BUDGET_GUARD'
        });
        appendEvent(
          'COMPENSATING_VOID',
          'VOIDED',
          'CartConductor Saga Coordinator',
          'Full Rollback Void ' + survAuth.authId + ' (' + mb.merchantName + ')',
          'No feasible fallback within ' + formatUsd(solverResult.constraints.budgetCents) + ' budget cap; voided surviving hold of ' + formatUsd(mb.unitTotalCents) + '.',
          {
            method: 'POST',
            endpoint: '/v2/payments/authorizations/' + survAuth.authId + '/void',
            httpStatus: 204,
            idempotencyKey: rollbackKey,
            requestBody: { note_to_payee: 'Full saga abort: fallback exceeded buyer constraints' },
            responseSummary: { authorization_id: survAuth.authId, status: 'VOIDED' }
          }
        );
      }

      return {
        sagaStatus: 'ROLLED_BACK_SAFE',
        faultInjected: true,
        faultType,
        faultLabel: faultMeta.label,
        faultedMerchantId: targetMerchantId,
        faultedMerchantName: faultedMb.merchantName,
        recoverySucceeded: false,
        initialPlan,
        finalPlan: null,
        initialOrder,
        replacementOrder: null,
        costDeltaCents: 0,
        deliveryDeltaHours: 0,
        voidedAuthorizations: allVoided,
        captures: [],
        timeline,
        apiCalls,
        receiptChainHeadHash: prevHash
      };
    }

    const fallbackPlan = rerouteResult.recommended;
    const costDeltaCents = fallbackPlan.totalLandedCents - initialPlan.totalLandedCents;
    const deliveryDeltaHours = fallbackPlan.maxDeliveryHours - initialPlan.maxDeliveryHours;

    appendEvent(
      'SAGA_REROUTE',
      'REOPTIMIZED',
      'CartConductor Branch-and-Bound Solver',
      'Rerouted Cart Excluding ' + faultedMb.merchantName,
      'Selected fallback allocation at ' + formatUsd(fallbackPlan.totalLandedCents) + ' (' +
        (costDeltaCents >= 0 ? '+' : '') + formatUsd(costDeltaCents) + ' vs primary, ' +
        fallbackPlan.maxDeliveryHours + 'h SLA, ' + formatUsd(fallbackPlan.budgetRemainingCents) + ' under budget cap).',
      null
    );

    // If any surviving merchant in initialPlan had its bundle total changed or was replaced in fallbackPlan,
    // void any authorization that is no longer identical and issue replacement authorization(s).
    const voidedAuthorizations = [voidRecord];
    const captures = [];

    const replacementOrder = buildPayPalOrderPayload(scenario, fallbackPlan, {
      intent: 'AUTHORIZE',
      stageTag: 'FALLBACK_REROUTE_' + targetMerchantId
    });

    for (let i = 0; i < fallbackPlan.merchantBreakdowns.length; i++) {
      const fbMb = fallbackPlan.merchantBreakdowns[i];
      const existingOriginMb = initialPlan.merchantBreakdowns.find((m) => m.merchantId === fbMb.merchantId);
      const existingAuth = authRecords.get(fbMb.merchantId);

      const canReuseExistingAuth =
        existingOriginMb &&
        existingAuth &&
        existingAuth.status === 'AUTHORIZED' &&
        existingOriginMb.unitTotalCents === fbMb.unitTotalCents;

      let activeAuthId;
      let invoiceId = replacementOrder.body.purchase_units[i].invoice_id;

      if (canReuseExistingAuth) {
        activeAuthId = existingAuth.authId;
      } else {
        if (existingAuth && existingAuth.status === 'AUTHORIZED') {
          // Amount changed because fallback added bundled SKUs to this surviving merchant; void old hold and re-authorize exact amount
          const rebundleVoidKey = computeIdempotencyKey(scenario.id, fallbackPlan.signature, 'VOID_REBUNDLE_' + existingAuth.authId);
          existingAuth.status = 'VOIDED';
          voidedAuthorizations.push({
            authId: existingAuth.authId,
            referenceId: existingAuth.referenceId,
            merchantId: fbMb.merchantId,
            merchantName: fbMb.merchantName,
            voidedAmountCents: existingOriginMb.unitTotalCents,
            reason: 'REBUNDLE_AMOUNT_UPDATED'
          });
          appendEvent(
            'COMPENSATING_VOID',
            'VOIDED',
            'CartConductor Saga Coordinator',
            'Void Superseded Hold ' + existingAuth.authId + ' for Re-Bundling',
            'Voided prior hold of ' + formatUsd(existingOriginMb.unitTotalCents) + ' on ' + fbMb.merchantName + ' to re-authorize updated bundle (' + formatUsd(fbMb.unitTotalCents) + ').',
            {
              method: 'POST',
              endpoint: '/v2/payments/authorizations/' + existingAuth.authId + '/void',
              httpStatus: 204,
              idempotencyKey: rebundleVoidKey,
              requestBody: { note_to_payee: 'Superseded by re-bundled fallback purchase unit' },
              responseSummary: { authorization_id: existingAuth.authId, status: 'VOIDED' }
            }
          );
        }

        const pu = replacementOrder.body.purchase_units[i];
        const newAuthKey = computeIdempotencyKey(scenario.id, fallbackPlan.signature, 'FALLBACK_AUTH_' + fbMb.merchantId);
        activeAuthId = 'AUTH-' + sha256Hex(newAuthKey).slice(0, 12).toUpperCase();

        appendEvent(
          'AUTHORIZE_FALLBACK',
          'AUTHORIZED',
          fbMb.merchantName,
          'Authorize Fallback Unit ' + pu.reference_id + ' (' + fbMb.merchantName + ')',
          'Authorized ' + formatUsd(fbMb.unitTotalCents) + ' (Auth ID ' + activeAuthId + ') for ' + fbMb.distinctSkuCount + ' SKU(s) at ' + fbMb.maxDeliveryHours + 'h SLA.',
          {
            method: 'POST',
            endpoint: '/v2/checkout/orders/' + replacementOrder.orderId + '/authorize',
            httpStatus: 201,
            idempotencyKey: newAuthKey,
            requestBody: { reference_id: pu.reference_id, payee: pu.payee, amount: pu.amount },
            responseSummary: { authorization_id: activeAuthId, status: 'AUTHORIZED', amount: pu.amount.value }
          }
        );
      }

      const capKey = computeIdempotencyKey(scenario.id, fallbackPlan.signature, 'FALLBACK_CAPTURE_' + fbMb.merchantId);
      const capId = 'CAP-' + sha256Hex(capKey).slice(0, 12).toUpperCase();

      appendEvent(
        'CAPTURE_UNIT',
        'CAPTURED',
        fbMb.merchantName,
        'Capture Settled Unit ' + activeAuthId,
        'Captured ' + formatUsd(fbMb.unitTotalCents) + ' with final_capture=true (Capture ID ' + capId + ').',
        {
          method: 'POST',
          endpoint: '/v2/payments/authorizations/' + activeAuthId + '/capture',
          httpStatus: 201,
          idempotencyKey: capKey,
          requestBody: {
            invoice_id: invoiceId,
            final_capture: true,
            amount: { currency_code: 'USD', value: centsToDollars(fbMb.unitTotalCents) }
          },
          responseSummary: { capture_id: capId, status: 'COMPLETED', amount: centsToDollars(fbMb.unitTotalCents) }
        }
      );

      captures.push({
        captureId: capId,
        authId: activeAuthId,
        merchantId: fbMb.merchantId,
        merchantName: fbMb.merchantName,
        amountCents: fbMb.unitTotalCents
      });
    }

    return {
      sagaStatus: 'RECOVERED_AND_CAPTURED',
      faultInjected: true,
      faultType,
      faultLabel: faultMeta.label,
      faultedMerchantId: targetMerchantId,
      faultedMerchantName: faultedMb.merchantName,
      recoverySucceeded: true,
      initialPlan,
      finalPlan: fallbackPlan,
      initialOrder,
      replacementOrder,
      costDeltaCents,
      deliveryDeltaHours,
      voidedAuthorizations,
      captures,
      timeline,
      apiCalls,
      receiptChainHeadHash: prevHash
    };
  }

  /**
   * Verifies the integrity of a saga timeline's SHA-256 hash chain.
   */
  function verifySagaReceiptChain(timeline) {
    if (!Array.isArray(timeline) || timeline.length === 0) {
      return { valid: false, reason: 'EMPTY_TIMELINE', verifiedSteps: 0 };
    }
    let expectedPrev = '0'.repeat(64);
    for (let i = 0; i < timeline.length; i++) {
      const ev = timeline[i];
      if (ev.prevHash !== expectedPrev) {
        return { valid: false, reason: 'PREV_HASH_MISMATCH_AT_STEP_' + ev.step, verifiedSteps: i };
      }
      const canonicalPayload = [
        ev.step,
        ev.phase,
        ev.status,
        ev.actor,
        ev.title,
        ev.detail,
        ev.apiRecord ? ev.apiRecord.endpoint : 'INTERNAL',
        ev.apiRecord ? ev.apiRecord.idempotencyKey : 'NONE',
        ev.prevHash
      ].join('|');
      const recomputed = sha256Hex(canonicalPayload);
      if (recomputed !== ev.eventHash) {
        return { valid: false, reason: 'EVENT_HASH_MISMATCH_AT_STEP_' + ev.step, verifiedSteps: i };
      }
      expectedPrev = ev.eventHash;
    }
    return {
      valid: true,
      reason: 'OK',
      verifiedSteps: timeline.length,
      headHash: expectedPrev
    };
  }

  return {
    MERCHANTS,
    SCENARIOS,
    FAULT_CATALOG,
    sha256Hex,
    centsToDollars,
    formatUsd,
    getMerchantById,
    getScenarioById,
    evaluateAssignment,
    dominates,
    solveCart,
    computeIdempotencyKey,
    buildPayPalOrderPayload,
    validatePayPalOrderPayload,
    simulateSagaExecution,
    verifySagaReceiptChain
  };
});
