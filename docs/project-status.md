# Project status

Last updated: 2026-08-30 (Asia/Shanghai)

## Current status

- Working name: **Credit Trade**. This is provisional and must be confirmed before publication.
- GitHub visibility: **private** (confirmed by the user on 2026-08-30). Public publication is prohibited.
- Lifecycle state: `SANDBOX` for the market-neutral local build; every real market remains `DESIGN_ONLY`.
- Release state: no RC or GA exists; no completion-state claim is applicable yet.
- Code status: initial in-memory TypeScript sandbox implemented and exercised through the HTTP API.
- Payment status: synthetic buyer funding, hold, settlement and release are implemented in an in-memory balanced ledger. No payment-provider sandbox is integrated or verified.
- GitHub status: no remote repository, tag, or Release has been created or verified.
- Legal/operational status: no market has supplied the evidence required for real-money operation.
- Live-transaction status: no real-money transaction is authorized or has been attempted.

The product is an authorized API inference-service marketplace. It is not a marketplace for consumer subscriptions or transferable API credits, and it will not implement a freely transferable stored-value wallet.

## Product flow change — 2026-08-30

The supplier now registers an API endpoint that it controls. The platform safely classifies the endpoint protocol, operator, upstream vendor and canonical model, verifies account control and written authorization, binds an approved versioned supplier price, and only then publishes a buyer-facing inference-service offer.

Technical identification does not establish authorization or price authority. Unknown vendors and endpoints stay open for registration, draft pricing and sandbox work as `PENDING_REVIEW`; they are not presumed prohibited. Conflicting or unsafe endpoints are quarantined, and only explicit evidence creates `PROHIBITED`. None can generate a production route or real payment before approval.

## Phase progress

| Phase | Status | Evidence / exit condition |
|---|---|---|
| 0 — Baseline | Complete locally | `docs/phase-0-baseline.md`; local Git repository and SHA-256 evidence manifest |
| 1 — Admission research | Not started | Official-source vendor/account/resale/region evidence matrices reviewed and hashed |
| 2 — Requirements and architecture freeze | Draft updated; not frozen | Supplier endpoint registry, identification/evidence separation and pricing flow drafted; Phase 1 evidence, PRD, API, ledger and threat-model review pending |
| 3 — Sandbox vertical slice | Initial slice complete | Mock endpoint registration, vendor identification, price, buyer quote, hold, inference, usage, settlement and release executed; payout/refund/chargeback remain pending |
| 4 — Shared core | Partial | In-memory supplier, endpoint, buyer API key, quote, metering and ledger core implemented; persistence, RBAC/MFA, streaming and full controls pending |
| 5 — Payment and settlement adapters | Not started | Sandbox webhooks and fail-closed production gate verified |
| 6 — Market packages | Not started | Independently built market artifacts |
| 7 — Test program | Initial suite passing | 16 Node tests pass; complete Phase 7 matrix and dedicated scanners remain pending |
| 8 — Release preparation | Not started | SBOM, provenance, hashes, runbooks, scans |
| 9 — Release Candidate | Not started | Remote prerelease exists and RC gates pass |
| 10 — External approvals and live pilot | Blocked externally | Required evidence, production accounts, and explicit amount authorization |
| 11 — Stable release | Blocked externally | Per-market live-pilot closeout plus explicit GitHub publication authorization |

## Market states

| Market | State | Real payments | Reason |
|---|---|---|---|
| China mainland | `DESIGN_ONLY` | Not available | Only a market-neutral local sandbox exists; no market pack or admission evidence |
| Hong Kong | `DESIGN_ONLY` | Not available | Only a market-neutral local sandbox exists; no market pack or admission evidence |
| Singapore | `DESIGN_ONLY` | Not available | Only a market-neutral local sandbox exists; no market pack or admission evidence |
| United States | `DESIGN_ONLY` | Not available | States are not scoped; no market pack or admission evidence |
| European Union | `DESIGN_ONLY` | Not available | Member states are not scoped; no market pack or admission evidence |

“Not available” means no real payment or production market route exists. The local service uses generated API keys, mock providers and synthetic balances only; it contains no production-mode switch.

## Initial sandbox verification

- Standard test command: 16 passed, 0 failed.
- End-to-end HTTP demo: passed.
- Detected mock vendor: `ACME_AI`.
- Unknown-vendor policy: `PENDING_REVIEW`.
- Real provider used: no.
- Production payment available: no.
- Ledger result: balanced, four journals in the demo flow.
- Independent static TypeScript typecheck: not run because `tsc` is not installed; Node 24 syntax checks passed.

## Phase 0 assumptions

1. The current directory is the authorized working directory.
2. The repository is greenfield. Stable TypeScript in a single repository is the provisional implementation stack.
3. The shared core will have separate control-plane and inference data-plane services, PostgreSQL, Redis, OpenTelemetry, and Docker Compose unless measurements in Phase 2 justify a change.
4. Initial integrations will use simulated supplier endpoints and sandbox/example identification adapters. No detected vendor or endpoint becomes a production route without corroborated control, written permission and market admission.
5. All five requested markets remain fail-closed for real payments. Missing evidence is treated as `PENDING_REVIEW`.
6. `main` may be used as a provisional local branch name; it is not a confirmed GitHub default branch.
7. Platform fees, funding/payout thresholds, settlement cycle, refund/chargeback/reserve rules, and performance targets remain configurable placeholders until supplied.
8. Any future GitHub repository and Release must remain private. This does not itself authorize repository creation, push, tagging, Release creation, paid resources, real payments, production deployment, or container push.

## Immediate next work

The code-first next slice is persistence, automatic eligible-offer routing, streaming/cancellation and the remaining simulated settlement/refund paths. Official-source review remains deferred per current priority; until it is performed, unknown vendors remain registered as `PENDING_REVIEW` and all production paths stay unavailable.

## Recovery point

The immutable Phase 0 recovery point is local commit `2f509eb23ef14dbd43f77172fd6947a78f573b71`. Its files are listed in `docs/phase-0-baseline.md` and hashed by `docs/evidence/phase-0.sha256`. Later working-tree versions are expected to differ. There is no remote recovery point.
