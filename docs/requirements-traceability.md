# Requirements traceability

Last updated: 2026-08-31 (Asia/Shanghai)

Status vocabulary: `NOT_STARTED`, `DRAFTED`, `PARTIAL`, `DESIGNED`, `IMPLEMENTED`, `TESTED`, `BLOCKED_EXTERNAL`.

Design drafts added after Phase 0 are not frozen architecture, implementation or executed tests.

| ID | Requirement | Planned phase(s) | Status | Evidence |
|---|---|---|---|---|
| P-01 | Organizations, identities, RBAC, and MFA for buyer, supplier, operator, auditor | 2, 4, 7 | NOT_STARTED | Pending |
| P-02 | Buyer API keys: creation, hashed storage, rotation, revocation, rate and budget limits | 2, 4, 7 | PARTIAL | Creation, one-time return and hash-only lookup tested; rotation/revocation/rate/budget pending |
| P-03 | Supplier KYB, endpoint, authorization evidence, model/region/capacity/price/SLA lifecycle | 2, 4, 7 | PARTIAL | Sandbox fixture, endpoint detection and price lifecycle implemented; real KYB/evidence/capacity/SLA pending |
| P-03.1 | Register immutable supplier endpoint versions with control proof, approved egress and secret references only | 2, 3, 4, 7 | PARTIAL | In-memory immutable endpoint registration tested; real control proof/egress/secrets pending |
| P-03.2 | Keep endpoint operator, protocol, claimed vendor, verified vendor, model rights/mapping and authorization as separate identities | 2, 3, 4, 7 | PARTIAL | Declared/detected vendor and evidence status separated in sandbox; complete identity model pending |
| P-03.3 | Keep unknown vendors/endpoints registered as `PENDING_REVIEW`; quarantine conflicts/unsafe endpoints and reject production only on explicit `PROHIBITED` evidence | 2, 3, 4, 7 | PARTIAL | Unknown and conflicting endpoints are tested as non-routable in the sandbox; the explicit `PROHIBITED` evidence lifecycle and production rejection rule are not implemented |
| P-03.4 | Re-verify and suspend on endpoint, DNS, TLS, account, credential, vendor, model, region, metering or price drift | 2, 4, 7 | DRAFTED | `docs/product/supplier-api-market-flow.md` |
| P-03.5 | Bind each offer to an immutable supplier price book and exact canonical meter schema | 2, 3, 4, 7 | PARTIAL | In-memory quotes pin price/policy and `sandbox-token-meter` v1; `docs/adr/0003-sandbox-billing-metering-boundary.md`; persistence and production approval remain pending |
| P-04 | Supplier control node or compliant secret store; credentials never enter buyer responses, logs or Git | 2, 4, 7 | DRAFTED | `docs/product/supplier-api-market-flow.md` |
| P-05 | Unified streaming gateway calling only registered endpoints, with cancellation, timeout, circuit breaking, bounded retry, health and controlled failover | 2, 3, 4, 7 | PARTIAL | Quote-bound mock inference implemented; streaming/cancellation/circuit breaking/failover pending |
| P-06 | Eligibility-first routing across endpoint admission, authorization, region, residency, AUP, capacity and budget; then price/health/SLA | 2, 3, 4, 7 | PARTIAL | Non-routable endpoints fail closed; automatic multi-offer ranking and full policy checks pending |
| P-06.1 | Persist route policy and candidate exclusion reasons plus endpoint/evidence/model/price/health/capacity/SLA snapshots | 2, 3, 4, 7 | DRAFTED | `docs/architecture/supplier-routing-state-machines.md` |
| P-06.2 | After first streamed byte, forbid automatic cross-endpoint failover; ambiguous outcomes require explicit finalization/review | 2, 3, 4, 7 | DRAFTED | `docs/architecture/supplier-routing-state-machines.md` |
| P-07 | Immutable supplier offer, price-policy, commission/tax and buyer-quote versions with currency, components, expiry and max hold | 2, 3, 4, 7 | PARTIAL | Exact rational rate/rounding policy, supplier price/fee/quote/expiry/max hold tested; tax and broader market policies pending |
| P-08 | Authoritative usage including cache/tool/interrupt/failure/vendor variance | 2, 3, 4, 7 | PARTIAL | Versioned internal records and module tests cover input/output/cache/tool/request dimensions, source/finality/outcome and digests; current values are sandbox estimates, with provider finalization/variance/stream interruption pending |
| P-09 | Immutable double-entry ledger for holds through reversals and payouts | 2, 3, 4, 7 | PARTIAL | Funding plus atomic rollback-protected hold/settlement/release journal batches, balance and fault-retry behavior tested; durable transactions, reversals and payouts pending |
| P-10 | Funding, marketplace split, payout, refund, chargeback, webhook replay defense and reconciliation adapters | 2, 3, 5, 7 | NOT_STARTED | Pending |
| P-11 | KYC/KYB, sanctions, anomaly, freeze, review, appeal and dual approval interfaces | 2, 4, 5, 7 | NOT_STARTED | Pending |
| P-12 | Buyer, supplier, operator and auditor interfaces including endpoint registration, detection conflict, evidence, price and suspension workflows | 2, 3, 4, 7 | DRAFTED | `docs/product/supplier-api-market-flow.md` |
| P-13 | Redacted observability, anomaly alerts, audit, backup/recovery and incident response | 2, 4, 7, 8 | NOT_STARTED | Pending |
| P-14 | One-command local demo, fixtures, OpenAPI, deployment and rollback docs | 3, 7, 8 | PARTIAL | `pnpm demo` and OpenAPI implemented; deployment/rollback pending |
| A-01 | Shared core plus versioned, independently built market packages | 2, 6, 7 | NOT_STARTED | `docs/adr/0001-platform-shape.md` is only a proposal |
| A-02 | Control/data plane separation and tested regional isolation | 2, 4, 6, 7 | NOT_STARTED | Pending |
| A-03 | Endpoint registry in the control plane; endpoint access only through market-scoped data-plane egress connectors | 2, 4, 6, 7 | DRAFTED | `docs/adr/0002-supplier-endpoint-identification-and-pricing.md` |
| F-01 | Integer-minor-unit or exact decimal accounting; no floating-point money | 2, 3, 7 | TESTED | Money paths use decimal strings and `bigint`; rational numerator/denominator rates and rounding boundaries are tested |
| F-02 | Balanced immutable ledger with idempotency, outbox/inbox and compensation | 2, 3, 7 | PARTIAL | Balanced append-only in-memory journals and inference idempotency tested; persistence/outbox/inbox/compensation pending |
| F-03 | Four-way daily reconciliation and automatic top-up/payout suspension on unexplained variance | 2, 3, 5, 7 | NOT_STARTED | Pending |
| G-01 | Server-verified, dual-approved, audited, fail-closed production-payment admission | 2, 5, 6, 7 | NOT_STARTED | Pending |
| G-02 | Independent `disable_topups`, `disable_charges`, `disable_payouts`, market and vendor circuit breakers | 2, 4, 5, 7 | NOT_STARTED | Pending |
| S-01 | Threat model and tests covering tenancy, endpoint SSRF/rebinding, vendor/model impersonation, malicious supplier, forged usage, price drift, replay, ATO, payout changes, admin abuse, supply chain and secret leakage | 2, 7, 8 | DRAFTED | `docs/security/risk-register.md` records design-stage risks only |
| R-01 | Reproducible market builds, SBOM, provenance, checksums, scans and release evidence | 6, 7, 8, 9 | NOT_STARTED | Pending |
