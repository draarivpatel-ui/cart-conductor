# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/cart-conductor/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static CartConductor browser workbench, including the allocation solver, simulated payment payloads, compensating fault recovery, receipt chain, lab bookmark codec, exports and browser rendering.

In scope:

- A cross-site scripting or HTML injection path through merchant data, allocation results, fault events, bookmark state, receipt text or report output.
- A bookmark decoder or serialization flaw that bypasses validation, corrupts another lab state, or executes attacker-controlled code.
- A receipt-chain, amount-check or digest flaw that makes a simulated payment or audit artifact appear valid when its payload was altered.
- A CSV, JSON or Markdown export escaping flaw that makes generated output execute a formula or script when opened.
- A payment simulation boundary flaw that causes a real network payment call; the workbench must never authorize or capture money.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- Behavior caused solely by a user typing or pasting content into their own local browser session, unless it crosses a documented application boundary.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
