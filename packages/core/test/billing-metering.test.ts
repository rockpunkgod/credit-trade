import assert from "node:assert/strict";
import test from "node:test";

import {
  METER_DIMENSIONS,
  TOKEN_METER_SCHEMA_V1,
  calculateBilling,
  createMeterQuantities,
  createRatingPolicySnapshot,
  createRatingRecord,
  createUsageRecord,
  estimateTextTokens,
  meterSandboxText,
  truncateTextToEstimatedTokenLimit,
  type MeterRate,
  type RatingPolicySnapshot,
  type UsageRecord,
} from "../src/billing/index.ts";
import { DomainError } from "../src/errors.ts";

const FIXED_TIME = "2026-08-31T00:00:00.000Z";

function policy(
  rates: readonly MeterRate[],
  options: { platformFeeBps?: string; platformFeeRoundingMode?: "CEILING" | "FLOOR" | "HALF_EVEN" } = {},
): RatingPolicySnapshot {
  return createRatingPolicySnapshot({
    priceId: "price_test",
    priceVersion: "1",
    currency: "USD",
    meterSchemaId: TOKEN_METER_SCHEMA_V1.meterSchemaId,
    meterSchemaVersion: TOKEN_METER_SCHEMA_V1.meterSchemaVersion,
    billingPolicyVersion: "sandbox-cost-plus-v1",
    roundingScope: "PER_USAGE_RECORD",
    platformFeeBps: options.platformFeeBps ?? "1000",
    platformFeeRoundingMode: options.platformFeeRoundingMode ?? "CEILING",
    rates,
  });
}

function isDomainError(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof DomainError && error.code === code;
}

test("exact rational rates support per-million-token pricing without floating point", () => {
  const ratingPolicy = policy([{
    dimension: "INPUT_TOKENS",
    rateNumeratorMinor: "15",
    rateDenominatorUnits: "1000000",
    roundingMode: "CEILING",
  }]);
  const result = calculateBilling({
    quantities: createMeterQuantities({ INPUT_TOKENS: "1000001" }),
    policy: ratingPolicy,
  });

  assert.equal(result.supplierCostMinor, "16");
  assert.equal(result.platformFeeMinor, "2");
  assert.equal(result.buyerChargeMinor, "18");
  assert.deepEqual(result.lineItems[0], {
    dimension: "INPUT_TOKENS",
    quantity: "1000001",
    rateNumeratorMinor: "15",
    rateDenominatorUnits: "1000000",
    roundingMode: "CEILING",
    roundingScope: "PER_USAGE_RECORD",
    amountMinor: "16",
  });
});

test("HALF_EVEN rounding is deterministic at exact ties", () => {
  const ratingPolicy = policy([{
    dimension: "INPUT_TOKENS",
    rateNumeratorMinor: "1",
    rateDenominatorUnits: "2",
    roundingMode: "HALF_EVEN",
  }], { platformFeeBps: "0", platformFeeRoundingMode: "HALF_EVEN" });

  const even = calculateBilling({
    quantities: createMeterQuantities({ INPUT_TOKENS: "1" }),
    policy: ratingPolicy,
  });
  const odd = calculateBilling({
    quantities: createMeterQuantities({ INPUT_TOKENS: "3" }),
    policy: ratingPolicy,
  });
  assert.equal(even.supplierCostMinor, "0");
  assert.equal(odd.supplierCostMinor, "2");

  const floor = calculateBilling({
    quantities: createMeterQuantities({ INPUT_TOKENS: "3" }),
    policy: policy([{
      dimension: "INPUT_TOKENS",
      rateNumeratorMinor: "1",
      rateDenominatorUnits: "2",
      roundingMode: "FLOOR",
    }], { platformFeeBps: "0" }),
  });
  assert.equal(floor.supplierCostMinor, "1");
});

