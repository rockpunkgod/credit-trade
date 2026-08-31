export const METER_DIMENSIONS = Object.freeze([
  "INPUT_TOKENS",
  "OUTPUT_TOKENS",
  "CACHE_READ_TOKENS",
  "CACHE_WRITE_TOKENS",
  "TOOL_CALLS",
  "REQUESTS",
] as const);

export type MeterDimension = typeof METER_DIMENSIONS[number];
export type UsageSource = "SANDBOX_ESTIMATE" | "PLATFORM_OBSERVED" | "PROVIDER_REPORTED";
export type UsageFinality = "PROVISIONAL" | "FINAL" | "DISPUTED";
export type UsageOutcome = "SUCCEEDED" | "INTERRUPTED" | "FAILED" | "OUTCOME_UNKNOWN";
export type RoundingMode = "CEILING" | "FLOOR" | "HALF_EVEN";
export type RoundingScope = "PER_USAGE_RECORD";

export type MeterDimensionDefinition = Readonly<{
  dimension: MeterDimension;
  unit: "TOKEN" | "CALL" | "REQUEST";
  description: string;
}>;

export type MeterSchema = Readonly<{
  meterSchemaId: string;
  meterSchemaVersion: string;
  dimensions: readonly MeterDimensionDefinition[];
  totalTokensSemantics: "INPUT_PLUS_OUTPUT";
}>;

export const TOKEN_METER_SCHEMA_V1: MeterSchema = Object.freeze({
  meterSchemaId: "sandbox-token-meter",
  meterSchemaVersion: "1",
  dimensions: Object.freeze([
    Object.freeze({
      dimension: "INPUT_TOKENS",
      unit: "TOKEN",
      description: "Estimated non-cached input tokens for the sandbox request.",
    }),
    Object.freeze({
      dimension: "OUTPUT_TOKENS",
      unit: "TOKEN",
      description: "Estimated output tokens actually delivered by the sandbox.",
    }),
    Object.freeze({
      dimension: "CACHE_READ_TOKENS",
      unit: "TOKEN",
      description: "Non-overlapping cached tokens read; unsupported sandbox usage remains zero.",
    }),
    Object.freeze({
      dimension: "CACHE_WRITE_TOKENS",
      unit: "TOKEN",
      description: "Non-overlapping cached tokens written; unsupported sandbox usage remains zero.",
    }),
    Object.freeze({
      dimension: "TOOL_CALLS",
      unit: "CALL",
      description: "Tool calls attributed to the request; unsupported sandbox usage remains zero.",
    }),
    Object.freeze({
      dimension: "REQUESTS",
      unit: "REQUEST",
      description: "Finalized inference requests represented by the usage record.",
    }),
  ]),
  totalTokensSemantics: "INPUT_PLUS_OUTPUT",
});

export type MeterQuantities = Readonly<Record<MeterDimension, string>>;

export type UsageRecord = Readonly<{
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
  usageDigest: string;
  createdAt: string;
}>;

export type MeterRate = Readonly<{
  dimension: MeterDimension;
  rateNumeratorMinor: string;
  rateDenominatorUnits: string;
  roundingMode: RoundingMode;
}>;

export type RatingPolicySnapshot = Readonly<{
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
  pricingDigest: string;
}>;

export type BillingLineItem = Readonly<{
  dimension: MeterDimension;
  quantity: string;
  rateNumeratorMinor: string;
  rateDenominatorUnits: string;
  roundingMode: RoundingMode;
  roundingScope: RoundingScope;
  amountMinor: string;
}>;

export type BillingCalculation = Readonly<{
  currency: string;
  pricingDigest: string;
  lineItems: readonly BillingLineItem[];
  supplierCostMinor: string;
  platformFeeBps: string;
  platformFeeRoundingMode: RoundingMode;
  platformFeeMinor: string;
  buyerChargeMinor: string;
}>;

export type RatingRecord = Readonly<{
  ratingId: string;
  usageRecordId: string;
  inferenceId: string;
  quoteId: string;
  meterSchemaId: string;
  meterSchemaVersion: string;
  priceId: string;
  priceVersion: string;
  billingPolicyVersion: string;
  currency: string;
  pricingDigest: string;
  usageDigest: string;
  lineItems: readonly BillingLineItem[];
  supplierCostMinor: string;
  platformFeeBps: string;
  platformFeeRoundingMode: RoundingMode;
  platformFeeMinor: string;
  buyerChargeMinor: string;
  maximumChargeMinor: string;
  ratingDigest: string;
  ratedAt: string;
}>;
