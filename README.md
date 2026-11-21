# CartConductor

A local multi-merchant cart solver and compensating checkout simulator. The catalog and procurement scenarios are deterministic fixtures. Payment payloads and fault recovery are simulated; no payment is authorized or captured.

## Workbench

- Solve allocations across the eight fixture merchants and three scenarios using integer cents, stock, budget, delivery and reliability constraints.
- Compare the real per-item greedy and single-merchant baselines computed for the same scenario. An infeasible baseline is displayed as unavailable.
- Inspect cost, delivery, shipment count and joint reliability on the Pareto frontier.
- Inject merchant faults, inspect compensation events, and verify the computed SHA-256 receipt chain and payload amount checks.
- Inspect a five-stage cost waterfall, sampled budget sensitivity, solver diagnostics and frontier crowding scores.

## Analytics

| Function | Calculation |
| --- | --- |
| `costWaterfall` | Items minus bundle discount plus shipping, handling and tax reconstruct landed cost in safe integer cents. Shares are absolute stage magnitude divided by landed cost, not a partition. |
| `budgetSensitivityCurve` | Re-solves at 2 to 64 sampled budgets over 70 to 130 percent of the current cap. The first feasible point is a sampled cap; the minimum reported cost is a sampled minimum. |
| `paretoCrowdingDistance` | Normalized neighboring gaps across four objectives. Constant objectives add nothing; singleton and pair frontiers are boundaries. |
| `solverDiagnostics` | Prune event share is `pruned / (explored + pruned)`. Compression is `(feasible - frontier) / feasible`. Savings rates can be negative for faster or fewer-shipment strategies, and unavailable baselines return `null`. |
| `scenarioStressTest` | Runs each fault type for each allocated merchant and checks receipt chains and payload invariants. |

The UI sensitivity control selects 4 to 24 actual recomputations. Every panel refreshes after a scenario or constraint change. Empty and infeasible states clear stale data.

## Run and verify

Node 18 or newer, with no package installation.

```bash
npm test
```

Open `index.html` directly or use a static server. Fonts are self hosted, with their licenses in `fonts/OFL.txt`.

## Files

- `engine.js` contains the solver, payment simulator and analytics.
- `app.js`, `index.html` and `styles.css` contain the controller and ledger interface.
- `tests/` contains engine, analytics, mounted controller and content checks.
- `DEVPOST_UPGRADE.md` records completed repairs and verification.

<!-- verification -->

MIT. See `LICENSE`.
