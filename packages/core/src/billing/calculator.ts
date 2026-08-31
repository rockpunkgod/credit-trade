import { createHash } from "node:crypto";

import { DomainError } from "../errors.ts";
import {
  METER_DIMENSIONS,
  TOKEN_METER_SCHEMA_V1,
  type BillingCalculation,
  type BillingLineItem,
  type MeterDimension,
  type MeterQuantities,
  type MeterRate,
  type RatingPolicySnapshot,
  type RatingRecord,
  type RoundingMode,
  type RoundingScope,
  type UsageFinality,
  type UsageOutcome,
  type UsageRecord,
  type UsageSource,
} from "./contracts.ts";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_QUANTITY = 10_000_000n;
const MAX_MONEY_MINOR = (10n ** 38n) - 1n;
const ROUNDING_MODES = Object.freeze(["CEILING", "FLOOR", "HALF_EVEN"] as const);
const USAGE_SOURCES = Object.freeze([
  "SANDBOX_ESTIMATE",
  "PLATFORM_OBSERVED",
  "PROVIDER_REPORTED",
] as const);
const USAGE_FINALITIES = Object.freeze(["PROVISIONAL", "FINAL", "DISPUTED"] as const);
const USAGE_OUTCOMES = Object.freeze([
  "SUCCEEDED",
  "INTERRUPTED",
  "FAILED",
  "OUTCOME_UNKNOWN",
] as const);

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requireText(value: unknown, field: string, maximum = 128): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
  ) {
    throw new DomainError("INVALID_INPUT", `${field} is invalid`, { field });
  }
  return value;
}

function requireIdentifier(value: unknown, field: string): string {
  const identifier = requireText(value, field);
  if (!IDENTIFIER.test(identifier)) {
    throw new DomainError("INVALID_INPUT", `${field} is invalid`, { field });
  }
  return identifier;
}

function requireIsoTimestamp(value: unknown, field: string): string {
  const timestamp = requireText(value, field, 64);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw new DomainError("INVALID_INPUT", `${field} must be an ISO-8601 UTC timestamp`, { field });
  }
  return timestamp;
}

function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new DomainError("INVALID_INPUT", `${field} is unsupported`, { field });
  }
  return value as T;
}

function decimalInteger(
  value: unknown,
  field: string,
  options: { maximumDigits: number; allowZero: boolean; code: string },
): bigint {
  const pattern = new RegExp(`^(0|[1-9]\\d{0,${options.maximumDigits - 1}})$`);
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new DomainError(options.code, `${field} must be a decimal integer string`, { field });
  }
  const parsed = BigInt(value);
  if (!options.allowZero && parsed === 0n) {
    throw new DomainError(options.code, `${field} must be greater than zero`, { field });
  }
  return parsed;
}

function quantity(value: unknown, field: string): bigint {
  const parsed = decimalInteger(value, field, {
    maximumDigits: 8,
    allowZero: true,
    code: "INVALID_INPUT",
  });
  if (parsed > MAX_QUANTITY) {
    throw new DomainError("INVALID_INPUT", `${field} exceeds the meter limit`, { field });
  }
  return parsed;
}

function rateAmount(value: unknown, field: string, allowZero: boolean): bigint {
  return decimalInteger(value, field, {
    maximumDigits: 30,
    allowZero,
    code: "INVALID_RATE",
  });
}

function moneyAmount(value: unknown, field: string): bigint {
  return decimalInteger(value, field, {
    maximumDigits: 38,
    allowZero: true,
    code: "INVALID_MONEY",
  });
}

function assertMoneyRange(value: bigint, field: string): bigint {
  if (value < 0n || value > MAX_MONEY_MINOR) {
    throw new DomainError("INVALID_MONEY", `${field} exceeds the supported minor-unit range`, { field });
  }
  return value;
}