test("platform fee basis-point boundaries use the frozen per-record rounding rule", () => {
  const quantities = createMeterQuantities({ INPUT_TOKENS: "1" });
  const fees = ["0", "1", "9999", "10000"].map((platformFeeBps) => calculateBilling({
    quantities,
    policy: policy([{
      dimension: "INPUT_TOKENS",
      rateNumeratorMinor: "1",
      rateDenominatorUnits: "1",
      roundingMode: "CEILING",
    }], { platformFeeBps }),
  }).platformFeeMinor);
  assert.deepEqual(fees, ["0", "1", "1", "1"]);
});

test("usage and rating records are versioned, linked and digest-stable", () => {
  const usageInput = {
    usageRecordId: "usage_test",
    inferenceId: "inference_test",
    quoteId: "quote_test",
    source: "PLATFORM_OBSERVED" as const,
    finality: "FINAL" as const,
    outcome: "SUCCEEDED" as const,
    quantities: {
      INPUT_TOKENS: "10",
      OUTPUT_TOKENS: "4",
      CACHE_READ_TOKENS: "3",
      CACHE_WRITE_TOKENS: "2",
      TOOL_CALLS: "1",
      REQUESTS: "1",
    },
    createdAt: FIXED_TIME,
  };
  const usage = createUsageRecord(usageInput);
  const replayedUsage = createUsageRecord(usageInput);
  assert.deepEqual(replayedUsage, usage);
  assert.equal(usage.totalTokens, "14");
  assert.equal(usage.quantities.CACHE_READ_TOKENS, "3");
  assert.match(usage.usageDigest, /^[a-f0-9]{64}$/);

  const ratingPolicy = policy([
    { dimension: "INPUT_TOKENS", rateNumeratorMinor: "2", rateDenominatorUnits: "1", roundingMode: "CEILING" },
    { dimension: "OUTPUT_TOKENS", rateNumeratorMinor: "4", rateDenominatorUnits: "1", roundingMode: "CEILING" },
    { dimension: "CACHE_READ_TOKENS", rateNumeratorMinor: "1", rateDenominatorUnits: "2", roundingMode: "CEILING" },
    { dimension: "CACHE_WRITE_TOKENS", rateNumeratorMinor: "0", rateDenominatorUnits: "1", roundingMode: "CEILING" },
    { dimension: "TOOL_CALLS", rateNumeratorMinor: "10", rateDenominatorUnits: "1", roundingMode: "CEILING" },
    { dimension: "REQUESTS", rateNumeratorMinor: "5", rateDenominatorUnits: "1", roundingMode: "CEILING" },
  ]);
  const ratingInput = {
    ratingId: "rating_test",
    usageRecord: usage,
    policy: ratingPolicy,
    maximumChargeMinor: "100",
    ratedAt: FIXED_TIME,
  };
  const rating = createRatingRecord(ratingInput);
  const replayedRating = createRatingRecord(ratingInput);
  assert.deepEqual(replayedRating, rating);
  assert.equal(rating.supplierCostMinor, "53");
  assert.equal(rating.platformFeeMinor, "6");
  assert.equal(rating.buyerChargeMinor, "59");
  assert.equal(rating.usageDigest, usage.usageDigest);
  assert.match(rating.pricingDigest, /^[a-f0-9]{64}$/);
  assert.match(rating.ratingDigest, /^[a-f0-9]{64}$/);
});

test("non-zero usage without a frozen rate fails closed", () => {
  const ratingPolicy = policy([{
    dimension: "INPUT_TOKENS",
    rateNumeratorMinor: "1",
    rateDenominatorUnits: "1",
    roundingMode: "CEILING",
  }]);
  assert.throws(
    () => calculateBilling({
      quantities: createMeterQuantities({ TOOL_CALLS: "1" }),
      policy: ratingPolicy,
    }),
    isDomainError("UNPRICED_USAGE"),
  );
});

