# Requirements traceability

Last updated: 2026-08-30 (Asia/Shanghai)

Status vocabulary: `NOT_STARTED`, `DESIGNED`, `IMPLEMENTED`, `TESTED`, `BLOCKED_EXTERNAL`.

No implementation or test status is claimed in this Phase 0 baseline.

| ID | Requirement | Planned phase(s) | Status | Evidence |
|---|---|---|---|---|
| P-01 | Organizations, identities, RBAC, and MFA for buyer, supplier, operator, auditor | 2, 4, 7 | NOT_STARTED | Pending |
| P-02 | Buyer API keys: creation, hashed storage, rotation, revocation, rate and budget limits | 2, 4, 7 | NOT_STARTED | Pending |
| P-03 | Supplier KYB, authorization evidence, model/region/capacity/price/SLA lifecycle | 2, 4, 7 | NOT_STARTED | Pending |
| P-04 | Supplier control node or compliant secret store with non-disclosure guarantees | 2, 4, 7 | NOT_STARTED | Pending |
| P-05 | Unified streaming gateway with cancellation, timeout, circuit breaking, retry, health and failover | 2, 3, 4, 7 | NOT_STARTED | Pending |
| P-06 | Eligibility-first routing across authorization, region, residency, AUP, capacity and budget; then price/health/SLA | 2, 3, 4, 7 | NOT_STARTED | Pending |
| P-07 | Versioned quotes with currency, tax, fee, supplier cost, expiry, snapshot and max hold | 2, 3, 4, 7 | NOT_STARTED | Pending |
| P-08 | Authoritative usage including cache/tool/interrupt/failure/vendor variance | 2, 3, 4, 7 | NOT_STARTED | Pending |
| P-09 | Immutable double-entry ledger for holds through reversals and payouts | 2, 3, 4, 7 | NOT_STARTED | Pending |
| P-10 | Funding, marketplace split, payout, refund, chargeback, webhook replay defense and reconciliation adapters | 2, 3, 5, 7 | NOT_STARTED | Pending |
| P-11 | KYC/KYB, sanctions, anomaly, freeze, review, appeal and dual approval interfaces | 2, 4, 5, 7 | NOT_STARTED | Pending |
| P-12 | Buyer, supplier, operator and auditor user interfaces | 2, 3, 4, 7 | NOT_STARTED | Pending |
| P-13 | Redacted observability, anomaly alerts, audit, backup/recovery and incident response | 2, 4, 7, 8 | NOT_STARTED | Pending |
| P-14 | One-command local demo, fixtures, OpenAPI, deployment and rollback docs | 3, 7, 8 | NOT_STARTED | Pending |
| A-01 | Shared core plus versioned, independently built market packages | 2, 6, 7 | NOT_STARTED | `docs/adr/0001-platform-shape.md` is only a proposal |
| A-02 | Control/data plane separation and tested regional isolation | 2, 4, 6, 7 | NOT_STARTED | Pending |
| F-01 | Integer-minor-unit or exact decimal accounting; no floating-point money | 2, 3, 7 | NOT_STARTED | Pending |
| F-02 | Balanced immutable ledger with idempotency, outbox/inbox and compensation | 2, 3, 7 | NOT_STARTED | Pending |
| F-03 | Four-way daily reconciliation and automatic top-up/payout suspension on unexplained variance | 2, 3, 5, 7 | NOT_STARTED | Pending |
| G-01 | Server-verified, dual-approved, audited, fail-closed production-payment admission | 2, 5, 6, 7 | NOT_STARTED | Pending |
| G-02 | Independent `disable_topups`, `disable_charges`, `disable_payouts`, market and vendor circuit breakers | 2, 4, 5, 7 | NOT_STARTED | Pending |
| S-01 | Threat model and tests covering tenancy, SSRF, malicious supplier, forged usage, replay, ATO, payout changes, admin abuse, supply chain and secret leakage | 2, 7, 8 | NOT_STARTED | `docs/security/risk-register.md` records initial risks only |
| R-01 | Reproducible market builds, SBOM, provenance, checksums, scans and release evidence | 6, 7, 8, 9 | NOT_STARTED | Pending |

