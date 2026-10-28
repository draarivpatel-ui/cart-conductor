# CartConductor

**Multi-Vendor Agentic Checkout, Split-Capture & Failure-Recovery Orchestrator for PayPal Orders v2**

Live Deployment: [https://aariv.me/cart-conductor/](https://aariv.me/cart-conductor/)

CartConductor is a zero-dependency JavaScript solver and compensating transaction simulator built for autonomous buyer agents executing multi-item, multi-merchant procurement over PayPal Orders v2 (`/v2/checkout/orders` and `/v2/payments/authorizations`).

When an AI procurement agent needs to source a multi-SKU hardware build across competing vendors, naive per-item greedy selection often misses multi-item bundle thresholds, triggers duplicate shipping fees, or violates delivery SLA deadlines. Worse, if one merchant in a multi-vendor cart fails inventory lock or triggers an interactive 3DS challenge at capture time, an uncoordinated checkout leaves the buyer with stranded partial holds.

CartConductor solves both problems deterministically:

1. **Branch-and-Bound & Pareto Multi-Merchant Cart Solver (`engine.js`):**
   - Evaluates multi-item procurement mandates across an 8-merchant catalog (`MERCH_APEX`, `MERCH_NOVA`, `MERCH_KINETIC`, `MERCH_VERIDIAN`, `MERCH_HYPERION`, `MERCH_PULSE`, `MERCH_STRATA`, `MERCH_ZENITH`).
   - Models integer-cent unit pricing, per-merchant multi-SKU bundle discounts (basis points), free-shipping thresholds, handling fees, regional tax rates, warehouse stock limits, delivery SLA hours, and merchant clearing reliability scores.
   - Computes the exact Pareto frontier across `Lowest Total Landed Cost`, `Fastest Guaranteed Delivery`, and `Fewest Split Shipments`, and benchmarks savings against naive greedy unbundled selection and single-merchant baselines.

2. **PayPal Orders v2 Multi-Unit & Compensating Saga Simulator (`engine.js` & `app.js`):**
   - Orchestrates an atomic multi-merchant checkout lifecycle: `ORDER_CREATE` -> `AUTHORIZE_UNIT` -> `RESERVE_INVENTORY` -> `CAPTURE_UNIT`.
   - Supports interactive fault injection on any allocated merchant (`Out of Stock at Capture`, `3DS Challenge Required`, `Shipping SLA Slippage`, `Partial Fulfillment`).
   - Automatically executes compensating voids (`POST /v2/payments/authorizations/{auth_id}/void`) on failed or superseded holds, re-runs the branch-and-bound solver excluding the faulted merchant within the buyer's hard budget cap, and issues replacement authorizations and captures. If no valid fallback exists within the buyer's budget cap, the coordinator voids all remaining authorizations so the buyer has zero stranded liability.
   - Chains every saga event into a verifiable SHA-256 hash chain (`verifySagaReceiptChain`).

3. **PayPal Orders v2 Payload & Idempotency Inspector:**
   - Generates and validates `POST /v2/checkout/orders` payloads containing per-merchant `purchase_units[]` (`reference_id`, `custom_id`, `invoice_id`, `payee`, `amount.breakdown` with `item_total`, `shipping`, `handling`, `tax_total`, `discount`, `items[]`, and `shipping`), paired with deterministic UUID-v4-shaped `PayPal-Request-Id` idempotency keys.

## Running Locally

CartConductor uses pure vanilla JavaScript (`engine.js` and `app.js`) with zero external runtime or test dependencies.

```bash
# Run the 46-test verification suite (Node.js >= 18)
npm test
```

Open `index.html` directly in any modern browser or serve the directory with any static HTTP server.

## Architecture

- `engine.js`: Pure functional UMD module exporting SHA-256 (`sha256Hex`), integer-cent currency formatting, the 8-merchant catalog, 3 procurement scenarios, `evaluateAssignment`, `solveCart`, `buildPayPalOrderPayload`, `validatePayPalOrderPayload`, `simulateSagaExecution`, and `verifySagaReceiptChain`.
- `app.js`: Interactive DOM controller managing constraint sliders, optimization mode cards, allocation matrix tables, the Pareto frontier SVG chart, the fault-injection saga timeline, and the PayPal JSON payload inspector.
- `index.html` & `styles.css`: Financial Times / Stripe Press ledger interface (`#F7F4ED` paper background, `#EDE8DD` panel cards, `#141516` ink, `#1B4D8E` settlement navy, `#1B6B50` authorized green, `#C84B31` rollback vermilion).
- `tests/engine.test.js` & `tests/dom-smoke.test.js`: 46 automated unit and DOM integration tests.

## License

MIT License. See [LICENSE](LICENSE).
