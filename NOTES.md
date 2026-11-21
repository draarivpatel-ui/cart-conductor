# CartConductor implementation notes

## Engine

All catalog money uses integer cents and basis points. The solver prunes item-to-merchant branches with an optimistic suffix bound before computing real shipment, bundle, tax and reliability constraints. Greedy and single-merchant baselines are computed on the same scenario and can be infeasible.

The compensating saga voids superseded authorizations when rerouting changes a surviving merchant bundle. It voids all remaining holds when no fallback fits. The receipt chain uses a pure SHA-256 implementation checked against the native digest. Payment endpoints and catalog scenarios are deterministic local fixtures.

## Analytics

Five waterfall stages reconstruct landed cost. Unsafe reconstructed sums are rejected. The sensitivity deck runs the real solver at sampled budget caps and identifies separate count and cost axes. Its first feasible budget is sampled rather than an exact threshold. Crowding distance ignores constant objectives, and unavailable baselines produce no savings rate.

## Verification

Run `npm test`. README.md and DEVPOST_UPGRADE.md record exact current counts for engine, analytics, mounted UI and self-scanning content tests. Fault stress checks verify receipt chains and payment amount schemas across every fixture scenario and allocated merchant. These local results do not imply an actual authorization, capture or deployment.

## Revamp Pass 2026-11-21

- Saga compensation now voids a surviving merchant authorization when the fallback plan drops that merchant entirely. Previously the hold stayed `AUTHORIZED` while the saga reported `RECOVERED_AND_CAPTURED`.
- `solveCart` bounds its work: carts over 1024 items return `CART_TOO_LARGE`, and search aborts with `SEARCH_LIMIT_EXCEEDED` past 250,000 nodes or 50,000 feasible solutions (override via `constraints.maxSearchNodes`). Deep or wide custom carts no longer exhaust the heap or the call stack.
- Input hardening across the solver family. Malformed scenario shapes throw a clean `Error`; NaN `maxSlaHours`/`minReliability`/`budgetCents` fall back to scenario defaults instead of silently disabling the constraint; item quantities must be positive safe integers and offer price, stock and delivery fields must be finite non-negative integers (invalid lines report `INVALID_ITEM_QUANTITY`, `INVALID_ITEM_DATA` or `INVALID_OFFER_DATA`). `excludedMerchants` accepts a single merchant id string and throws a clean error on other non-iterables instead of treating a string as a character set.
- Duplicate cart lines of the same SKU now accumulate stock per merchant plus SKU before the stock check, and `distinctSkuCount` counts real SKUs, so two lines of one SKU can no longer overdraw stock or trigger a phantom bundle discount.
- `validatePayPalOrderPayload` returns `{ valid: false }` instead of throwing on malformed `purchase_units`/`items`, and rejects negative or non-numeric amounts, breakdown components, unit prices and quantities.
- The saga receipt chain now hashes each API record's `requestBody` and `responseSummary` alongside endpoint and idempotency key, so tampering with recorded amounts or reference ids fails verification. `verifySagaReceiptChain` also guards malformed entries and requires sequential step numbers; `scenarioStressTest` and the app badge compare the verified head hash against `receiptChainHeadHash`.
- `scenarioStressTest` runs the `NONE` nominal case once instead of once per merchant.
- `paretoCrowdingDistance` ignores malformed frontier entries instead of throwing.
- `sha256Hex` now matches the platform UTF-8 digest on lone surrogates (encodes U+FFFD).
- `centsToDollars` requires safe integer cents instead of silently rounding fractional input.
- Contrast: `--ink-muted` darkened to `#5F6469`, `--vermilion-rollback` to `#B0412B`, dominated-dot swatch to `#8A8478` so small text meets WCAG AA 4.5:1 and the non-text swatch meets 3:1 on the panel backgrounds. Added the missing `.text-muted` rule and a `.kpi-negative` class so a negative savings KPI no longer renders in the positive green. Dead `bestCostSoFar` state removed.
- `tests/robustness.test.js` adds 17 tests covering every fix above.
