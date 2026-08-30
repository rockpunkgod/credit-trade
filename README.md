# Credit Trade

Credit Trade is a local sandbox for a vendor-neutral marketplace of authorized API inference services. A supplier registers an endpoint it controls, the platform classifies the mock service, a buyer receives a versioned quote, and a synthetic inference call is metered and posted to a balanced double-entry ledger.

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

Never put API keys, payment credentials, identity documents, contracts, or legal opinions in this repository. Future integrations must accept only approved secret-manager references or environment-variable names, never secret values in source or documentation.

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

## Initial-version limits

- State is in memory and is lost when the process stops.
- Only `mock://acme-ai` and `mock://contoso-ai` can execute synthetic inference.
- Other valid endpoints remain registered as `PENDING_REVIEW` and are never contacted.
- The buyer selects a supplier endpoint when requesting a quote; automatic multi-supplier routing is not implemented yet.
- Streaming, cancellation, persistence, RBAC/MFA, refunds, chargebacks, supplier payouts and payment-provider sandbox adapters are not implemented yet.

## Production lock

There is no production payment adapter or production inference adapter in this release. A frontend flag or ordinary environment variable cannot make this sandbox production-capable. Each future market requires independently reviewed operating, payment, KYC/KYB, sanctions, tax, privacy, data-residency, vendor-authorization, dual-approval, and bounded live-pilot evidence before any real-money feature can be enabled.

The intended markets—China mainland, Hong Kong, Singapore, the United States, and the European Union—remain non-live. US states and EU member states have not yet been scoped, and requests or funds must never fail over across markets.

## Repository map

- `apps/api`: local HTTP control and inference surface
- `packages/core`: in-memory sandbox domain, pricing, metering, and ledger logic
- `scripts/demo.ts`: executable end-to-end synthetic workflow
- `docs/api/openapi.yaml`: implemented HTTP contract
- `docs/compliance`: evidence metadata rules; confidential evidence remains outside Git
- `docs/security`: security assumptions and risk register
- `docs/runbooks`: operational and recovery notes

See [`docs/project-status.md`](docs/project-status.md) for the current lifecycle state and [`docs/blockers.md`](docs/blockers.md) for exact external recovery conditions.
