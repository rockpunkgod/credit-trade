# Project status

Last updated: 2026-08-30 (Asia/Shanghai)

## Current status

- Working name: **Credit Trade**. This is provisional and must be confirmed before publication.
- GitHub visibility: **private** (confirmed by the user on 2026-08-30). Public publication is prohibited.
- Lifecycle state: `DESIGN_ONLY`.
- Release state: no RC or GA exists; no completion-state claim is applicable yet.
- Code status: no application code has been implemented.
- Payment status: no payment adapter or sandbox has been implemented or tested.
- GitHub status: no remote repository, tag, or Release has been created or verified.
- Legal/operational status: no market has supplied the evidence required for real-money operation.
- Live-transaction status: no real-money transaction is authorized or has been attempted.

The product is an authorized API inference-service marketplace. It is not a marketplace for consumer subscriptions or transferable API credits, and it will not implement a freely transferable stored-value wallet.

## Phase progress

| Phase | Status | Evidence / exit condition |
|---|---|---|
| 0 — Baseline | Complete locally | `docs/phase-0-baseline.md`; local Git repository and SHA-256 evidence manifest |
| 1 — Admission research | Not started | Official-source evidence matrices reviewed and hashed |
| 2 — Requirements and architecture freeze | Not started | PRD, diagrams, ledger model, API contract, threat model, ADR review |
| 3 — Sandbox vertical slice | Not started | Executed end-to-end sandbox flow with balanced ledger |
| 4 — Shared core | Not started | Implemented and tested scope traceability |
| 5 — Payment and settlement adapters | Not started | Sandbox webhooks and fail-closed production gate verified |
| 6 — Market packages | Not started | Independently built market artifacts |
| 7 — Test program | Not started | Saved test and security evidence |
| 8 — Release preparation | Not started | SBOM, provenance, hashes, runbooks, scans |
| 9 — Release Candidate | Not started | Remote prerelease exists and RC gates pass |
| 10 — External approvals and live pilot | Blocked externally | Required evidence, production accounts, and explicit amount authorization |
| 11 — Stable release | Blocked externally | Per-market live-pilot closeout plus explicit GitHub publication authorization |

## Market states

| Market | State | Real payments | Reason |
|---|---|---|---|
| China mainland | `DESIGN_ONLY` | Not available | No application or admission evidence exists |
| Hong Kong | `DESIGN_ONLY` | Not available | No application or admission evidence exists |
| Singapore | `DESIGN_ONLY` | Not available | No application or admission evidence exists |
| United States | `DESIGN_ONLY` | Not available | States are not scoped and no admission evidence exists |
| European Union | `DESIGN_ONLY` | Not available | Member states are not scoped and no admission evidence exists |

“Not available” currently means there is no running service. It must later be enforced by an audited server-side admission gate; this document is not that control.

## Phase 0 assumptions

1. The current directory is the authorized working directory.
2. The repository is greenfield. Stable TypeScript in a single repository is the provisional implementation stack.
3. The shared core will have separate control-plane and inference data-plane services, PostgreSQL, Redis, OpenTelemetry, and Docker Compose unless measurements in Phase 2 justify a change.
4. Initial integrations will be interfaces, a simulated supplier, and sandbox/example adapters. No production model vendor is enabled without written permission.
5. All five requested markets remain fail-closed for real payments. Missing evidence is treated as `PENDING_REVIEW`.
6. `main` may be used as a provisional local branch name; it is not a confirmed GitHub default branch.
7. Platform fees, funding/payout thresholds, settlement cycle, refund/chargeback/reserve rules, and performance targets remain configurable placeholders until supplied.
8. Any future GitHub repository and Release must remain private. This does not itself authorize repository creation, push, tagging, Release creation, paid resources, real payments, production deployment, or container push.

## Immediate next work

Phase 1 can begin without production credentials: collect current official and first-party sources, create public redacted evidence matrices, and leave every unresolved cell fail-closed. Phase 2 can then freeze the technical contract around those constraints.

## Recovery point

The Phase 0 recovery point consists of the first local Git commit, the files listed in `docs/phase-0-baseline.md`, and their SHA-256 manifest. There is no remote recovery point.
