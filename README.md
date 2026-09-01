# Credit Trade

[简体中文](README.zh-CN.md)

Credit Trade is a local sandbox for a vendor-neutral marketplace of authorized API inference services. A supplier registers an endpoint it claims to control, the platform classifies the mock service, a buyer receives a versioned quote, and a synthetic inference call is metered and posted to a balanced double-entry ledger. The current sandbox does not verify endpoint control or service authorization.

This repository does **not** trade API credits, consumer subscriptions, promotional balances, or transferable stored value.

## Current safety state

| Capability | Current state |
|---|---|
| Supplier and buyer workflow | Local synthetic sandbox only |
| Inference provider | Mock endpoint only; no real provider is enabled |
| Buyer funding and supplier earnings | Simulated ledger entries only; payout is not implemented and no money moves |
| Production payments | Unavailable and fail-closed |
| Market admission | `PENDING_REVIEW` for every unknown or unreviewed combination |
| GitHub release | Not published |

An unknown provider, payment channel, supplier type, market, or evidence gap remains `PENDING_REVIEW`. `PROHIBITED` is reserved for a scope whose prohibition is explicit in a current official source; the sandbox does not infer prohibition from missing information. Neither state can unlock production payments.

The mock workflow is technical test evidence only. It is not payment-provider sandbox verification, vendor authorization, legal approval, market eligibility, or a real-money transaction.

## Requirements

- Node.js 24 or newer
- pnpm 11 or newer

Docker, PostgreSQL, Redis, production credentials, and third-party accounts are not required for this initial in-memory demo.

Never put API keys, payment credentials, integrity/HMAC key material, identity documents, contracts, or legal opinions in this repository. Future integrations must accept only approved secret-manager references or environment-variable names, never secret values in source or documentation.

Confirm that both commands are available in the current terminal:

```powershell
node --version
pnpm --version
```

In Codex Desktop, the bundled Node runtime may not initially be on the terminal `PATH`. Add it for the current PowerShell session if `node --version` is not recognized:

```powershell
$creditTradeNodeBin = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$env:Path = "$creditTradeNodeBin;$env:Path"
```

## Run locally

The current sandbox has no third-party runtime dependencies. Start the API:

```powershell
pnpm start
```

In a second terminal, run the complete synthetic workflow:

```powershell
pnpm demo
```

The demo starts its own temporary local API process, so running `pnpm start` first is optional. It exercises the implemented HTTP routes in this order:

1. create a synthetic supplier;
2. register and identify its mock inference endpoint;
3. create a sandbox buyer and receive an API key that is disclosed only once;
4. create an immutable quote and calculate its maximum hold amount;
5. perform a synthetic inference request, place the hold, settle actual usage, and release the remainder;
6. inspect the resulting usage and balanced ledger.

No call leaves the local machine, and the demo prints neither a raw API key nor full prompt/output content.

Run the automated tests with:

```powershell
pnpm test
```

The API listens on `http://127.0.0.1:3000` by default. Its exact implemented contract is documented in [`docs/api/openapi.yaml`](docs/api/openapi.yaml).

The synthetic fixture uses a 10% platform fee and integer minor-currency-unit prices per token. These are demo values, not approved commercial terms.

## Billing and metering

The internal `packages/core/src/billing` module separates usage measurement from exact rating and ledger settlement. Its versioned meter schema defines input, output, cache-read, cache-write, tool-call and request dimensions. The current mock flow uses only estimated input/output tokens and one request; unsupported cache and tool dimensions remain explicitly zero.

Usage records contain source, finality, outcome, schema/version and content digests without storing prompts or outputs. Rating policies snapshot the price and fee versions and support exact rational rates such as a minor-unit amount per one million tokens. All quantities and amounts remain decimal strings backed by `bigint`; no floating-point money is used. Rounding is explicit and currently scoped per usage record. The plain SHA-256 content digests remain deterministic identifiers and are not, by themselves, proof of authenticity.

Each quote binds its pricing digest and meter/billing-policy versions before inference. Hold, settlement and release journals are committed as one rollback-protected in-memory batch, so an injected mid-commit failure leaves no reserved balance and the request can be retried. Durable database transactions and unique constraints are still required before production.

The core now adds domain-separated `CT-HMAC-SHA256-V1` integrity seals to internal synthetic supplier/KYB-fixture records, buyer records including the stored API-key hash, the platform fee/quote-lifetime policy, provider-endpoint records, version-linked supply prices, quote policies, usage, rating, currency-level ledger checkpoints and settlements. Supplier and buyer seals authenticate the sandbox record and its internal attribution; they do not prove real KYB, API-key possession or authorization. The platform-policy seal binds the billing-policy version, platform fee and quote lifetime so ordinary in-process mutation of those settings fails integrity verification before a new quote can be legitimately sealed; it is not production configuration approval. Scope fields bind the sandbox environment, market, currency, buyer, supplier, endpoint, quote and inference. Each supply-price stream has predecessor links and a separate local head, and the quote seal names the selected supply-price seal as its parent, followed by quote → usage → rating → settlement links. Settlement authenticates the HMAC request code, delivered-output digest, amounts and complete ordered inference-journal batch, then advances a currency-scoped in-memory settlement chain.

