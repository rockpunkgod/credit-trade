import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  TOKEN_METER_SCHEMA_V1,
  calculateBilling,
  createMeterQuantities,
  createRatingPolicySnapshot,
  createRatingRecord,
  meterSandboxText,
  type RatingPolicySnapshot,
  type RatingRecord,
  type UsageRecord,
} from "./billing/index.ts";
import { DomainError } from "./errors.ts";

export * from "./billing/index.ts";
export { DomainError } from "./errors.ts";

type DetectionStatus = "VERIFIED_SANDBOX" | "UNIDENTIFIED" | "CONFLICT";
type EvidenceStatus = "PENDING_REVIEW" | "PROHIBITED";
type Direction = "DEBIT" | "CREDIT";

type Supplier = Readonly<{
  supplierId: string;
  name: string;
  kybStatus: "SANDBOX_FIXTURE";
  createdAt: string;
}>;

type Endpoint = Readonly<{
  endpointId: string;
  supplierId: string;
  url: string;
  declaredVendor?: string;
  detectedVendor?: string;
  detectionStatus: DetectionStatus;
  evidenceStatus: EvidenceStatus;
  sandboxRoutable: boolean;
  createdAt: string;
}>;

type ModelPrice = Readonly<{
  priceId: string;
  supplierId: string;
  endpointId: string;
  model: string;
  currency: string;
  inputTokenPriceMinor: string;
  outputTokenPriceMinor: string;
  version: string;
  effectiveAt: string;
}>;

type BuyerInternal = {
  buyerId: string;
  name: string;
  currency: string;
  apiKeyHash: string;
  createdAt: string;
};

type BuyerSnapshot = Readonly<{
  buyerId: string;
  name: string;
  currency: string;
  availableBalanceMinor: string;
  reservedBalanceMinor: string;
  createdAt: string;
}>;

type QuoteInternal = {
  quoteId: string;
  buyerId: string;
  supplierId: string;
  endpointId: string;
  detectedVendor: string;
  model: string;
  currency: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  inputTokenPriceMinor: string;
  outputTokenPriceMinor: string;
  supplierMaxCostMinor: string;
  platformFeeBps: string;
  platformMaxFeeMinor: string;
  maxHoldMinor: string;
  priceId: string;
  priceVersion: string;
  ratingPolicyBinding: Readonly<{
    pricingDigest: string;
    billingPolicyVersion: string;
    meterSchemaId: string;
    meterSchemaVersion: string;
  }>;
  createdAt: string;
  expiresAt: string;
  status: "ISSUED" | "USED";
};

type QuoteSnapshot = Omit<QuoteInternal, "ratingPolicyBinding">;

type Usage = Readonly<{
  inputTokens: string;
  outputTokens: string;
  totalTokens: string;
}>;

type InferenceResult = Readonly<{
  sandbox: true;
  inferenceId: string;
  quoteId: string;
  supplierId: string;
  endpointId: string;
  vendor: string;
  model: string;
  output: string;
  usage: Usage;
  currency: string;
  supplierCostMinor: string;
  platformFeeMinor: string;
  buyerChargeMinor: string;
  ledgerJournalIds: readonly string[];
  createdAt: string;
}>;

export type LedgerPosting = Readonly<{
  account: string;
  direction: Direction;
  amountMinor: string;
}>;

export type LedgerJournal = Readonly<{
  journalId: string;
  eventType: string;
  currency: string;
  businessKey: string;
  postings: readonly LedgerPosting[];
  createdAt: string;
}>;

type LedgerJournalDraft = Readonly<{
  eventType: string;
  currency: string;
  businessKey: string;
  postings: ReadonlyArray<{ account: string; direction: Direction; amount: bigint }>;
}>;

type IdempotencyRecord = {
  fingerprint: string;
  result: InferenceResult;
};

export type SandboxBillingRecord = Readonly<{
  inferenceId: string;
  quoteId: string;
  usageRecord: UsageRecord;
  ratingRecord: RatingRecord;
  billingStatus: "SETTLED";
  ledgerJournalIds: readonly string[];
  settledAt: string;
}>;

function timestamp(): string {
  return new Date().toISOString();
}

function identifier(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function requireText(value: unknown, field: string, maximum = 2_048): string {
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

function requireContentText(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value.trim().length === 0
  ) {
    throw new DomainError("INVALID_INPUT", `${field} is invalid`, { field });
  }
  return value;
}

function requireCurrency(value: unknown): string {
  const currency = requireText(value, "currency", 3);
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new DomainError("INVALID_MONEY", "currency must be a three-letter uppercase code");
  }
  return currency;
}