function requireMeterSchema(meterSchemaId: unknown, meterSchemaVersion: unknown): void {
  if (
    meterSchemaId !== TOKEN_METER_SCHEMA_V1.meterSchemaId
    || meterSchemaVersion !== TOKEN_METER_SCHEMA_V1.meterSchemaVersion
  ) {
    throw new DomainError("METER_SCHEMA_MISMATCH", "meter schema is unsupported");
  }
}

function roundRational(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || mode === "FLOOR") {
    return quotient;
  }
  if (mode === "CEILING") {
    return quotient + 1n;
  }
  const doubledRemainder = remainder * 2n;
  if (doubledRemainder < denominator) {
    return quotient;
  }
  if (doubledRemainder > denominator) {
    return quotient + 1n;
  }
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

function usageDigestFor(input: {
  usageRecordId: string;
  inferenceId: string;
  quoteId: string;
  meterSchemaId: string;
  meterSchemaVersion: string;
  source: UsageSource;
  finality: UsageFinality;
  outcome: UsageOutcome;
  quantities: MeterQuantities;
  totalTokens: string;
  createdAt: string;
}): string {
  return hashCanonical([
    input.usageRecordId,
    input.inferenceId,
    input.quoteId,
    input.meterSchemaId,
    input.meterSchemaVersion,
    input.source,
    input.finality,
    input.outcome,
    METER_DIMENSIONS.map((dimension) => [dimension, input.quantities[dimension]]),
    input.totalTokens,
    input.createdAt,
  ]);
}

function pricingDigestFor(input: Omit<RatingPolicySnapshot, "pricingDigest">): string {
  return hashCanonical([
    input.priceId,
    input.priceVersion,
    input.currency,
    input.meterSchemaId,
    input.meterSchemaVersion,
    input.billingPolicyVersion,
    input.roundingScope,
    input.platformFeeBps,
    input.platformFeeRoundingMode,
    input.rates.map((rate) => [
      rate.dimension,
      rate.rateNumeratorMinor,
      rate.rateDenominatorUnits,
      rate.roundingMode,
    ]),
  ]);
}

export function createMeterQuantities(
  input: Partial<Record<MeterDimension, string>>,
): MeterQuantities {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new DomainError("INVALID_INPUT", "meter quantities must be an object");
  }
  const known = new Set<string>(METER_DIMENSIONS);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      throw new DomainError("INVALID_INPUT", "meter quantity dimension is unsupported", {
        dimension: key,
      });
    }
  }
  const quantities = Object.fromEntries(METER_DIMENSIONS.map((dimension) => [
    dimension,
    quantity(input[dimension] ?? "0", dimension).toString(),
  ])) as Record<MeterDimension, string>;
  return Object.freeze(quantities);
}

export function createUsageRecord(input: {
  usageRecordId: string;
  inferenceId: string;
  quoteId: string;
  source: UsageSource;
  finality: UsageFinality;
  outcome: UsageOutcome;
  quantities: Partial<Record<MeterDimension, string>>;
  createdAt: string;
}): UsageRecord {
  const usageRecordId = requireIdentifier(input.usageRecordId, "usageRecordId");
  const inferenceId = requireIdentifier(input.inferenceId, "inferenceId");
  const quoteId = requireIdentifier(input.quoteId, "quoteId");
  const source = requireEnum(input.source, "source", USAGE_SOURCES);
  const finality = requireEnum(input.finality, "finality", USAGE_FINALITIES);
  const outcome = requireEnum(input.outcome, "outcome", USAGE_OUTCOMES);
  const quantities = createMeterQuantities(input.quantities);
  const totalTokens = (
    BigInt(quantities.INPUT_TOKENS) + BigInt(quantities.OUTPUT_TOKENS)
  ).toString();
  const createdAt = requireIsoTimestamp(input.createdAt, "createdAt");
  const recordWithoutDigest = {
    usageRecordId,
    inferenceId,
    quoteId,
    meterSchemaId: TOKEN_METER_SCHEMA_V1.meterSchemaId,
    meterSchemaVersion: TOKEN_METER_SCHEMA_V1.meterSchemaVersion,
    source,
    finality,
    outcome,
    quantities,
    totalTokens,
    createdAt,
  } as const;
  return Object.freeze({
    ...recordWithoutDigest,
    usageDigest: usageDigestFor(recordWithoutDigest),
  });
}

