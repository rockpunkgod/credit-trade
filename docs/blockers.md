# Blockers and required external inputs

Last updated: 2026-08-30 (Asia/Shanghai)

These blockers do not prevent safe local design, sandbox implementation, or testing unless stated otherwise. They do prevent the named operation.

| ID | Type | Blocks | Missing input or evidence | Owner / provider | Recovery condition |
|---|---|---|---|---|---|
| B-001 | Publication authority | Tags, GitHub Releases, container publication, and production deployment | Private repository creation and `main` pushes are resolved. Still missing: license, release version, and explicit tag/Release, image-publication, and production-deployment permissions | User / repository owner | Each remaining private publication input and permission is supplied before its corresponding action |
| B-002 | GitHub tooling | GitHub Release creation and API-level Release verification from this host | Git push and remote-reference verification work through the existing approved credential path without exposing credentials, but `gh` is not available in PATH | DevOps / user | An approved Release-capable GitHub tool or API path is configured and verified without exposing tokens |
| B-003 | Container tooling | Docker Compose demo, image build/scan, and image provenance | Docker CLI/engine is not available in PATH | DevOps / user | Approved container runtime is installed or an equivalent CI builder is provided |
| B-004 | Market scope | US/EU market-specific legal analysis and any live admission | US state list and EU member-state list | Product/legal owner | Exact service jurisdictions are supplied |
| B-005 | Operating eligibility | `LIVE_PILOT` and `LIVE` in every market | Operating entity, registration, bank account, accountable officers, legal/tax/security sign-off | Market operator | Private evidence is approved; public matrix stores only hashes/references |
| B-006 | Payment eligibility | Production top-ups, charges, split settlement, refunds, chargebacks, and payouts | Marketplace/split/payout production approval, currencies, cross-border path, production account capability | Payment provider / finance owner | Written approval and production capability tests pass |
| B-007 | Vendor eligibility | Any production inference vendor route | Vendor candidate list and written permission covering suppliers, downstream users, geography, AUP, resale/agency model, and data processing | Vendor / supplier owner | Current evidence is reviewed and marked `ALLOWED_WITH_EVIDENCE` |
| B-008 | Compliance operations | Onboarding, funding, and payout in production | KYC/KYB, AML, sanctions, tax, privacy, DPA, subprocessor, residency and transfer arrangements | Compliance owner | All required services and procedures pass the market admission checklist |
| B-009 | Live transaction authority | Any real-money test | Exact market/account, `真实小额验证上限`, amount, currency, and count authorization | User / finance owner | Explicit bounded authorization is provided after all other admission gates pass |
| B-010 | Commercial policy | Final pricing, limits, payout and reserve behavior, and performance acceptance | Platform fee, minimum funding/payout, settlement period, refund/chargeback/reserve rules, target concurrency/SLO | Product/finance owner | Values and approval owners are supplied and versioned |
| B-011 | Secret references | Any production integration | Secret-manager references or approved environment-variable names; no secret values | Security/DevOps owner | References exist and secret-handling tests pass |

## Non-blocking environment note

`node` is not on the normal PATH, but the Codex workspace runtime provides Node.js `v24.19.0` and Python `3.12.13`; pnpm `11.19.0` is callable. This supports local development after scripts explicitly select the bundled runtime. It does not resolve Docker or GitHub Release-management blockers.
