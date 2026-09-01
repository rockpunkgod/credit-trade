# ADR 0004: Authenticated metering integrity in the sandbox

- Status: Accepted for the in-memory sandbox; not approved as a production trust or key-management design
- Date: 2026-09-01

## Context

ADR 0003 introduced deterministic SHA-256 digests for the quote price policy, usage and rating records. Those digests identify exact content and detect an edit only when the stored digest is not also replaced. They are unkeyed: a party able to rewrite both a record and its digest could create a new internally consistent value.

The current HTTP API does not let a buyer submit billable quantities, and all state remains in one loopback-only process. Even so, the core needs a clear authenticated-integrity boundary before records are persisted or received from additional internal components. This control must not be described as encryption, a provider attestation, a public digital signature or proof that the measured quantity is factually correct.

## Decision

Add an internal `CT-HMAC-SHA256-V1` integrity module to `packages/core/src/billing`. It uses HMAC-SHA-256 over strictly validated, domain-separated, length-prefixed UTF-8 fields. The authenticated statement includes:

- purpose: synthetic supplier account, buyer account, platform fee policy, provider endpoint, supply price, quote policy, usage record, rating record, ledger checkpoint or settlement record;
- environment, market, currency, buyer, supplier, endpoint, quote and optional inference scope;
- subject identifier and the deterministic content digest;
- zero or more parent-seal digests;
- authentication timestamp; and
- an optional chain stream, sequence and previous-seal digest.

The seal adds the scheme, a non-secret key identifier and a 32-byte authentication tag encoded as unpadded base64url. Verification rejects unknown fields, malformed Unicode, unsupported schemes, unknown keys, non-canonical tags, scope substitution and any difference from the expected statement. Authentication tags are compared with a constant-time primitive after exact length validation.

The HMAC keyring requires each key to contain at least 32 bytes, retains old keys for verification, designates one active key for new seals and supports changing the active key. It can also create a smaller opaque authentication code for non-record inputs. The current idempotency code authenticates the environment, market, buyer, quote, idempotency key and prompt; the stored idempotency record contains the code rather than a plaintext request fingerprint or prompt. The default marketplace creates one random 32-byte key and random key identifier at process startup. Tests inject explicit test-only keys to make rotation and adversarial behavior reproducible. Key material is never part of an integrity statement, domain snapshot, buyer response or OpenAPI schema.

## Authenticated relationship

The sandbox authenticates these relationships:

1. A synthetic supplier-account seal covers the supplier ID, name, fixed `SANDBOX_FIXTURE` KYB status and creation time. This authenticates an internal fixture record; it is not real KYB evidence or approval.
2. A buyer-account seal covers the buyer ID, name, currency, stored API-key hash and creation time. Verification requires the buyer Map key and the bidirectional API-key-hash index to agree exactly. This authenticates internal attribution of a hash; it does not prove possession of the raw key or a real identity.
3. A platform-fee-policy seal covers the `sandbox-cost-plus-v1` billing-policy identifier, configured platform-fee basis points and quote lifetime. Full verification compares the live in-process values with this startup seal before quote creation, so an ordinary state edit cannot be washed into a newly sealed quote without failing verification. This is an internal consistency control, not evidence that a production configuration was approved.
4. A provider-endpoint seal covers the supplier, normalized URL, claimed and detected vendor, detection/evidence states, sandbox-routing state and creation time.
5. A supply-price seal covers supplier, endpoint, model, currency, exact input/output price, version and effective time. Later price versions name the preceding price seal in the same supplier/endpoint/model/currency stream. A separately stored process-local price-stream head records the final version and seal digest, so deleting the newest price is detected while that head remains intact.
6. The quote-policy seal covers the buyer/supplier/endpoint/model terms, limits, selected price and fee values, expiry and complete rating-policy binding. It names the selected supply-price seal as its parent. Catalog verification separately requires the referenced endpoint and all price versions to retain valid seals and exact ownership/version relationships.
7. The usage seal covers the usage digest and scope, and names the quote-policy seal as its parent.
8. The rating seal covers the rating digest and scope, and names the usage seal as its parent. The rating digest already binds usage, price, line items, rounding and charged amounts.
9. An inference ledger digest covers the complete ordered journal batch linked to that inference: journal identifiers, event types, currencies, business keys, timestamps and every ordered posting account, direction and amount. The empty inference batch also has an explicit digest.
10. Every committed journal batch creates one ledger checkpoint for each affected currency. Its digest covers the complete journal prefix for that currency plus materialized balances ordered with a locale-independent ordinal comparison; verification reconstructs those balances from the journal prefix. Checkpoints form their own HMAC chain, while full verification also derives and checks the journal business-key index.
11. The settlement seal covers the rating, usage/rating seal digests, HMAC idempotency request code, exact idempotency scope, delivered-output digest, currency, supplier cost, platform fee, buyer charge, maximum hold, inference ledger digest, ordered journal identifiers and settlement time. It names the rating seal as its parent.
12. Settlement seals advance a second in-memory sequence chain scoped to the sandbox environment, market and currency. Each seal authenticates the previous settlement-seal digest, and a separately stored in-memory head records the expected sequence and digest.

