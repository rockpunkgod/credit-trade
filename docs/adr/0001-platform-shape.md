# ADR 0001: Platform shape and regional packaging

- Status: Proposed for Phase 2 review
- Date: 2026-08-30

## Context

The product must provide a vendor-neutral inference-service marketplace while keeping control-plane responsibilities, inference traffic, funds, evidence and regional operations separable. It must support five initial market families without maintaining five divergent products.

## Proposed decision

Use a TypeScript monorepo with:

- a shared domain core for identity, catalog, quote, routing, metering, ledger, risk and audit;
- independently deployable control-plane and inference data-plane services;
- a web console serving buyer, supplier, operator and auditor roles;
- PostgreSQL for authoritative transactional state and an append-only double-entry ledger;
- Redis only for non-authoritative coordination such as rate limiting, short-lived cache and queue support;
- OpenTelemetry for redacted metrics, logs and traces;
- Docker Compose for the local demonstration environment;
- versioned `marketpacks/cn-mainland`, `marketpacks/hk`, `marketpacks/sg`, `marketpacks/us/<state>`, and `marketpacks/eu/<member-state>` packages;
- provider, payment, identity-verification, tax and evidence interfaces with simulated/sandbox implementations first.

Production payment admission will be denied by default. Admission will require a server-verified evidence allowlist, separation of duties, two-person approval and immutable audit records. A front-end switch or ordinary environment variable cannot grant admission.

Regional failover will never move inference traffic, logs, data or funds to another market unless that route is explicitly admitted and tested for the requesting market.

## Consequences

- The shared domain model must carry market identity in every authoritative key and transaction boundary.
- Market builds and deployment credentials must be independently scoped.
- PostgreSQL remains authoritative; queues and networks are treated as at-least-once delivery.
- Financial effects require idempotency keys, unique constraints, database transactions, outbox/inbox records and compensating entries.
- Phase 2 must decide whether physical database separation is mandatory for each deployment or whether a tested strong logical boundary is acceptable for a specific non-production environment.

## Not decided here

Package versions, cloud provider, production payment/KYC/tax vendors, inference vendors, exact US states/EU member states, operating entities, currencies, retention periods and subprocessors remain unresolved.