Every journal batch that changes a currency also creates an HMAC-authenticated checkpoint for that currency's complete journal history and current materialized balances. Verification reconstructs balances from journal postings, uses locale-independent ordering for the balance digest, checks the business-key index, validates checkpoint prefixes and rejects forged funding journals, otherwise balanced rewrites and materialized-balance edits. Exact canonical verification rejects accessors, unexpected fields, sparse arrays and arrays with attached properties. It also requires exact supplier, buyer and quote Map keys, a bidirectional buyer/API-key-hash index, an exact idempotency Map key, one matching inference, billing record and idempotency record for each consumed quote, and `USED` quote status that agrees with that record coverage.

An opaque HMAC authentication code binds the environment, market, buyer, quote, idempotency key and prompt without storing a plaintext request fingerprint or prompt in the idempotency record. A replay verifies that code and rebuilds trust from the authenticated canonical inference/billing state rather than accepting a cached result as evidence. Endpoint registration, price publication, buyer funding, quote creation and inference run a full integrity preflight, so detected historical tampering blocks new billing mutations. Buyer identity and API-key-hash index entries are published only after initial-funding journal/checkpoint creation succeeds; the tested checkpoint-signing failure leaves no buyer, hash-index, journal or checkpoint residue. State, billing and ledger reads also verify the complete catalog, ledger and billing relationships first. Integrity failures are fail-closed and are exposed over HTTP only as a redacted server error. Neither seals nor integrity key identifiers or material are added to the public HTTP response fields.

This is authenticated tamper detection, not encryption or a digital signature. It can detect modification by a party that does not possess the active HMAC key while the separate in-memory price/settlement heads and checkpoint history remain intact; the price head also detects deletion of the newest local price version while that head remains intact. Endpoint records are sealed but do not have an independently anchored endpoint-collection head, so purely local verification does not generally detect deletion of an otherwise unreferenced endpoint. The controls do not prove that estimated usage is true, prevent forgery after key or process compromise, provide third-party verification, or independently prevent a coordinated rollback of records, indexes, local heads and checkpoints. The default sandbox generates an ephemeral 32-byte key at process startup; because all state and the key are lost on restart, it provides no cross-restart verification. Production still requires separately controlled KMS/HSM-backed keys, durable rotation and historical verification, persistent transactional storage, externally anchored catalog/price/settlement heads and ledger checkpoints, append-only/WORM retention and independent audit monitoring.

The sandbox generates usage internally—buyers cannot submit billable quantities. Its UTF-8 byte estimator is deterministic technical test logic, not an authoritative vendor tokenizer or provider billing record. Delivered synthetic output is truncated before metering, so output beyond the immutable quote limit is neither returned nor charged.

The implemented meter/rating boundary is recorded in [`docs/adr/0003-sandbox-billing-metering-boundary.md`](docs/adr/0003-sandbox-billing-metering-boundary.md). The authenticated-integrity design and its limits are recorded in [`docs/adr/0004-authenticated-metering-integrity.md`](docs/adr/0004-authenticated-metering-integrity.md).

## Initial-version limits

- State is in memory and is lost when the process stops.
- The default HMAC integrity key, price/settlement heads and ledger-checkpoint histories are process-local and ephemeral; seals do not survive as independently verifiable evidence after restart, and there is no external supplier/endpoint inventory anchor.
- Only `mock://acme-ai` and `mock://contoso-ai` can execute synthetic inference.
- Usage is a local sandbox estimate, not provider-authoritative metering or invoice reconciliation.
- Other valid endpoints remain registered as `PENDING_REVIEW` and are never contacted.
- The buyer selects a supplier endpoint when requesting a quote; automatic multi-supplier routing is not implemented yet.
- Streaming, cancellation, persistence, RBAC/MFA, refunds, chargebacks, supplier payouts and payment-provider sandbox adapters are not implemented yet.

## Production lock

There is no production payment adapter or production inference adapter in this release. A frontend flag or ordinary environment variable cannot make this sandbox production-capable. Each future market requires independently reviewed operating, payment, KYC/KYB, sanctions, tax, privacy, data-residency, vendor-authorization, dual-approval, and bounded live-pilot evidence before any real-money feature can be enabled.

The intended markets—China mainland, Hong Kong, Singapore, the United States, and the European Union—remain non-live. US states and EU member states have not yet been scoped, and requests or funds must never fail over across markets.

## Repository map

- `apps/api`: local HTTP control and inference surface
- `packages/core`: in-memory sandbox domain, pricing, metering, and ledger logic
- `packages/core/src/billing`: meter-schema, usage-record, exact rating and authenticated-integrity functions
- `scripts/demo.ts`: executable end-to-end synthetic workflow
- `docs/api/openapi.yaml`: implemented HTTP contract
- `docs/compliance`: evidence metadata rules; confidential evidence remains outside Git
- `docs/security`: security assumptions and risk register
- `docs/runbooks`: operational and recovery notes

See [`docs/project-status.md`](docs/project-status.md) for the current lifecycle state and [`docs/blockers.md`](docs/blockers.md) for exact external recovery conditions.