test("rating cannot exceed the immutable quote maximum", () => {
  const usage = createUsageRecord({
    usageRecordId: "usage_hold",
    inferenceId: "inference_hold",
    quoteId: "quote_hold",
    source: "SANDBOX_ESTIMATE",
    finality: "FINAL",
    outcome: "SUCCEEDED",
    quantities: { INPUT_TOKENS: "10" },
    createdAt: FIXED_TIME,
  });
  const ratingPolicy = policy([{
    dimension: "INPUT_TOKENS",
    rateNumeratorMinor: "2",
    rateDenominatorUnits: "1",
    roundingMode: "CEILING",
  }], { platformFeeBps: "0" });
  assert.throws(
    () => createRatingRecord({
      ratingId: "rating_hold",
      usageRecord: usage,
      policy: ratingPolicy,
      maximumChargeMinor: "19",
      ratedAt: FIXED_TIME,
    }),
    isDomainError("INVALID_PRICE"),
  );
});

test("meter quantities and rates reject non-integer or ambiguous values", () => {
  for (const invalid of ["-1", "1.5", "1e3", "01", " 1", 1]) {
    assert.throws(
      () => createMeterQuantities({ INPUT_TOKENS: invalid as unknown as string }),
      isDomainError("INVALID_INPUT"),
    );
  }
  assert.throws(
    () => policy([{
      dimension: "INPUT_TOKENS",
      rateNumeratorMinor: "1",
      rateDenominatorUnits: "0",
      roundingMode: "CEILING",
    }]),
    isDomainError("INVALID_RATE"),
  );
});

test("UTF-8 estimates and truncation preserve Unicode grapheme boundaries", () => {
  assert.equal(estimateTextTokens(""), "0");
  assert.equal(estimateTextTokens("abcd"), "1");
  assert.equal(estimateTextTokens("abcde"), "2");
  assert.equal(estimateTextTokens("😀"), "1");
  assert.equal(estimateTextTokens("😀a"), "2");
  assert.equal(truncateTextToEstimatedTokenLimit("😀a", "1"), "😀");
  assert.equal(truncateTextToEstimatedTokenLimit("你好", "1"), "你");
  assert.equal(truncateTextToEstimatedTokenLimit("👨‍👩‍👧‍👦", "1"), "");
  assert.equal(truncateTextToEstimatedTokenLimit("abce\u0301", "1"), "abc");
  assert.equal(truncateTextToEstimatedTokenLimit("anything", "0"), "");
});

test("sandbox metering returns and bills no output when the quote limit is zero", () => {
  const metered = meterSandboxText({
    usageRecordId: "usage_zero",
    inferenceId: "inference_zero",
    quoteId: "quote_zero",
    inputText: "test",
    generatedOutput: "unbilled output must not escape",
    maxInputTokens: "1",
    maxOutputTokens: "0",
    createdAt: FIXED_TIME,
  });
  assert.equal(metered.deliveredOutput, "");
  assert.equal(metered.usageRecord.quantities.INPUT_TOKENS, "1");
  assert.equal(metered.usageRecord.quantities.OUTPUT_TOKENS, "0");
  assert.equal(metered.usageRecord.totalTokens, "1");
  assert.equal(metered.usageRecord.source, "SANDBOX_ESTIMATE");
});

test("sandbox output usage always matches the text actually delivered", () => {
  const metered = meterSandboxText({
    usageRecordId: "usage_delivery",
    inferenceId: "inference_delivery",
    quoteId: "quote_delivery",
    inputText: "PROMPT_SECRET",
    generatedOutput: "OUTPUT_SECRET😀中文abcdef",
    maxInputTokens: "4",
    maxOutputTokens: "2",
    createdAt: FIXED_TIME,
  });
  assert.equal(
    metered.usageRecord.quantities.OUTPUT_TOKENS,
    estimateTextTokens(metered.deliveredOutput),
  );
  assert.ok(BigInt(estimateTextTokens(metered.deliveredOutput)) <= 2n);
  assert.doesNotMatch(JSON.stringify(metered.usageRecord), /PROMPT_SECRET|OUTPUT_SECRET/);
});

