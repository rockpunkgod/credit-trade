# Project status

Last updated: 2026-09-01 (Asia/Shanghai)

## Current status

- Working name: **Credit Trade**. This is provisional and must be confirmed before publication.
- GitHub visibility: **private** (confirmed by the user on 2026-08-30). Public publication is prohibited.
- Lifecycle state: `SANDBOX` for the market-neutral local build; every real market remains `DESIGN_ONLY`.
- Release state: no RC or GA exists; no completion-state claim is applicable yet.
- Code status: the in-memory TypeScript sandbox includes an independent versioned meter/rating module, exact rational rates, content-digest-bound records and process-local domain-separated HMAC coverage for synthetic supplier/KYB-fixture records, buyer metadata/API-key hashes, platform fee/quote-lifetime policy, provider endpoints, version-linked supply prices, quote policy, usage, rating, complete inference-ledger content, full currency-ledger checkpoints and settlement. It also includes exact buyer/API-key-hash and quote/idempotency Map coverage, price-stream heads, locale-independent balance-digest ordering, balance replay, business-key reconstruction, an opaque HMAC idempotency request code, canonical inference/record coverage, currency-scoped settlement chains/heads and rollback-protected journal/checkpoint batches. Existing HTTP response fields remain unchanged.
- Integrity status: full policy/identity/catalog/ledger/billing verification runs before endpoint registration, price publication, buyer funding, quote creation and inference, so detected historical tampering blocks new billing mutations. Tests cover platform fee/quote-lifetime state edits, supplier/KYB-fixture and buyer/API-key-hash attribution changes, catalog and record/scope changes, forged Map placement, sparse/decorated arrays, funding and inference-ledger forgery, materialized-balance changes, idempotency replay, quote consumption/coverage, latest-price deletion and settlement/checkpoint deletion or ordering changes while the active HMAC keys, policy seal, local heads and checkpoint histories remain trusted. Buyer creation also leaves no identity, hash-index, journal or checkpoint residue in the tested checkpoint-signing failure. This is not encryption, a digital signature, configuration approval, authoritative provider metering or durable audit evidence. The default key, seals, heads and checkpoints are ephemeral; endpoints have no independent externally anchored inventory head, and KMS/HSM custody, persistent key rotation/history, external anchors and append-only/WORM storage are not implemented.
- Payment status: synthetic buyer funding, hold, settlement and release are implemented in an in-memory balanced ledger. No payment-provider sandbox is integrated or verified.
- GitHub status: private repository `rockpunkgod/credit-trade` and remote `main` are verified. No tag or GitHub Release has been created.
- Legal/operational status: no market has supplied the evidence required for real-money operation.
- Live-transaction status: no real-money transaction is authorized or has been attempted.

The product is an authorized API inference-service marketplace. It is not a marketplace for consumer subscriptions or transferable API credits, and it will not implement a freely transferable stored-value wallet.

## Product flow change — 2026-08-30

The product flow now begins with a supplier-provided API endpoint. The production design requires the platform to classify the endpoint protocol, operator, upstream vendor and canonical model, verify account control and written authorization, bind an approved versioned supplier price, and only then publish a buyer-facing inference-service offer. The current sandbox only recognizes two mock endpoints and pins synthetic prices; it does not verify account control or written authorization.

Technical identification does not establish authorization or price authority. Unknown vendors and endpoints stay open for registration, draft pricing and sandbox work as `PENDING_REVIEW`; they are not presumed prohibited. Conflicting identities remain registered but non-routable, while syntactically unsafe endpoint URLs are rejected. The explicit `PROHIBITED` evidence lifecycle is not implemented yet. None can generate a production route or real payment before approval.

## Phase progress