export function createRatingPolicySnapshot(input: {
  priceId: string;
  priceVersion: string;
  currency: string;
  meterSchemaId: string;
  meterSchemaVersion: string;
  billingPolicyVersion: string;
  roundingScope: RoundingScope;
  platformFeeBps: string;
  platformFeeRoundingMode: RoundingMode;
  rates: readonly MeterRate[];
}): RatingPolicySnapshot {
  const priceId = requireIdentifier(input.priceId, "priceId");
  const priceVersion = requireText(input.priceVersion, "priceVersion", 64);
  const currency = requireText(input.currency, "currency", 3);
  if (!CURRENCY.test(currency)) {
    throw new DomainError("INVALID_MONEY", "currency must be a three-letter uppercase code");
  }
  requireMeterSchema(input.meterSchemaId, input.meterSchemaVersion);
  const billingPolicyVersion = requireText(input.billingPolicyVersion, "billingPolicyVersion", 64);
  if (input.roundingScope !== "PER_USAGE_RECORD") {
    throw new DomainError("INVALID_RATE", "rounding scope is unsupported");
  }
  const platformFeeBps = decimalInteger(input.platformFeeBps, "platformFeeBps", {
    maximumDigits: 5,
    allowZero: true,
    code: "INVALID_PRICE",
  });
  if (platformFeeBps > 10_000n) {
    throw new DomainError("INVALID_PRICE", "platform fee cannot exceed 10000 basis points");
  }
  const platformFeeRoundingMode = requireEnum(
    input.platformFeeRoundingMode,
    "platformFeeRoundingMode",
    ROUNDING_MODES,
  );
  if (!Array.isArray(input.rates) || input.rates.length === 0) {
    throw new DomainError("INVALID_RATE", "at least one meter rate is required");
  }
  const seen = new Set<MeterDimension>();
  const rates: MeterRate[] = [];
  for (const candidate of input.rates) {
    if (!METER_DIMENSIONS.includes(candidate.dimension)) {
      throw new DomainError("INVALID_RATE", "meter rate dimension is unsupported");
    }
    if (seen.has(candidate.dimension)) {
      throw new DomainError("INVALID_RATE", "meter rate dimension is duplicated", {
        dimension: candidate.dimension,
      });
    }
    seen.add(candidate.dimension);
    rates.push(Object.freeze({
      dimension: candidate.dimension,
      rateNumeratorMinor: rateAmount(
        candidate.rateNumeratorMinor,
        `${candidate.dimension}.rateNumeratorMinor`,
        true,
      ).toString(),
      rateDenominatorUnits: rateAmount(
        candidate.rateDenominatorUnits,
        `${candidate.dimension}.rateDenominatorUnits`,
        false,
      ).toString(),
      roundingMode: requireEnum(
        candidate.roundingMode,
        `${candidate.dimension}.roundingMode`,
        ROUNDING_MODES,
      ),
    }));
  }
  rates.sort((left, right) => (
    METER_DIMENSIONS.indexOf(left.dimension) - METER_DIMENSIONS.indexOf(right.dimension)
  ));
  const snapshotWithoutDigest: Omit<RatingPolicySnapshot, "pricingDigest"> = Object.freeze({
    priceId,
    priceVersion,
    currency,
    meterSchemaId: TOKEN_METER_SCHEMA_V1.meterSchemaId,
    meterSchemaVersion: TOKEN_METER_SCHEMA_V1.meterSchemaVersion,
    billingPolicyVersion,
    roundingScope: "PER_USAGE_RECORD",
    platformFeeBps: platformFeeBps.toString(),
    platformFeeRoundingMode,
    rates: Object.freeze(rates),
  });
  return Object.freeze({
    ...snapshotWithoutDigest,
    pricingDigest: pricingDigestFor(snapshotWithoutDigest),
  });
}

