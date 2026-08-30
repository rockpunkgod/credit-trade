# Initial security and privacy risk register

Last updated: 2026-08-30 (Asia/Shanghai)

This is a design-stage register. “Required control” does not mean the control has been implemented or tested.

| ID | Risk | Required control / test | Current status |
|---|---|---|---|
| SEC-01 | Cross-tenant access or object-ID confusion | Tenant-bound authorization at query and service boundaries; negative integration tests | OPEN |
| SEC-02 | Cross-market data, traffic, ledger or payment mixing | Market-scoped keys/accounts/deployments; deny cross-region fallback; isolation tests | OPEN |
| SEC-03 | SSRF through provider URLs, tools or callbacks | Registry allowlist, egress policy, DNS/IP validation, redirect limits, private-range denial | OPEN |
| SEC-04 | Malicious supplier response or key exfiltration | Supplier boundary, schema/size validation, secrets isolated from buyer/logs, adversarial tests | OPEN |
| SEC-05 | Forged or discrepant usage inflates cost | Signed/linked metering evidence, independent bounds, variance workflow and reconciliation | OPEN |
| SEC-06 | Duplicate, replayed or out-of-order webhook | Signature and timestamp validation, replay window, inbox uniqueness and state machine tests | OPEN |
| SEC-07 | Concurrent charge/refund/payout creates double financial effect | Serializable transaction design, idempotency, immutable entries and race/property tests | OPEN |
| SEC-08 | Account takeover or MFA bypass | Phishing-resistant MFA for privileged roles, session hardening and recovery controls | OPEN |
| SEC-09 | Payout-account rebinding theft | Re-verification, cooling period, enhanced review and dual approval | OPEN |
| SEC-10 | Administrator abuse or unaudited balance change | Least privilege, two-person approval, append-only audit and no direct balance mutation | OPEN |
| SEC-11 | Prompt/output, identity, payment or key data leaks through observability | Data minimization, structured redaction, retention rules and log/snapshot/CI scans | OPEN |
| SEC-12 | Dependency, build or CI supply-chain compromise | Lockfile, provenance, SBOM, signature/checksum and dependency/container/IaC scans | OPEN |
| SEC-13 | Cost amplification and denial of wallet/service | Input/concurrency/rate/budget/price bounds, circuit breakers and anomaly alerts | OPEN |
| SEC-14 | Unsupported production payment is unlocked by configuration | Server evidence gate, separation of duties, two-person approval, audit and bypass tests | OPEN |
| SEC-15 | Sanctions/KYC service outage admits risky activity | Fail-closed onboarding/top-up/payout controls and explicit degraded-mode runbook | OPEN |
| SEC-16 | Backup exposes data or cannot restore consistent ledger | Regional encrypted backups, access separation, point-in-time recovery and restore drills | OPEN |

No Critical/High finding can be declared resolved until its control is implemented and the named evidence is executed.