test("sandbox metering rejects input beyond the quote instead of undercounting it", () => {
  assert.throws(
    () => meterSandboxText({
      usageRecordId: "usage_limit",
      inferenceId: "inference_limit",
      quoteId: "quote_limit",
      inputText: "five",
      generatedOutput: "output",
      maxInputTokens: "0",
      maxOutputTokens: "10",
      createdAt: FIXED_TIME,
    }),
    isDomainError("USAGE_LIMIT_EXCEEDED"),
  );
});

test("large exact amounts remain decimal strings beyond Number safe integer", () => {
  const ratingPolicy = policy([{
    dimension: "INPUT_TOKENS",
    rateNumeratorMinor: "999999999999999999999999999999",
    rateDenominatorUnits: "1",
    roundingMode: "CEILING",
  }], { platformFeeBps: "10000" });
  const result = calculateBilling({
    quantities: createMeterQuantities({ INPUT_TOKENS: "10000000" }),
    policy: ratingPolicy,
  });
  assert.equal(typeof result.buyerChargeMinor, "string");
  assert.ok(BigInt(result.buyerChargeMinor) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(BigInt(result.buyerChargeMinor), BigInt(result.supplierCostMinor) * 2n);

  const maximumRate = "999999999999999999999999999999";
  const overflowingPolicy = policy(METER_DIMENSIONS.map((dimension) => ({
    dimension,
    rateNumeratorMinor: maximumRate,
    rateDenominatorUnits: "1",
    roundingMode: "CEILING" as const,
  })), { platformFeeBps: "10000" });
  assert.throws(
    () => calculateBilling({
      quantities: createMeterQuantities(Object.fromEntries(
        METER_DIMENSIONS.map((dimension) => [dimension, "10000000"]),
      )),
      policy: overflowingPolicy,
    }),
    isDomainError("INVALID_MONEY"),
  );
});

test("content digests reject tampered usage and price snapshots", () => {
  const usage = createUsageRecord({
    usageRecordId: "usage_digest",
    inferenceId: "inference_digest",
    quoteId: "quote_digest",
    source: "SANDBOX_ESTIMATE",
    finality: "FINAL",
    outcome: "SUCCEEDED",
    quantities: { INPUT_TOKENS: "1" },
    createdAt: FIXED_TIME,
  });
  const ratingPolicy = policy([{
    dimension: "INPUT_TOKENS",
    rateNumeratorMinor: "1",
    rateDenominatorUnits: "1",
    roundingMode: "CEILING",
  }], { platformFeeBps: "0" });
  const tamperedUsage = {
    ...usage,
    quantities: createMeterQuantities({ INPUT_TOKENS: "2" }),
  } as UsageRecord;
  assert.throws(
    () => createRatingRecord({
      ratingId: "rating_usage_tamper",
      usageRecord: tamperedUsage,
      policy: ratingPolicy,
      maximumChargeMinor: "10",
      ratedAt: FIXED_TIME,
    }),
    isDomainError("USAGE_CONFLICT"),
  );

  const tamperedTotal = { ...usage, totalTokens: "999" } as UsageRecord;
  assert.throws(
    () => createRatingRecord({
      ratingId: "rating_total_tamper",
      usageRecord: tamperedTotal,
      policy: ratingPolicy,
      maximumChargeMinor: "10",
      ratedAt: FIXED_TIME,
    }),
    isDomainError("USAGE_CONFLICT"),
  );

  const tamperedPolicy = { ...ratingPolicy, platformFeeBps: "1" } as RatingPolicySnapshot;
  assert.throws(
    () => calculateBilling({
      quantities: usage.quantities,
      policy: tamperedPolicy,
    }),
    isDomainError("RATING_POLICY_TAMPERED"),
  );
});