| Phase | Status | Evidence / exit condition |
|---|---|---|
| 0 — Baseline | Complete locally | `docs/phase-0-baseline.md`; local Git repository and SHA-256 evidence manifest |
| 1 — Admission research | Not started | Official-source vendor/account/resale/region evidence matrices reviewed and hashed |
| 2 — Requirements and architecture freeze | Draft updated; not frozen | Supplier endpoint registry, identification/evidence separation and pricing flow drafted; Phase 1 evidence, PRD, API, ledger and threat-model review pending |
| 3 — Sandbox vertical slice | Initial slice complete | Mock supplier/buyer creation, endpoint registration, vendor identification, version-linked price, buyer quote, versioned metering/rating, authenticated identity/catalog-to-settlement linkage, whole-ledger checkpoint, hold, inference, settlement and release executed; payout/refund/chargeback remain pending |
| 4 — Shared core | Partial | In-memory sealed platform fee/quote-lifetime policy, supplier/buyer identity, endpoint/price catalog with price-stream heads, buyer API-key-hash attribution, quote, exact metering/rating and Map coverage, balance-replayed ledger checkpoints, HMAC keyring/request authentication, canonical record coverage and settlement-chain core implemented; authorized configuration management, durable persistence/key custody, RBAC/MFA, streaming and full controls pending |
| 5 — Payment and settlement adapters | Not started | No PSP sandbox, webhook or production payment adapter is implemented |
| 6 — Market packages | Not started | Independently built market artifacts |
| 7 — Test program | Initial suite passing | 64 Node tests pass, including integrity framing, domain/scope separation, key rotation, opaque request authentication, platform fee/quote-lifetime edits, supplier/buyer/endpoint/price edits, API-key-hash and Map-key attribution, sparse/decorated arrays, digest recomputation, seal transplantation, price-stream-head tail deletion, full-ledger checkpoints/balance replay, preflight circuit breaking, canonical replay, quote/record coverage, chain deletion/reordering and rollback cases; complete Phase 7 matrix and dedicated scanners remain pending |
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

- Standard test command: 64 passed, 0 failed.
- Authenticated-integrity verification: platform fee/quote-lifetime policy, synthetic supplier/KYB fixture, buyer/API-key-hash attribution, provider endpoint, versioned supply-price chains/heads, quote policy, usage, rating, full ordered inference batch, locale-independently ordered currency-ledger checkpoints with replayed balances, idempotency request code and exact Map key, canonical inference/record coverage and settlement chain passed; test-only configuration/record tampering, sparse/decorated arrays, transplant, tail/middle deletion, reordering, unknown-key and commit/checkpoint-signing failure cases were rejected.
- End-to-end HTTP demo: passed.
- Detected mock vendor: `ACME_AI`.
- Unknown-vendor policy: `PENDING_REVIEW`.
- Real provider used: no.
- Production payment available: no.
- Ledger result: balanced, four journals in the demo flow.
- Independent static TypeScript typecheck: not run because `tsc` is not installed; Node 24 syntax checks pass for all source entry points.

## Phase 0 assumptions

1. The current directory is the authorized working directory.
2. The repository is greenfield. Stable TypeScript in a single repository is the provisional implementation stack.
3. The shared core will have separate control-plane and inference data-plane services, PostgreSQL, Redis, OpenTelemetry, and Docker Compose unless measurements in Phase 2 justify a change.
4. Initial integrations will use simulated supplier endpoints and sandbox/example identification adapters. No detected vendor or endpoint becomes a production route without corroborated control, written permission and market admission.
5. All five requested markets remain fail-closed for real payments. Missing evidence is treated as `PENDING_REVIEW`.
6. `main` is the verified GitHub default branch for the private repository.
7. Platform fees, funding/payout thresholds, settlement cycle, refund/chargeback/reserve rules, and performance targets remain configurable placeholders until supplied.
8. The current GitHub repository must remain private. The user authorized private-repository creation and pushes to `main` on 2026-08-30; this does not authorize tagging, Release creation, container publication, paid resources, real payments, or production deployment.

## Immediate next work

The code-first next slice is persistence and transactional recovery for identity/catalog/usage/rating/ledger/checkpoint/chain records, production-grade KMS/HSM key custody and durable historical verification, external supplier/endpoint inventory plus price/settlement-head and ledger-checkpoint anchoring, append-only/WORM retention, provider-authoritative usage finalization and variance handling, automatic eligible-offer routing, streaming/cancellation and the remaining simulated settlement/refund paths. Official-source review remains deferred per current priority; until it is performed, unknown vendors remain registered as `PENDING_REVIEW` and all production paths stay unavailable.

## Recovery point

The immutable Phase 0 recovery point is local commit `2f509eb23ef14dbd43f77172fd6947a78f573b71`. Its files are listed in `docs/phase-0-baseline.md` and hashed by `docs/evidence/phase-0.sha256`. The first independently verified remote recovery point is commit `a4ef4925cad1f49319a1c9f7900572836ab6fa0c` on `origin/main`; later verified pushes may advance that branch without changing the Phase 0 evidence.