function validatedPolicy(policy: RatingPolicySnapshot): RatingPolicySnapshot {
  const validated = createRatingPolicySnapshot({
    priceId: policy.priceId,
    priceVersion: policy.priceVersion,
    currency: policy.currency,
    meterSchemaId: policy.meterSchemaId,
    meterSchemaVersion: policy.meterSchemaVersion,
    billingPolicyVersion: policy.billingPolicyVersion,
    roundingScope: policy.roundingScope,
    platformFeeBps: policy.platformFeeBps,
    platformFeeRoundingMode: policy.platformFeeRoundingMode,
    rates: policy.rates,
  });
  if (validated.pricingDigest !== policy.pricingDigest) {
    throw new DomainError("RATING_POLICY_TAMPERED", "rating policy digest does not match its content");
  }
  return validated;
}

export function calculateBilling(input: {
  quantities: MeterQuantities;
  policy: RatingPolicySnapshot;
  maximumChargeMinor?: string;
}): BillingCalculation {
  const quantities = createMeterQuantities(input.quantities);
  const policy = validatedPolicy(input.policy);
  const rateByDimension = new Map(policy.rates.map((rate) => [rate.dimension, rate]));
  for (const dimension of METER_DIMENSIONS) {
    if (BigInt(quantities[dimension]) > 0n && !rateByDimension.has(dimension)) {
      throw new DomainError("UNPRICED_USAGE", "non-zero usage has no frozen meter rate", { dimension });
    }
  }

  const lineItems: BillingLineItem[] = policy.rates.map((rate) => {
    const meteredQuantity = BigInt(quantities[rate.dimension]);
    const numerator = meteredQuantity * BigInt(rate.rateNumeratorMinor);
    const amount = assertMoneyRange(
      roundRational(numerator, BigInt(rate.rateDenominatorUnits), rate.roundingMode),
      `${rate.dimension}.amountMinor`,
    );
    return Object.freeze({
      dimension: rate.dimension,
      quantity: meteredQuantity.toString(),
      rateNumeratorMinor: rate.rateNumeratorMinor,
      rateDenominatorUnits: rate.rateDenominatorUnits,
      roundingMode: rate.roundingMode,
      roundingScope: policy.roundingScope,
      amountMinor: amount.toString(),
    });
  });
  const supplierCost = assertMoneyRange(
    lineItems.reduce((total, lineItem) => total + BigInt(lineItem.amountMinor), 0n),
    "supplierCostMinor",
  );
  const platformFee = assertMoneyRange(
    roundRational(
      supplierCost * BigInt(policy.platformFeeBps),
      10_000n,
      policy.platformFeeRoundingMode,
    ),
    "platformFeeMinor",
  );
  const buyerCharge = assertMoneyRange(supplierCost + platformFee, "buyerChargeMinor");
  if (input.maximumChargeMinor !== undefined) {
    const maximumCharge = moneyAmount(input.maximumChargeMinor, "maximumChargeMinor");
    if (buyerCharge > maximumCharge) {
      throw new DomainError("INVALID_PRICE", "actual charge exceeded the immutable quote maximum");
    }
  }
  return Object.freeze({
    currency: policy.currency,
    pricingDigest: policy.pricingDigest,
    lineItems: Object.freeze(lineItems),
    supplierCostMinor: supplierCost.toString(),
    platformFeeBps: policy.platformFeeBps,
    platformFeeRoundingMode: policy.platformFeeRoundingMode,
    platformFeeMinor: platformFee.toString(),
    buyerChargeMinor: buyerCharge.toString(),
  });
}