This structure prevents a valid seal from being transplanted to another buyer, supplier, endpoint, quote, inference, currency or purpose. With the policy seal, price/settlement heads and checkpoint history left intact, complete verification detects tested platform-fee or quote-lifetime state edits, supplier/buyer/catalog edits, API-key-hash attribution changes, record edits, funding or inference-journal forgery, balanced ledger rewrites, materialized-balance changes, missing or duplicated linked journals, price-tail deletion, settlement/checkpoint-chain deletion and reordering.

Canonical coverage is also exact rather than advisory. Data objects with accessors, unexpected fields or changed derived fields are rejected. Arrays must be ordinary dense arrays with exactly the expected numeric indexes and `length`; sparse arrays and arrays carrying additional or symbolic properties are rejected. Supplier, buyer and quote Map keys must equal their record IDs; the buyer/API-key-hash index must be exact in both directions; and the idempotency Map key must equal the idempotency scope stored in both its record and settlement-bound billing record. Each billing record must have exactly one matching inference and idempotency record; each inference must be covered by billing; each consumed quote must be covered exactly once; and quote `USED` state must agree with that coverage. The canonical inference is reconstructed from its sealed quote, usage, rating, output digest, journal links and settlement time before it can be trusted.

## Verification and failure behavior

- Platform fee/quote-lifetime policy, supplier, buyer, API-key-hash index, provider endpoint, supply-price predecessor chain and price-stream-head integrity is checked before a quote can use configuration, identity or catalog data; the quote seal is also tied to the selected price seal.
- Endpoint registration, price publication, buyer creation/funding, quote creation and inference run full catalog, ledger and billing verification before proceeding. Detected historical tampering therefore acts as a fail-closed integrity circuit breaker for new billing mutations.
- Quote-policy integrity is checked before inference can use the frozen rating policy.
- Newly created usage and rating seals are checked before the inference transaction is accepted.
- Settlement sealing and verification occur inside the rollback-protected in-memory commit; a failure restores journals, balances, quote state, records, idempotency state and chain head.
- Each affected currency checkpoint is sealed within the journal batch; commit rollback also restores the checkpoint collection. Buyer creation does not publish the buyer or API-key-hash index until initial-funding checkpoint creation succeeds, so the tested checkpoint-signer failure leaves no buyer, hash-index, journal or checkpoint residue.
- Idempotent inference replay first verifies the entire integrity state and the opaque request authentication code, then returns only the canonical inference already proven to match its billing record.
- State, billing and ledger reads revalidate endpoint/price catalog, all journal checkpoints and replayed balances, quote/usage/rating/settlement relationships, canonical inference/idempotency coverage and settlement heads before returning data.
- An integrity failure uses a single `INTEGRITY_PROOF_INVALID` domain error without exposing which field, key or tag differed. It is not classified as a buyer error, so the HTTP boundary returns a generic redacted server failure.

