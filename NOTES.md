# Build Notes

Written 2026-10-28.

## Design & Engineering Decisions

- **Integer Cents and Basis Points:** Every monetary calculation in `engine.js` (`unitPriceCents`, `itemSubtotalCents`, `discountCents`, `shippingCents`, `handlingCents`, `taxCents`, `unitTotalCents`, `totalLandedCents`) uses exact integer cents. Bundle discounts use `Math.floor((itemSubtotalCents * bundleDiscountBps) / 10000)` and taxes use `Math.round((netItemsCents * taxRateBps) / 10000)`.
- **Branch-and-Bound Pruning:** Before searching item-to-merchant assignments, `solveCart` precomputes a suffix array of optimistic minimum item costs (`suffixMinCost`) assuming maximum bundle discounts and zero shipping. Branches that cannot beat the buyer's hard `budgetCents` ceiling are pruned immediately.
- **Compensating Saga State Machine:** In multi-vendor agentic checkout, a failure on one merchant during warehouse lock can invalidate bundle math if fallback SKUs are merged into an already-authorized surviving merchant. When `simulateSagaExecution` reroutes a faulted merchant's SKUs onto a surviving merchant whose purchase unit total changes, it explicitly voids the superseded authorization (`VOID_REBUNDLE_*`) and creates a fresh authorization for the updated bundle before capturing. If the buyer's budget cap is too tight to permit any fallback, the saga voids every surviving authorization (`ROLLED_BACK_SAFE`).
- **Self-Contained SHA-256:** `sha256Hex` in `engine.js` implements FIPS 180-4 SHA-256 in pure JavaScript and is verified against Node's native `crypto.createHash('sha256')` across empty, ASCII, UTF-8, surrogate pair, and multi-block inputs.

## What Was Verified

- All 46 automated tests in `tests/engine.test.js` (28 tests) and `tests/dom-smoke.test.js` (18 tests) pass via `node --test`.
- Every procurement scenario (`SCENARIO_ROBOTICS_RIG`, `SCENARIO_BIO_BENCH`, `SCENARIO_RACK_CLUSTER`) and every capture fault mode (`NONE`, `OUT_OF_STOCK_AT_CAPTURE`, `THREE_DS_CHALLENGE_REQUIRED`, `SHIPPING_SLA_SLIPPAGE`, `PARTIAL_FULFILLMENT`) produces a valid SHA-256 audit receipt chain and passes `validatePayPalOrderPayload` with zero schema or breakdown errors.
- Hark honesty and planted-defect harness checks pass with zero violations.

## What Is Simulated

- PayPal Orders v2 REST endpoints (`/v2/checkout/orders`, `/v2/checkout/orders/{id}/authorize`, `/v2/payments/authorizations/{auth_id}/capture`, `/v2/payments/authorizations/{auth_id}/void`) are simulated deterministically in-memory so the application runs offline and in static browser environments without requiring live PayPal API credentials.