export function createRatingRecord(input: {
  ratingId: string;
  usageRecord: UsageRecord;
  policy: RatingPolicySnapshot;
  maximumChargeMinor: string;
  ratedAt: string;
}): RatingRecord {
  const ratingId = requireIdentifier(input.ratingId, "ratingId");
  const ratedAt = requireIsoTimestamp(input.ratedAt, "ratedAt");
  requireMeterSchema(input.usageRecord.meterSchemaId, input.usageRecord.meterSchemaVersion);
  const validatedUsage = createUsageRecord({
    usageRecordId: input.usageRecord.usageRecordId,
    inferenceId: input.usageRecord.inferenceId,
    quoteId: input.usageRecord.quoteId,
    source: input.usageRecord.source,
    finality: input.usageRecord.finality,
    outcome: input.usageRecord.outcome,
    quantities: input.usageRecord.quantities,
    createdAt: input.usageRecord.createdAt,
  });
  if (
    validatedUsage.usageDigest !== input.usageRecord.usageDigest
    || validatedUsage.totalTokens !== input.usageRecord.totalTokens
  ) {
    throw new DomainError("USAGE_CONFLICT", "usage digest or derived totals do not match its content");
  }
  const policy = validatedPolicy(input.policy);
  if (
    validatedUsage.meterSchemaId !== policy.meterSchemaId
    || validatedUsage.meterSchemaVersion !== policy.meterSchemaVersion
  ) {
    throw new DomainError("METER_SCHEMA_MISMATCH", "usage and rating policy meter schemas differ");
  }
  const maximumCharge = moneyAmount(input.maximumChargeMinor, "maximumChargeMinor").toString();
  const calculation = calculateBilling({
    quantities: validatedUsage.quantities,
    policy,
    maximumChargeMinor: maximumCharge,
  });
  const recordWithoutDigest = {
    ratingId,
    usageRecordId: validatedUsage.usageRecordId,
    inferenceId: validatedUsage.inferenceId,
    quoteId: validatedUsage.quoteId,
    meterSchemaId: validatedUsage.meterSchemaId,
    meterSchemaVersion: validatedUsage.meterSchemaVersion,
    priceId: policy.priceId,
    priceVersion: policy.priceVersion,
    billingPolicyVersion: policy.billingPolicyVersion,
    currency: calculation.currency,
    pricingDigest: calculation.pricingDigest,
    usageDigest: validatedUsage.usageDigest,
    lineItems: calculation.lineItems,
    supplierCostMinor: calculation.supplierCostMinor,
    platformFeeBps: calculation.platformFeeBps,
    platformFeeRoundingMode: calculation.platformFeeRoundingMode,
    platformFeeMinor: calculation.platformFeeMinor,
    buyerChargeMinor: calculation.buyerChargeMinor,
    maximumChargeMinor: maximumCharge,
    ratedAt,
  } as const;
  const ratingDigest = hashCanonical([
    recordWithoutDigest.ratingId,
    recordWithoutDigest.usageRecordId,
    recordWithoutDigest.inferenceId,
    recordWithoutDigest.quoteId,
    recordWithoutDigest.meterSchemaId,
    recordWithoutDigest.meterSchemaVersion,
    recordWithoutDigest.priceId,
    recordWithoutDigest.priceVersion,
    recordWithoutDigest.billingPolicyVersion,
    recordWithoutDigest.currency,
    recordWithoutDigest.pricingDigest,
    recordWithoutDigest.usageDigest,
    recordWithoutDigest.lineItems.map((lineItem) => [
      lineItem.dimension,
      lineItem.quantity,
      lineItem.rateNumeratorMinor,
      lineItem.rateDenominatorUnits,
      lineItem.roundingMode,
      lineItem.roundingScope,
      lineItem.amountMinor,
    ]),
    recordWithoutDigest.supplierCostMinor,
    recordWithoutDigest.platformFeeBps,
    recordWithoutDigest.platformFeeRoundingMode,
    recordWithoutDigest.platformFeeMinor,
    recordWithoutDigest.buyerChargeMinor,
    recordWithoutDigest.maximumChargeMinor,
    recordWithoutDigest.ratedAt,
  ]);
  return Object.freeze({ ...recordWithoutDigest, ratingDigest });
}