function decimalInteger(value: unknown, field: string, allowZero = true): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,29})$/.test(value)) {
    throw new DomainError("INVALID_MONEY", `${field} must be a decimal integer string`, { field });
  }
  const parsed = BigInt(value);
  if (!allowZero && parsed === 0n) {
    throw new DomainError("INVALID_MONEY", `${field} must be greater than zero`, { field });
  }
  return parsed;
}

function requireTokenCount(value: unknown, field: string): bigint {
  const count = decimalInteger(value, field, true);
  if (count > 10_000_000n) {
    throw new DomainError("INVALID_INPUT", `${field} exceeds the sandbox limit`, { field });
  }
  return count;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeVendor(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function cloneQuote(quote: QuoteInternal): Readonly<QuoteSnapshot> {
  const { ratingPolicyBinding: _ratingPolicyBinding, ...snapshot } = quote;
  return Object.freeze(snapshot);
}

export class SandboxMarketplace {
  private readonly suppliers = new Map<string, Supplier>();
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly prices: ModelPrice[] = [];
  private readonly buyers = new Map<string, BuyerInternal>();
  private readonly buyerIdByApiKeyHash = new Map<string, string>();
  private readonly quotes = new Map<string, QuoteInternal>();
  private readonly quoteRatingPolicies = new Map<string, RatingPolicySnapshot>();
  private readonly inferences = new Map<string, InferenceResult>();
  private readonly billingRecords = new Map<string, SandboxBillingRecord>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private journals: LedgerJournal[] = [];
  private journalBusinessKeys = new Set<string>();
  private accountNetCredits = new Map<string, bigint>();
  private readonly platformFeeBps: bigint;
  private readonly quoteLifetimeMs: number;

  constructor(options: { platformFeeBps?: string; quoteLifetimeMs?: number } = {}) {
    this.platformFeeBps = decimalInteger(options.platformFeeBps ?? "1000", "platformFeeBps", true);
    if (this.platformFeeBps > 10_000n) {
      throw new DomainError("INVALID_PRICE", "sandbox platform fee cannot exceed 10000 basis points");
    }
    const lifetime = options.quoteLifetimeMs ?? 5 * 60 * 1_000;
    if (!Number.isSafeInteger(lifetime) || lifetime < 1_000 || lifetime > 60 * 60 * 1_000) {
      throw new DomainError("INVALID_INPUT", "quoteLifetimeMs is invalid");
    }
    this.quoteLifetimeMs = lifetime;
  }

  async createSupplier(input: { name: string }): Promise<Supplier> {
    const supplier: Supplier = Object.freeze({
      supplierId: identifier("supplier"),
      name: requireText(input.name, "name", 256),
      kybStatus: "SANDBOX_FIXTURE",
      createdAt: timestamp(),
    });
    this.suppliers.set(supplier.supplierId, supplier);
    return supplier;
  }

  async registerEndpoint(input: {
    supplierId: string;
    url: string;
    declaredVendor?: string;
  }): Promise<Endpoint> {
    const supplierId = requireText(input.supplierId, "supplierId", 128);
    this.requireSupplier(supplierId);
    const rawUrl = requireText(input.url, "url", 2_048);
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new DomainError("INVALID_URL", "endpoint URL is invalid");
    }
    if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
      throw new DomainError(
        "UNSAFE_ENDPOINT",
        "credentials, query strings and fragments are not accepted in endpoint URLs",
      );
    }
    if (parsed.protocol === "mock:" && parsed.port !== "") {
      throw new DomainError("INVALID_URL", "mock endpoint URL contains unsupported components");
    }

    const declaredVendor = input.declaredVendor === undefined
      ? undefined
      : normalizeVendor(requireText(input.declaredVendor, "declaredVendor", 128));
    const mockVendors: Readonly<Record<string, string>> = Object.freeze({
      "acme-ai": "ACME_AI",
      "contoso-ai": "CONTOSO_AI",
    });
    const detectedVendor = parsed.protocol === "mock:" ? mockVendors[parsed.hostname.toLowerCase()] : undefined;
    const conflict = detectedVendor !== undefined
      && declaredVendor !== undefined
      && declaredVendor !== detectedVendor;
    const detectionStatus: DetectionStatus = conflict
      ? "CONFLICT"
      : detectedVendor === undefined ? "UNIDENTIFIED" : "VERIFIED_SANDBOX";

    const endpoint: Endpoint = Object.freeze({
      endpointId: identifier("endpoint"),
      supplierId,
      url: parsed.toString(),
      ...(declaredVendor === undefined ? {} : { declaredVendor }),
      ...(detectedVendor === undefined ? {} : { detectedVendor }),
      detectionStatus,
      evidenceStatus: "PENDING_REVIEW",
      sandboxRoutable: detectionStatus === "VERIFIED_SANDBOX",
      createdAt: timestamp(),
    });
    this.endpoints.set(endpoint.endpointId, endpoint);
    return endpoint;
  }

  async setModelPrice(input: {
    supplierId: string;
    endpointId: string;
    model: string;
    currency: string;
    inputTokenPriceMinor: string;
    outputTokenPriceMinor: string;
  }): Promise<ModelPrice> {
    const supplierId = requireText(input.supplierId, "supplierId", 128);
    this.requireSupplier(supplierId);
    const endpoint = this.requireEndpoint(requireText(input.endpointId, "endpointId", 128));
    if (endpoint.supplierId !== supplierId) {
      throw new DomainError("FORBIDDEN", "endpoint does not belong to supplier");
    }
    const model = requireText(input.model, "model", 256);
    const currency = requireCurrency(input.currency);
    const inputRate = decimalInteger(input.inputTokenPriceMinor, "inputTokenPriceMinor", true);
    const outputRate = decimalInteger(input.outputTokenPriceMinor, "outputTokenPriceMinor", true);
    if (inputRate === 0n && outputRate === 0n) {
      throw new DomainError("INVALID_PRICE", "at least one token price must be greater than zero");
    }
    const priorVersions = this.prices.filter((price) => (
      price.endpointId === endpoint.endpointId && price.model === model && price.currency === currency
    ));
    const version = String(priorVersions.length + 1);
    const price: ModelPrice = Object.freeze({
      priceId: identifier("price"),
      supplierId,
      endpointId: endpoint.endpointId,
      model,
      currency,
      inputTokenPriceMinor: inputRate.toString(),
      outputTokenPriceMinor: outputRate.toString(),
      version,
      effectiveAt: timestamp(),
    });
    this.prices.push(price);
    return price;
  }

  async createBuyer(input: {
    name: string;
    currency: string;
    initialBalanceMinor: string;
  }): Promise<Readonly<{ buyer: BuyerSnapshot; apiKey: string }>> {
    const buyerId = identifier("buyer");
    const currency = requireCurrency(input.currency);
    const initialBalance = decimalInteger(input.initialBalanceMinor, "initialBalanceMinor", true);
    const apiKey = `ct_sandbox_${randomBytes(24).toString("base64url")}`;
    const apiKeyHash = sha256(apiKey);
    const buyer: BuyerInternal = {
      buyerId,
      name: requireText(input.name, "name", 256),
      currency,
      apiKeyHash,
      createdAt: timestamp(),
    };
    this.buyers.set(buyerId, buyer);
    this.buyerIdByApiKeyHash.set(apiKeyHash, buyerId);
    if (initialBalance > 0n) {
      this.postJournal("SANDBOX_FUNDING", currency, `funding:${buyerId}`, [
        { account: "sandbox:cash", direction: "DEBIT", amount: initialBalance },
        { account: this.availableAccount(buyerId), direction: "CREDIT", amount: initialBalance },
      ]);
    }
    return Object.freeze({ buyer: this.buyerSnapshot(buyer), apiKey });
  }

  async createQuote(input: {
    apiKey: string;
    supplierId: string;
    endpointId: string;
    model: string;
    maxInputTokens: string;
    maxOutputTokens: string;
  }): Promise<Readonly<QuoteSnapshot>> {
    const buyer = this.authenticate(input.apiKey);
    const supplierId = requireText(input.supplierId, "supplierId", 128);
    this.requireSupplier(supplierId);
    const endpoint = this.requireEndpoint(requireText(input.endpointId, "endpointId", 128));
    if (endpoint.supplierId !== supplierId) {
      throw new DomainError("FORBIDDEN", "endpoint does not belong to supplier");
    }
    if (!endpoint.sandboxRoutable || endpoint.detectedVendor === undefined) {
      throw new DomainError("ENDPOINT_NOT_ROUTABLE", "endpoint remains open for review but is not sandbox routable");
    }
    const model = requireText(input.model, "model", 256);
    const price = this.latestPrice(endpoint.endpointId, model, buyer.currency);
    const maxInput = requireTokenCount(input.maxInputTokens, "maxInputTokens");
    const maxOutput = requireTokenCount(input.maxOutputTokens, "maxOutputTokens");
    if (maxInput === 0n && maxOutput === 0n) {
      throw new DomainError("INVALID_INPUT", "quote must allow some usage");
    }
    const ratingPolicy = createRatingPolicySnapshot({
      priceId: price.priceId,
      priceVersion: price.version,
      currency: price.currency,
      meterSchemaId: TOKEN_METER_SCHEMA_V1.meterSchemaId,
      meterSchemaVersion: TOKEN_METER_SCHEMA_V1.meterSchemaVersion,
      billingPolicyVersion: "sandbox-cost-plus-v1",
      roundingScope: "PER_USAGE_RECORD",
      platformFeeBps: this.platformFeeBps.toString(),
      platformFeeRoundingMode: "CEILING",
      rates: [
        {
          dimension: "INPUT_TOKENS",
          rateNumeratorMinor: price.inputTokenPriceMinor,
          rateDenominatorUnits: "1",
          roundingMode: "CEILING",
        },
        {
          dimension: "OUTPUT_TOKENS",
          rateNumeratorMinor: price.outputTokenPriceMinor,
          rateDenominatorUnits: "1",
          roundingMode: "CEILING",
        },
        {
          dimension: "CACHE_READ_TOKENS",
          rateNumeratorMinor: "0",
          rateDenominatorUnits: "1",
          roundingMode: "CEILING",
        },
        {
          dimension: "CACHE_WRITE_TOKENS",
          rateNumeratorMinor: "0",
          rateDenominatorUnits: "1",
          roundingMode: "CEILING",
        },
        {
          dimension: "TOOL_CALLS",
          rateNumeratorMinor: "0",
          rateDenominatorUnits: "1",
          roundingMode: "CEILING",
        },
        {
          dimension: "REQUESTS",
          rateNumeratorMinor: "0",
          rateDenominatorUnits: "1",
          roundingMode: "CEILING",
        },
      ],
    });
    const maximumBilling = calculateBilling({
      quantities: createMeterQuantities({
        INPUT_TOKENS: maxInput.toString(),
        OUTPUT_TOKENS: maxOutput.toString(),
        REQUESTS: "1",
      }),
      policy: ratingPolicy,
    });
    const supplierMaximum = BigInt(maximumBilling.supplierCostMinor);
    const platformMaximum = BigInt(maximumBilling.platformFeeMinor);
    const maximumHold = BigInt(maximumBilling.buyerChargeMinor);
    if (this.accountCreditBalance(buyer.currency, this.availableAccount(buyer.buyerId)) < maximumHold) {
      throw new DomainError("INSUFFICIENT_BALANCE", "sandbox buyer balance is insufficient");
    }
    const now = Date.now();
    const quote: QuoteInternal = {
      quoteId: identifier("quote"),
      buyerId: buyer.buyerId,
      supplierId,
      endpointId: endpoint.endpointId,
      detectedVendor: endpoint.detectedVendor,
      model,
      currency: price.currency,
      maxInputTokens: maxInput.toString(),
      maxOutputTokens: maxOutput.toString(),
      inputTokenPriceMinor: price.inputTokenPriceMinor,
      outputTokenPriceMinor: price.outputTokenPriceMinor,
      supplierMaxCostMinor: supplierMaximum.toString(),
      platformFeeBps: this.platformFeeBps.toString(),
      platformMaxFeeMinor: platformMaximum.toString(),
      maxHoldMinor: maximumHold.toString(),
      priceId: price.priceId,
      priceVersion: price.version,
      ratingPolicyBinding: Object.freeze({
        pricingDigest: ratingPolicy.pricingDigest,
        billingPolicyVersion: ratingPolicy.billingPolicyVersion,
        meterSchemaId: ratingPolicy.meterSchemaId,
        meterSchemaVersion: ratingPolicy.meterSchemaVersion,
      }),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.quoteLifetimeMs).toISOString(),
      status: "ISSUED",
    };
    this.quotes.set(quote.quoteId, quote);
    this.quoteRatingPolicies.set(quote.quoteId, ratingPolicy);
    return cloneQuote(quote);
  }

  async infer(input: {
    apiKey: string;
    quoteId: string;
    prompt: string;
    idempotencyKey: string;
  }): Promise<InferenceResult> {
    const buyer = this.authenticate(input.apiKey);
    const quoteId = requireText(input.quoteId, "quoteId", 128);
    const prompt = requireContentText(input.prompt, "prompt", 32 * 1_024);
    const replayKey = requireText(input.idempotencyKey, "idempotencyKey", 128);
    const fingerprint = sha256(JSON.stringify({ quoteId, prompt }));
    const idempotencyScope = `${buyer.buyerId}:${replayKey}`;
    const prior = this.idempotency.get(idempotencyScope);
    if (prior !== undefined) {
      if (prior.fingerprint !== fingerprint) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "idempotency key was already used for another request");
      }
      return prior.result;
    }

    const quote = this.quotes.get(quoteId);
    if (quote === undefined || quote.buyerId !== buyer.buyerId) {
      throw new DomainError("QUOTE_NOT_FOUND", "quote was not found");
    }
    if (quote.status !== "ISSUED") {
      throw new DomainError("QUOTE_ALREADY_USED", "quote has already been consumed");
    }
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      throw new DomainError("QUOTE_EXPIRED", "quote has expired");
    }
    const endpoint = this.requireEndpoint(quote.endpointId);
    if (!endpoint.sandboxRoutable || endpoint.detectedVendor !== quote.detectedVendor) {
      throw new DomainError("ENDPOINT_NOT_ROUTABLE", "endpoint is not sandbox routable");
    }

    const ratingPolicy = this.quoteRatingPolicies.get(quote.quoteId);
    if (ratingPolicy === undefined) {
      throw new DomainError("INVALID_PRICE", "quote rating policy snapshot was not found");
    }
    this.assertQuoteRatingPolicyBinding(quote, ratingPolicy);
    const inferenceId = identifier("inference");
    const meteredAt = timestamp();
    const metered = meterSandboxText({
      usageRecordId: identifier("usage"),
      inferenceId,
      quoteId: quote.quoteId,
      inputText: prompt,
      generatedOutput: `[sandbox ${quote.detectedVendor}/${quote.model}] synthetic inference completed`,
      maxInputTokens: quote.maxInputTokens,
      maxOutputTokens: quote.maxOutputTokens,
      createdAt: meteredAt,
    });
    const ratingRecord = createRatingRecord({
      ratingId: identifier("rating"),
      usageRecord: metered.usageRecord,
      policy: ratingPolicy,
      maximumChargeMinor: quote.maxHoldMinor,
      ratedAt: timestamp(),
    });
    const inputTokens = BigInt(metered.usageRecord.quantities.INPUT_TOKENS);
    const outputTokens = BigInt(metered.usageRecord.quantities.OUTPUT_TOKENS);
    const supplierCost = BigInt(ratingRecord.supplierCostMinor);
    const platformFee = BigInt(ratingRecord.platformFeeMinor);
    const buyerCharge = BigInt(ratingRecord.buyerChargeMinor);
    const maximumHold = BigInt(quote.maxHoldMinor);
    if (this.accountCreditBalance(quote.currency, this.availableAccount(buyer.buyerId)) < maximumHold) {
      throw new DomainError("INSUFFICIENT_BALANCE", "sandbox buyer balance changed before hold");
    }

    const journalDrafts: LedgerJournalDraft[] = [];
    if (maximumHold > 0n) {
      journalDrafts.push({
        eventType: "HOLD_PLACED",
        currency: quote.currency,
        businessKey: `hold:${quote.quoteId}`,
        postings: [
          { account: this.availableAccount(buyer.buyerId), direction: "DEBIT", amount: maximumHold },
          { account: this.reservedAccount(buyer.buyerId), direction: "CREDIT", amount: maximumHold },
        ],
      });
    }
    if (buyerCharge > 0n) {
      const settlementPostings: Array<{ account: string; direction: Direction; amount: bigint }> = [
        { account: this.reservedAccount(buyer.buyerId), direction: "DEBIT", amount: buyerCharge },
        { account: this.supplierPayableAccount(quote.supplierId), direction: "CREDIT", amount: supplierCost },
      ];
      if (platformFee > 0n) {
        settlementPostings.push({ account: "platform:fee-revenue", direction: "CREDIT", amount: platformFee });
      }
      journalDrafts.push({
        eventType: "INFERENCE_SETTLED",
        currency: quote.currency,
        businessKey: `settlement:${quote.quoteId}`,
        postings: settlementPostings,
      });
    }
    const releaseAmount = maximumHold - buyerCharge;
    if (releaseAmount > 0n) {
      journalDrafts.push({
        eventType: "HOLD_RELEASED",
        currency: quote.currency,
        businessKey: `release:${quote.quoteId}`,
        postings: [
          { account: this.reservedAccount(buyer.buyerId), direction: "DEBIT", amount: releaseAmount },
          { account: this.availableAccount(buyer.buyerId), direction: "CREDIT", amount: releaseAmount },
        ],
      });
    }
    const usage: Usage = Object.freeze({
      inputTokens: inputTokens.toString(),
      outputTokens: outputTokens.toString(),
      totalTokens: (inputTokens + outputTokens).toString(),
    });
    return this.commitInferenceAtomically({
      quote,
      inferenceId,
      idempotencyScope,
      fingerprint,
      usage,
      metered,
      ratingRecord,
      journalDrafts,
    });
  }

  async getState(): Promise<Readonly<Record<string, unknown>>> {
    const buyers = [...this.buyers.values()].map((buyer) => this.buyerSnapshot(buyer));
    const quotes = [...this.quotes.values()].map((quote) => cloneQuote(quote));
    const inferences = [...this.inferences.values()].map((result) => Object.freeze({
      inferenceId: result.inferenceId,
      quoteId: result.quoteId,
      supplierId: result.supplierId,
      endpointId: result.endpointId,
      vendor: result.vendor,
      model: result.model,
      usage: result.usage,
      currency: result.currency,
      buyerChargeMinor: result.buyerChargeMinor,
      createdAt: result.createdAt,
    }));
    return Object.freeze({
      sandbox: true,
      productionPaymentsEnabled: false,
      productionVendorRoutesEnabled: false,
      unknownVendorPolicy: "PENDING_REVIEW",
      suppliers: Object.freeze([...this.suppliers.values()]),
      endpoints: Object.freeze([...this.endpoints.values()]),
      prices: Object.freeze([...this.prices]),
      buyers: Object.freeze(buyers),
      quotes: Object.freeze(quotes),
      inferences: Object.freeze(inferences),
    });
  }

  async getLedger(): Promise<Readonly<{
    balanced: boolean;
    journals: readonly LedgerJournal[];
  }>> {
    const journals = this.journals.map((journal) => Object.freeze({
      ...journal,
      postings: Object.freeze(journal.postings.map((posting) => Object.freeze({ ...posting }))),
    }));
    return Object.freeze({ balanced: journals.every((journal) => this.isBalanced(journal)), journals });
  }

  async getBillingRecords(): Promise<Readonly<{
    sandbox: true;
    authoritativeProviderUsage: false;
    records: readonly SandboxBillingRecord[];
  }>> {
    return Object.freeze({
      sandbox: true,
      authoritativeProviderUsage: false,
      records: Object.freeze([...this.billingRecords.values()]),
    });
  }

  private assertQuoteRatingPolicyBinding(
    quote: QuoteInternal,
    policy: RatingPolicySnapshot,
  ): void {
    const inputRate = policy.rates.find((rate) => rate.dimension === "INPUT_TOKENS");
    const outputRate = policy.rates.find((rate) => rate.dimension === "OUTPUT_TOKENS");
    const binding = quote.ratingPolicyBinding;
    if (
      policy.pricingDigest !== binding.pricingDigest
      || policy.billingPolicyVersion !== binding.billingPolicyVersion
      || policy.meterSchemaId !== binding.meterSchemaId
      || policy.meterSchemaVersion !== binding.meterSchemaVersion
      || policy.priceId !== quote.priceId
      || policy.priceVersion !== quote.priceVersion
      || policy.currency !== quote.currency
      || policy.platformFeeBps !== quote.platformFeeBps
      || inputRate?.rateNumeratorMinor !== quote.inputTokenPriceMinor
      || inputRate?.rateDenominatorUnits !== "1"
      || outputRate?.rateNumeratorMinor !== quote.outputTokenPriceMinor
      || outputRate?.rateDenominatorUnits !== "1"
    ) {
      throw new DomainError(
        "RATING_POLICY_TAMPERED",
        "quote and rating policy binding does not match",
      );
    }
  }

  private commitInferenceAtomically(input: {
    quote: QuoteInternal;
    inferenceId: string;
    idempotencyScope: string;
    fingerprint: string;
    usage: Usage;
    metered: Readonly<{ deliveredOutput: string; usageRecord: UsageRecord }>;
    ratingRecord: RatingRecord;
    journalDrafts: readonly LedgerJournalDraft[];
  }): InferenceResult {
    const journalSnapshot = this.journals;
    const businessKeySnapshot = this.journalBusinessKeys;
    const balanceSnapshot = this.accountNetCredits;
    const quoteStatusSnapshot = input.quote.status;
    const inferenceSnapshot = this.inferences.get(input.inferenceId);
    const billingSnapshot = this.billingRecords.get(input.inferenceId);
    const idempotencySnapshot = this.idempotency.get(input.idempotencyScope);

    try {
      const journals = this.postJournalBatch(input.journalDrafts);
      const ledgerJournalIds = Object.freeze(journals.map((journal) => journal.journalId));
      const createdAt = timestamp();
      const result: InferenceResult = Object.freeze({
        sandbox: true,
        inferenceId: input.inferenceId,
        quoteId: input.quote.quoteId,
        supplierId: input.quote.supplierId,
        endpointId: input.quote.endpointId,
        vendor: input.quote.detectedVendor,
        model: input.quote.model,
        output: input.metered.deliveredOutput,
        usage: input.usage,
        currency: input.quote.currency,
        supplierCostMinor: input.ratingRecord.supplierCostMinor,
        platformFeeMinor: input.ratingRecord.platformFeeMinor,
        buyerChargeMinor: input.ratingRecord.buyerChargeMinor,
        ledgerJournalIds,
        createdAt,
      });
      const billingRecord: SandboxBillingRecord = Object.freeze({
        inferenceId: input.inferenceId,
        quoteId: input.quote.quoteId,
        usageRecord: input.metered.usageRecord,
        ratingRecord: input.ratingRecord,
        billingStatus: "SETTLED",
        ledgerJournalIds,
        settledAt: createdAt,
      });
      input.quote.status = "USED";
      this.inferences.set(result.inferenceId, result);
      this.billingRecords.set(result.inferenceId, billingRecord);
      this.idempotency.set(input.idempotencyScope, { fingerprint: input.fingerprint, result });
      return result;
    } catch (error: unknown) {
      this.journals = journalSnapshot;
      this.journalBusinessKeys = businessKeySnapshot;
      this.accountNetCredits = balanceSnapshot;
      input.quote.status = quoteStatusSnapshot;
      if (inferenceSnapshot === undefined) {
        this.inferences.delete(input.inferenceId);
      } else {
        this.inferences.set(input.inferenceId, inferenceSnapshot);
      }
      if (billingSnapshot === undefined) {
        this.billingRecords.delete(input.inferenceId);
      } else {
        this.billingRecords.set(input.inferenceId, billingSnapshot);
      }
      if (idempotencySnapshot === undefined) {
        this.idempotency.delete(input.idempotencyScope);
      } else {
        this.idempotency.set(input.idempotencyScope, idempotencySnapshot);
      }
      throw error;
    }
  }

  private authenticate(apiKey: string): BuyerInternal {
    const key = requireText(apiKey, "apiKey", 512);
    const buyerId = this.buyerIdByApiKeyHash.get(sha256(key));
    if (buyerId === undefined) {
      throw new DomainError("INVALID_API_KEY", "API key is invalid");
    }
    const buyer = this.buyers.get(buyerId);
    if (buyer === undefined) {
      throw new DomainError("INVALID_API_KEY", "API key is invalid");
    }
    return buyer;
  }

  private requireSupplier(supplierId: string): Supplier {
    const supplier = this.suppliers.get(supplierId);
    if (supplier === undefined) {
      throw new DomainError("SUPPLIER_NOT_FOUND", "supplier was not found");
    }
    return supplier;
  }

  private requireEndpoint(endpointId: string): Endpoint {
    const endpoint = this.endpoints.get(endpointId);
    if (endpoint === undefined) {
      throw new DomainError("ENDPOINT_NOT_FOUND", "endpoint was not found");
    }
    return endpoint;
  }

  private latestPrice(endpointId: string, model: string, currency: string): ModelPrice {
    const matching = this.prices.filter((price) => (
      price.endpointId === endpointId
      && price.model === model
      && price.currency === currency
    ));
    const price = matching.at(-1);
    if (price === undefined) {
      throw new DomainError("MODEL_PRICE_NOT_FOUND", "model price was not found");
    }
    return price;
  }

  private availableAccount(buyerId: string): string {
    return `buyer:${buyerId}:available`;
  }

  private reservedAccount(buyerId: string): string {
    return `buyer:${buyerId}:reserved`;
  }

  private supplierPayableAccount(supplierId: string): string {
    return `supplier:${supplierId}:payable`;
  }

  private accountKey(currency: string, account: string): string {
    return `${currency}:${account}`;
  }

  private accountCreditBalance(currency: string, account: string): bigint {
    return this.accountNetCredits.get(this.accountKey(currency, account)) ?? 0n;
  }

  private buyerSnapshot(buyer: BuyerInternal): BuyerSnapshot {
    return Object.freeze({
      buyerId: buyer.buyerId,
      name: buyer.name,
      currency: buyer.currency,
      availableBalanceMinor: this.accountCreditBalance(
        buyer.currency,
        this.availableAccount(buyer.buyerId),
      ).toString(),
      reservedBalanceMinor: this.accountCreditBalance(
        buyer.currency,
        this.reservedAccount(buyer.buyerId),
      ).toString(),
      createdAt: buyer.createdAt,
    });
  }

  private postJournal(
    eventType: string,
    currency: string,
    businessKey: string,
    postings: ReadonlyArray<{ account: string; direction: Direction; amount: bigint }>,
  ): LedgerJournal {
    const journal = this.postJournalBatch([{ eventType, currency, businessKey, postings }])[0];
    if (journal === undefined) {
      throw new DomainError("LEDGER_IMBALANCE", "ledger journal was not created");
    }
    return journal;
  }

  private postJournalBatch(drafts: readonly LedgerJournalDraft[]): readonly LedgerJournal[] {
    if (drafts.length === 0) {
      return Object.freeze([]);
    }
    const stagedBusinessKeys = new Set(this.journalBusinessKeys);
    const stagedBalances = new Map(this.accountNetCredits);
    const stagedJournals: LedgerJournal[] = [];

    for (const draft of drafts) {
      if (draft.postings.length < 2 || draft.postings.some((posting) => posting.amount <= 0n)) {
        throw new DomainError("INVALID_MONEY", "ledger journal postings are invalid");
      }
      const uniqueBusinessKey = this.accountKey(draft.currency, draft.businessKey);
      if (stagedBusinessKeys.has(uniqueBusinessKey)) {
        throw new DomainError("DUPLICATE_BUSINESS_EVENT", "ledger business key already exists");
      }
      const debit = draft.postings
        .filter((posting) => posting.direction === "DEBIT")
        .reduce((total, posting) => total + posting.amount, 0n);
      const credit = draft.postings
        .filter((posting) => posting.direction === "CREDIT")
        .reduce((total, posting) => total + posting.amount, 0n);
      if (debit !== credit) {
        throw new DomainError("LEDGER_IMBALANCE", "ledger journal is not balanced");
      }
      const journal: LedgerJournal = Object.freeze({
        journalId: identifier("journal"),
        eventType: draft.eventType,
        currency: draft.currency,
        businessKey: draft.businessKey,
        postings: Object.freeze(draft.postings.map((posting) => Object.freeze({
          account: posting.account,
          direction: posting.direction,
          amountMinor: posting.amount.toString(),
        }))),
        createdAt: timestamp(),
      });
      for (const posting of draft.postings) {
        const key = this.accountKey(draft.currency, posting.account);
        const current = stagedBalances.get(key) ?? 0n;
        stagedBalances.set(
          key,
          posting.direction === "CREDIT" ? current + posting.amount : current - posting.amount,
        );
      }
      stagedBusinessKeys.add(uniqueBusinessKey);
      stagedJournals.push(journal);
    }

    this.journals = [...this.journals, ...stagedJournals];
    this.journalBusinessKeys = stagedBusinessKeys;
    this.accountNetCredits = stagedBalances;
    return Object.freeze(stagedJournals);
  }

  private isBalanced(journal: LedgerJournal): boolean {
    let debit = 0n;
    let credit = 0n;
    for (const posting of journal.postings) {
      if (posting.direction === "DEBIT") {
        debit += BigInt(posting.amountMinor);
      } else {
        credit += BigInt(posting.amountMinor);
      }
    }
    return debit === credit;
  }
}