No buyer-callable signing, verification or billable-usage ingestion endpoint is added. The existing endpoint, price, quote, inference, state and ledger response schemas remain unchanged. HMAC seals, request authentication codes, ledger checkpoints, authentication tags and key identifiers remain internal and are removed from redacted HTTP-visible state.

## Security boundary and production gaps

HMAC authenticates content within a shared-secret trust boundary; it does not encrypt the quantities, amounts or records and is not a digital signature. It does not establish non-repudiation or allow a buyer, supplier, regulator or auditor without the secret key to verify a record independently. It also does not prove that `SANDBOX_ESTIMATE` usage matches a provider tokenizer, provider invoice or real service execution.

The control cannot prevent a party that controls the process or obtains an accepted HMAC key from creating new valid seals, including a newly sealed platform policy; policy sealing therefore does not replace authorized configuration management or dual approval. Provider-endpoint records are sealed against editing, but there is no independent endpoint-collection head or external catalog inventory: deletion of an otherwise unreferenced endpoint is not generally detectable from local state alone. The price-stream heads detect local newest-version deletion only while those heads remain intact. The policy seal, supplier/buyer records, indexes, catalog records, price/settlement heads and checkpoint histories are neither append-only nor externally anchored; an attacker that can coordinate rollback of all relevant local integrity state can roll the sandbox back consistently. The default key and every record are process-local and disappear on restart, so the sandbox provides no durable or cross-restart verification. In-memory key zeroing is best-effort and is not hardware-backed key custody.

Before production, the design requires at least:

- KMS/HSM-backed key generation, custody, access policy, separation of duties and audited signing operations;
- durable key identifiers, rotation, revocation and historical verification without deleting required old keys;
- database transactions and immutable persistence for records, journals and chain state;
- independently controlled external supplier/endpoint inventory and price/settlement-head and ledger-checkpoint anchors plus append-only or WORM retention;
- integrity-failure alerting, incident response, backup/restore and reconciliation exercises;
- provider-authenticated usage evidence and variance handling; and
- a separately reviewed asymmetric signature and public verification contract if third-party-verifiable receipts are required.

## Consequences

- Recomputing a public SHA-256 content digest is no longer enough to make a changed internal billing record pass verification.
- Synthetic supplier/KYB-fixture fields, buyer metadata/API-key-hash attribution, provider endpoints and versioned supply prices cannot be edited into a new accepted quote without their internal seals and exact indexes also verifying.
- Unsealed mutation of the in-process platform fee or quote lifetime is rejected before the service can issue a newly sealed quote; production configuration approval remains out of scope.
- Price-stream heads detect deletion of the newest price version while the separate head remains intact; endpoint inventory still requires an external anchor.
- Currency-level checkpoints cover funding and other journals that are outside an individual inference settlement, and replayed balances must equal the materialized account map.
- Idempotency replay is authenticated against the exact request and canonical settled record rather than trusting a mutable cached response.
- All authenticated fields have explicit domain, scope and parent relationships rather than relying on generic object serialization; exact record validation also rejects accessors, unexpected fields and sparse or decorated arrays.
- Existing HTTP clients see no field-shape change.
- Key rotation can be tested in memory while production key custody remains explicitly unresolved.
- The control raises the cost of unauthorized record changes but does not justify a claim that records are absolutely immutable or that metering is authoritative.

## Rejected alternatives

- Describe `Object.freeze` or an unkeyed SHA-256 digest as cryptographic authenticity.
- Encrypt metering records with a reversible cipher when the requirement is integrity rather than confidentiality.
- Expose an HMAC tag as a publicly verifiable buyer receipt.
- Protect only inference-linked journals while leaving funding journals and materialized balances outside the authenticated checkpoint history.
- Trust an idempotency cache or mutable quote status without exact canonical record coverage.
- Treat Map placement, API-key-hash indexes, sparse arrays or attached properties as unauthenticated implementation details.
- Let ordinary mutable configuration values silently redefine the fee or quote lifetime used by new authenticated quotes.
- Use one unscoped MAC over ad hoc JSON serialization.
- Claim the in-memory head prevents rollback without an external anchor.
- Treat a platform-generated HMAC as provider-signed usage evidence.
