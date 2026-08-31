# ADR 0003: Sandbox billing and metering boundary

- Status: Accepted for the sandbox; production design remains subject to Phase 2 review
- Date: 2026-08-31

## Context

The first sandbox calculated token usage, supplier cost and platform fees directly inside the inference orchestration method. That proved the vertical slice, but it mixed measurement, rating and ledger mutation; it also returned the complete synthetic output even when the quoted output-token limit was smaller than the estimated output. The platform needs a versioned, deterministic boundary before persistence, streaming or provider-reported usage is introduced.

## Decision

Introduce an internal, side-effect-free billing and metering module under `packages/core/src/billing` with three explicit stages:

1. `meter` creates an immutable usage record without writing money or the ledger;
2. `rate` applies the quote-pinned price and fee policy to that record using exact integer/rational arithmetic;
3. the marketplace orchestrator settles the already-rated totals through the existing balanced ledger.

No buyer-callable usage-ingestion, rating or settlement endpoint is added. The buyer cannot choose billable quantities. The existing HTTP field shape and synchronous execution model remain compatible.

## Meter schema

`sandbox-token-meter` version `1` defines these dimensions:

- input tokens;
- output tokens actually delivered;
- cache-read tokens;
- cache-write tokens;
- tool calls;
- requests.

The current mock adapter records cache and tool dimensions as zero and one request per completed inference. `totalTokens` keeps its existing meaning: input plus output tokens only. Future dimensions must not silently change that historical meaning.

Every usage record contains a stable record ID, inference and quote links, meter schema/version, source, finality, outcome, normalized decimal-string quantities, creation time and a SHA-256 content digest. It contains neither prompt nor output content. Current source is explicitly `SANDBOX_ESTIMATE`; it is not authoritative provider usage.

## Rating policy

Rates use exact rational values:

`rateNumeratorMinor / rateDenominatorUnits`

This permits sub-minor-unit per-token prices such as a minor-currency-unit amount per one million tokens without floating-point arithmetic. Each rate freezes its dimension and rounding mode. The policy also freezes currency, price ID/version, meter schema/version, billing-policy version, platform-fee basis points, platform-fee rounding and `PER_USAGE_RECORD` rounding scope.

The current public supplier-price fields retain their original per-token integer meaning and are converted internally to denominator `1`; this is backward compatible. A future public rational-rate contract requires a separately reviewed additive or versioned API.

The rating calculation fails closed when:

- a non-zero dimension has no frozen rate;
- usage and price use different meter-schema versions;
- content no longer matches its usage or pricing digest;
- a calculated amount exceeds the supported 38-digit minor-unit range;
- the actual buyer charge exceeds the immutable quote maximum.

## Sandbox output accounting

The synthetic adapter truncates delivered output at a Unicode grapheme boundary before measuring it. A quote with `maxOutputTokens = 0` therefore delivers and bills zero output. The recorded output quantity always describes the output actually returned by the sandbox.

## Consequences

- Metering and rating are deterministic pure functions and can be property-tested independently of API keys, endpoints, balances and ledger state.
- A quote stores an internal immutable rating-policy snapshot; a later supplier price does not change settlement.
- A quote also freezes the pricing digest and meter/billing-policy versions; inference validates the complete binding before any financial mutation.
- Each settled inference has an internal usage record, rating record and applicable ledger journal IDs when financial postings exist. These records are available to core tests but are not exposed as unauthenticated HTTP resources.
- Price selection is scoped by endpoint, model and buyer currency.
- The existing ledger remains an in-memory synchronous sandbox with in-process business-key deduplication and atomic inference journal batches with rollback. Database transactions, durable database-enforced unique business-key constraints, outbox/inbox recovery, provider usage finalization, discrepancies, refunds, payouts and reconciliation remain future work.

## Rejected alternatives

- Continue calculating usage and money inline in the inference method.
- Accept buyer-supplied usage quantities.
- Use JavaScript floating-point values for per-million-token pricing.
- Change `totalTokens` to include cache, tool or request dimensions.
- Return unmetered output beyond the quoted limit.
- Describe byte-based sandbox estimates as vendor-authoritative token usage.
