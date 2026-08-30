# ADR 0002: Supplier endpoint identification and price binding

- Status: Proposed for Phase 2 review
- Date: 2026-08-30

## Context

The supplier-side product flow now begins with a seller-provided API endpoint. The platform must identify what service the endpoint represents and sell it at the corresponding price without trusting seller labels, confusing a compatible protocol with a vendor identity, or reselling personal/account credits.

## Proposed decision

Create a supplier-endpoint registry in the control plane and a market-scoped endpoint connector in the data plane.

The registry separates endpoint operator, endpoint class, protocol family, claimed upstream vendor, verified upstream vendor, canonical model, evidence state, market admission and price schedule. Identification creates a candidate classification. Production eligibility requires corroborating account-control and authorization evidence plus market approval.

Endpoint probes run from isolated market egress with synthetic content. The control plane never connects directly to arbitrary supplier URLs, and buyer requests can never override a registered destination.

Pricing is bound through an immutable versioned schedule keyed to the admitted market/supplier/endpoint/vendor/model/region/meter/currency tuple. A buyer quote snapshots supplier cost, platform fee, tax, expiry and maximum hold. Public list pricing is a reference only unless an approved contract explicitly makes it authoritative.

## Why

- Compatible APIs can impersonate vendor response shapes and model names.
- A working key or endpoint does not prove legal resale rights or legitimate credit origin.
- A vendor/model identity does not determine a supplier's negotiated cost or the platform's final taxable price.
- Versioned identity and pricing are necessary to explain every route and ledger entry after endpoints or prices change.

## Rejected alternatives

- Trust the supplier's vendor/model declaration.
- Infer a production vendor solely from protocol fingerprints or response metadata.
- Apply a vendor public list price automatically.
- Permit arbitrary endpoint URLs in the production data plane.
- Route to the lowest claimed price before eligibility checks.

## Consequences

- Endpoint and evidence drift can remove capacity immediately; routing must tolerate fail-closed supplier loss.
- Each market needs an independent domain/egress allowlist and endpoint-admission record.
- The platform needs explicit re-verification, price-effective-time and quote-snapshot logic.
- Supplier gateways require stronger identity, data-processing and upstream-provenance review than direct official endpoints.
- Phase 2 must freeze detection adapter contracts, acceptable corroboration methods, price-source policy and drift thresholds before implementation.

## Detailed specification

See `docs/product/supplier-api-market-flow.md`.
