# Supplier routing state machines

- Status: Draft for Phase 2 freeze
- Date: 2026-08-30

Admission, runtime health and a single inference call are separate state machines. A healthy endpoint cannot override missing evidence, and an admitted endpoint cannot override an open circuit breaker.

## Endpoint admission

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> CONTROL_PENDING
    CONTROL_PENDING --> IDENTIFICATION_PENDING
    IDENTIFICATION_PENDING --> EVIDENCE_PENDING
    EVIDENCE_PENDING --> PRICE_REVIEW_PENDING
    PRICE_REVIEW_PENDING --> SANDBOX_READY
    SANDBOX_READY --> LIVE_APPROVAL_PENDING
    LIVE_APPROVAL_PENDING --> LIVE
    CONTROL_PENDING --> QUARANTINED
    IDENTIFICATION_PENDING --> QUARANTINED
    EVIDENCE_PENDING --> QUARANTINED
    PRICE_REVIEW_PENDING --> QUARANTINED
    SANDBOX_READY --> QUARANTINED
    LIVE_APPROVAL_PENDING --> QUARANTINED
    LIVE --> DRAINING
    DRAINING --> SUSPENDED
    QUARANTINED --> CONTROL_PENDING
    SUSPENDED --> CONTROL_PENDING
    LIVE --> REVOKED
    QUARANTINED --> REVOKED
    SUSPENDED --> REVOKED
```

An endpoint cannot enter `LIVE` while its compliance cell is `PENDING_REVIEW`, `PROHIBITED` or `STALE_EVIDENCE`. Address, protocol, account, operator, model mapping, region, credential reference or price changes create a new reviewed version rather than mutating the admitted version.

## Health and circuit breaker

Health is `UNKNOWN`, `HEALTHY`, `DEGRADED` or `UNHEALTHY`. Circuit state is `CLOSED`, `OPEN` or `HALF_OPEN`. These signals cannot reactivate `SUSPENDED`, `QUARANTINED`, `REVOKED` or non-admitted endpoints.

## Inference call

```mermaid
stateDiagram-v2
    [*] --> RECEIVED
    RECEIVED --> POLICY_CHECKED
    POLICY_CHECKED --> CANDIDATES_ELIGIBLE
    CANDIDATES_ELIGIBLE --> PRICE_SNAPSHOT_BOUND
    PRICE_SNAPSHOT_BOUND --> HOLD_PLACED
    HOLD_PLACED --> CAPACITY_RESERVED
    CAPACITY_RESERVED --> DISPATCHED
    DISPATCHED --> STREAMING
    STREAMING --> TERMINATED
    TERMINATED --> USAGE_FINALIZED
    USAGE_FINALIZED --> FINANCIAL_FINALIZED
    RECEIVED --> REJECTED
    POLICY_CHECKED --> REJECTED
    DISPATCHED --> FAILED
    DISPATCHED --> AMBIGUOUS_UPSTREAM_OUTCOME
    STREAMING --> CANCELLED
    STREAMING --> FAILED
    STREAMING --> AMBIGUOUS_UPSTREAM_OUTCOME
    AMBIGUOUS_UPSTREAM_OUTCOME --> MANUAL_REVIEW_REQUIRED
```

Every transition is idempotent and audited. The route decision stores stable exclusion reasons for every candidate and snapshots policy, endpoint, authorization, canonical model, meter schema, price, health, capacity and SLA versions.

No-output retries require an unambiguous failed attempt and compatible idempotency. After first byte, the platform does not automatically dispatch to another supplier. Cancellation still records partial usage. An ambiguous upstream outcome cannot be declared successful or retried merely because the network timed out.
