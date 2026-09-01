import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  TOKEN_METER_SCHEMA_V1,
  HmacIntegrityKeyring,
  calculateBilling,
  createEphemeralHmacIntegrityKeyring,
  createMeterQuantities,
  createRatingPolicySnapshot,
  createRatingRecord,
  createUsageRecord,
  digestIntegrityContent,
  integritySealDigest,
  meterSandboxText,
  type IntegrityScope,
  type IntegrityAuthenticationCode,
  type IntegritySeal,
  type IntegrityStatement,
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
const SANDBOX_ENVIRONMENT_ID = "sandbox";
const SANDBOX_MARKET_ID = "market-neutral";

type SupplierSnapshot = Readonly<{
  supplierId: string;
  name: string;
  kybStatus: "SANDBOX_FIXTURE";
  createdAt: string;
}>;

type Supplier = SupplierSnapshot & Readonly<{ integritySeal: IntegritySeal }>;

type EndpointSnapshot = Readonly<{
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

type Endpoint = EndpointSnapshot & Readonly<{ integritySeal: IntegritySeal }>;

type ModelPriceSnapshot = Readonly<{
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

type ModelPrice = ModelPriceSnapshot & Readonly<{ integritySeal: IntegritySeal }>;

type BuyerInternal = {
  buyerId: string;
  name: string;
  currency: string;
  apiKeyHash: string;
  createdAt: string;
  integritySeal: IntegritySeal;
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
    priceSealDigest: string;
    integritySeal: IntegritySeal;
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
  idempotencyScope: string;
  inferenceId: string;
  settlementSealDigest: string;
  requestAuthentication: IntegrityAuthenticationCode;
};

type LedgerCheckpointRecord = Readonly<{
  currency: string;
  sequence: string;
  journalCount: string;
  ledgerStateDigest: string;
  createdAt: string;
  integritySeal: IntegritySeal;
}>;

export type SandboxBillingRecord = Readonly<{
  inferenceId: string;
  quoteId: string;
  usageRecord: UsageRecord;
  ratingRecord: RatingRecord;
  usageIntegritySeal: IntegritySeal;
  ratingIntegritySeal: IntegritySeal;
  settlementIntegritySeal: IntegritySeal;
  requestAuthentication: IntegrityAuthenticationCode;
  idempotencyScope: string;
  ledgerDigest: string;
  chainSequence: string;
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

function integrityViolation(): never {
  throw new DomainError("INTEGRITY_PROOF_INVALID", "authenticated integrity verification failed");
}

function normalizeVendor(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function cloneQuote(quote: QuoteInternal): Readonly<QuoteSnapshot> {
  const { ratingPolicyBinding: _ratingPolicyBinding, ...snapshot } = quote;
  return Object.freeze(snapshot);
}

function cloneEndpoint(endpoint: Endpoint): EndpointSnapshot {
  const { integritySeal: _integritySeal, ...snapshot } = endpoint;
  return Object.freeze(snapshot);
}

function cloneSupplier(supplier: Supplier): SupplierSnapshot {
  const { integritySeal: _integritySeal, ...snapshot } = supplier;
  return Object.freeze(snapshot);
}

function clonePrice(price: ModelPrice): ModelPriceSnapshot {
  const { integritySeal: _integritySeal, ...snapshot } = price;
  return Object.freeze(snapshot);
}

function hasOnlyDataProperties(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

function exactDataEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) {
    return true;
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (
      !Array.isArray(actual)
      || !Array.isArray(expected)
      || Object.getPrototypeOf(actual) !== Array.prototype
      || Object.getPrototypeOf(expected) !== Array.prototype
      || actual.length !== expected.length
    ) {
      return false;
    }
    const expectedOwnKeys = [
      ...Array.from({ length: actual.length }, (_value, index) => String(index)),
      "length",
    ];
    const actualOwnKeys = Reflect.ownKeys(actual);
    const referenceOwnKeys = Reflect.ownKeys(expected);
    if (
      !sameStringArray(actualOwnKeys.map(String).sort(), [...expectedOwnKeys].sort())
      || !sameStringArray(referenceOwnKeys.map(String).sort(), [...expectedOwnKeys].sort())
    ) {
      return false;
    }
    for (let index = 0; index < actual.length; index += 1) {
      const key = String(index);
      const actualDescriptor = Object.getOwnPropertyDescriptor(actual, key);
      const expectedDescriptor = Object.getOwnPropertyDescriptor(expected, key);
      if (
        actualDescriptor === undefined
        || expectedDescriptor === undefined
        || !("value" in actualDescriptor)
        || !("value" in expectedDescriptor)
        || !exactDataEqual(actualDescriptor.value, expectedDescriptor.value)
      ) {
        return false;
      }
    }
    return true;
  }
  if (
    typeof actual !== "object"
    || actual === null
    || typeof expected !== "object"
    || expected === null
    || !hasOnlyDataProperties(actual)
    || !hasOnlyDataProperties(expected)
  ) {
    return false;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return sameStringArray(actualKeys, expectedKeys)
    && actualKeys.every((key) => exactDataEqual(
      Object.getOwnPropertyDescriptor(actual, key)?.value,
      Object.getOwnPropertyDescriptor(expected, key)?.value,
    ));
}

function assertExactData(actual: unknown, expected: unknown): void {
  if (!exactDataEqual(actual, expected)) {
    integrityViolation();
  }
}

function assertExactKeys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !hasOnlyDataProperties(value)) {
    integrityViolation();
  }
  if (!sameStringArray(Object.keys(value).sort(), [...expected].sort())) {
    integrityViolation();
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function integrityScope(
  quote: Pick<QuoteInternal, "buyerId" | "supplierId" | "endpointId" | "quoteId" | "currency">,
  inferenceId: string | null,
): IntegrityScope {
  return Object.freeze({
    environmentId: SANDBOX_ENVIRONMENT_ID,
    marketId: SANDBOX_MARKET_ID,
    currency: quote.currency,
    buyerId: quote.buyerId,
    supplierId: quote.supplierId,
    endpointId: quote.endpointId,
    quoteId: quote.quoteId,
    inferenceId,
  });
}

function unboundIntegrityScope(input: {
  currency: string;
  supplierId?: string;
  endpointId?: string;
  subjectId: string;
}): IntegrityScope {
  return Object.freeze({
    environmentId: SANDBOX_ENVIRONMENT_ID,
    marketId: SANDBOX_MARKET_ID,
    currency: input.currency,
    buyerId: "unbound",
    supplierId: input.supplierId ?? "system",
    endpointId: input.endpointId ?? "system",
    quoteId: input.subjectId,
    inferenceId: null,
  });
}

function endpointContentDigest(endpoint: EndpointSnapshot): string {
  return digestIntegrityContent("PROVIDER_ENDPOINT_RECORD", [
    endpoint.endpointId,
    endpoint.supplierId,
    endpoint.url,
    endpoint.declaredVendor ?? "",
    endpoint.detectedVendor ?? "",
    endpoint.detectionStatus,
    endpoint.evidenceStatus,
    endpoint.sandboxRoutable ? "1" : "0",
    endpoint.createdAt,
  ]);
}

function supplierContentDigest(supplier: SupplierSnapshot): string {
  return digestIntegrityContent("SUPPLIER_ACCOUNT_RECORD", [
    supplier.supplierId,
    supplier.name,
    supplier.kybStatus,
    supplier.createdAt,
  ]);
}

function priceContentDigest(price: ModelPriceSnapshot): string {
  return digestIntegrityContent("SUPPLY_PRICE_RECORD", [
    price.priceId,
    price.supplierId,
    price.endpointId,
    price.model,
    price.currency,
    price.inputTokenPriceMinor,
    price.outputTokenPriceMinor,
    price.version,
    price.effectiveAt,
  ]);
}

function priceStreamId(price: Pick<ModelPriceSnapshot, "supplierId" | "endpointId" | "model" | "currency">): string {
  return `${price.supplierId}:${price.endpointId}:${price.model}:${price.currency}`;
}

function buyerContentDigest(buyer: Omit<BuyerInternal, "integritySeal">): string {
  return digestIntegrityContent("BUYER_ACCOUNT_RECORD", [
    buyer.buyerId,
    buyer.name,
    buyer.currency,
    buyer.apiKeyHash,
    buyer.createdAt,
  ]);
}

function buyerIntegrityScope(buyer: Pick<BuyerInternal, "buyerId" | "currency">): IntegrityScope {
  return Object.freeze({
    environmentId: SANDBOX_ENVIRONMENT_ID,
    marketId: SANDBOX_MARKET_ID,
    currency: buyer.currency,
    buyerId: buyer.buyerId,
    supplierId: "system",
    endpointId: "system",
    quoteId: `buyer:${buyer.buyerId}`,
    inferenceId: null,
  });
}

function quotePolicyContentDigest(
  quote: Omit<QuoteInternal, "ratingPolicyBinding" | "status">,
  policy: RatingPolicySnapshot,
): string {
  return digestIntegrityContent("QUOTE_POLICY_BINDING", [
    quote.quoteId,
    quote.buyerId,
    quote.supplierId,
    quote.endpointId,
    quote.detectedVendor,
    quote.model,
    quote.currency,
    quote.maxInputTokens,
    quote.maxOutputTokens,
    quote.inputTokenPriceMinor,
    quote.outputTokenPriceMinor,
    quote.supplierMaxCostMinor,
    quote.platformFeeBps,
    quote.platformMaxFeeMinor,
    quote.maxHoldMinor,
    quote.priceId,
    quote.priceVersion,
    quote.createdAt,
    quote.expiresAt,
    policy.pricingDigest,
    policy.billingPolicyVersion,
    policy.meterSchemaId,
    policy.meterSchemaVersion,
  ]);
}

function ledgerJournalBatchDigest(journals: readonly LedgerJournal[]): string {
  const parts: string[] = [journals.length.toString()];
  for (const journal of journals) {
    parts.push(
      journal.journalId,
      journal.eventType,
      journal.currency,
      journal.businessKey,
      journal.createdAt,
      journal.postings.length.toString(),
    );
    for (const posting of journal.postings) {
      parts.push(posting.account, posting.direction, posting.amountMinor);
    }
  }
  return digestIntegrityContent("LEDGER_JOURNAL_BATCH", parts);
}

function replayLedgerBalances(journals: readonly LedgerJournal[]): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  const journalIds = new Set<string>();
  const businessKeys = new Set<string>();
  for (const journal of journals) {
    assertExactKeys(journal, [
      "journalId",
      "eventType",
      "currency",
      "businessKey",
      "postings",
      "createdAt",
    ]);
    if (
      typeof journal.journalId !== "string"
      || typeof journal.eventType !== "string"
      || typeof journal.currency !== "string"
      || !/^[A-Z]{3}$/.test(journal.currency)
      || typeof journal.businessKey !== "string"
      || typeof journal.createdAt !== "string"
      || !Array.isArray(journal.postings)
      || journal.postings.length < 2
      || journalIds.has(journal.journalId)
    ) {
      integrityViolation();
    }
    const uniqueBusinessKey = `${journal.currency}:${journal.businessKey}`;
    if (businessKeys.has(uniqueBusinessKey)) {
      integrityViolation();
    }
    let debit = 0n;
    let credit = 0n;
    for (const posting of journal.postings) {
      assertExactKeys(posting, ["account", "direction", "amountMinor"]);
      if (
        typeof posting.account !== "string"
        || (posting.direction !== "DEBIT" && posting.direction !== "CREDIT")
        || typeof posting.amountMinor !== "string"
        || !/^[1-9]\d{0,29}$/.test(posting.amountMinor)
      ) {
        integrityViolation();
      }
      const amount = BigInt(posting.amountMinor);
      const accountKey = `${journal.currency}:${posting.account}`;
      const current = balances.get(accountKey) ?? 0n;
      balances.set(accountKey, posting.direction === "CREDIT" ? current + amount : current - amount);
      if (posting.direction === "DEBIT") {
        debit += amount;
      } else {
        credit += amount;
      }
    }
    if (debit !== credit) {
      integrityViolation();
    }
    journalIds.add(journal.journalId);
    businessKeys.add(uniqueBusinessKey);
  }
  return balances;
}

function ledgerStateContentDigest(
  currency: string,
  journals: readonly LedgerJournal[],
  balances: ReadonlyMap<string, bigint>,
): string {
  const currencyJournals = journals.filter((journal) => journal.currency === currency);
  const balanceParts = [...balances.entries()]
    .filter(([key]) => key.startsWith(`${currency}:`))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([key, value]) => [key, value.toString()]);
  return digestIntegrityContent("LEDGER_STATE_CHECKPOINT", [
    currency,
    ledgerJournalBatchDigest(currencyJournals),
    currencyJournals.length.toString(),
    (balanceParts.length / 2).toString(),
    ...balanceParts,
  ]);
}

function exactBalanceMapsEqual(left: ReadonlyMap<string, bigint>, right: ReadonlyMap<string, bigint>): boolean {
  return left.size === right.size
    && [...left].every(([key, value]) => right.get(key) === value);
}

function ledgerCheckpointScope(currency: string): IntegrityScope {
  return unboundIntegrityScope({ currency, subjectId: `ledger:${currency}` });
}

function settlementContentDigest(input: {
  inferenceId: string;
  quoteId: string;
  ratingRecord: RatingRecord;
  usageIntegritySeal: IntegritySeal;
  ratingIntegritySeal: IntegritySeal;
  ledgerDigest: string;
  ledgerJournalIds: readonly string[];
  settledAt: string;
  maximumHoldMinor: string;
  requestAuthentication: IntegrityAuthenticationCode;
  deliveredOutput: string;
  idempotencyScope: string;
}): string {
  return digestIntegrityContent("SETTLEMENT_BINDING", [
    input.inferenceId,
    input.quoteId,
    "SETTLED",
    input.ratingRecord.ratingDigest,
    integritySealDigest(input.usageIntegritySeal),
    integritySealDigest(input.ratingIntegritySeal),
    input.ratingRecord.currency,
    input.ratingRecord.supplierCostMinor,
    input.ratingRecord.platformFeeMinor,
    input.ratingRecord.buyerChargeMinor,
    input.maximumHoldMinor,
    input.requestAuthentication.scheme,
    input.requestAuthentication.keyId,
    input.requestAuthentication.authenticationTag,
    input.idempotencyScope,
    sha256(input.deliveredOutput),
    input.ledgerDigest,
    input.ledgerJournalIds.length.toString(),
    ...input.ledgerJournalIds,
    input.settledAt,
  ]);
}

export class SandboxMarketplace {
  private readonly suppliers = new Map<string, Supplier>();
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly prices: ModelPrice[] = [];
  private readonly priceChainHeads = new Map<string, Readonly<{ version: string; sealDigest: string }>>();
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
  private ledgerCheckpoints = new Map<string, readonly LedgerCheckpointRecord[]>();
  private billingChainHeads = new Map<string, Readonly<{ sequence: bigint; sealDigest: string }>>();
  private readonly platformFeeBps: bigint;
  private readonly quoteLifetimeMs: number;
  private readonly integrityKeyring: HmacIntegrityKeyring;
  private readonly platformPolicyAuthenticatedAt: string;
  private readonly platformPolicySeal: IntegritySeal;

  constructor(options: {
    platformFeeBps?: string;
    quoteLifetimeMs?: number;
    integrityKeyring?: HmacIntegrityKeyring;
  } = {}) {
    this.platformFeeBps = decimalInteger(options.platformFeeBps ?? "1000", "platformFeeBps", true);
    if (this.platformFeeBps > 10_000n) {
      throw new DomainError("INVALID_PRICE", "sandbox platform fee cannot exceed 10000 basis points");
    }
    const lifetime = options.quoteLifetimeMs ?? 5 * 60 * 1_000;
    if (!Number.isSafeInteger(lifetime) || lifetime < 1_000 || lifetime > 60 * 60 * 1_000) {
      throw new DomainError("INVALID_INPUT", "quoteLifetimeMs is invalid");
    }
    this.integrityKeyring = options.integrityKeyring ?? createEphemeralHmacIntegrityKeyring();
    this.quoteLifetimeMs = lifetime;
    this.platformPolicyAuthenticatedAt = timestamp();
    this.platformPolicySeal = this.integrityKeyring.seal({
      purpose: "PLATFORM_FEE_POLICY",
      scope: unboundIntegrityScope({
        currency: "XXX",
        subjectId: "platform-fee-policy-v1",
      }),
      subjectId: "platform-fee-policy-v1",
      contentDigest: digestIntegrityContent("PLATFORM_FEE_POLICY_RECORD", [
        "sandbox-cost-plus-v1",
        this.platformFeeBps.toString(),
        this.quoteLifetimeMs.toString(),
      ]),
      parentSealDigests: [],
      authenticatedAt: this.platformPolicyAuthenticatedAt,
      chain: null,
    });
  }

  async createSupplier(input: { name: string }): Promise<SupplierSnapshot> {
    this.verifyBillingIntegrity();
    const createdAt = timestamp();
    const supplierSnapshot: SupplierSnapshot = Object.freeze({
      supplierId: identifier("supplier"),
      name: requireText(input.name, "name", 256),
      kybStatus: "SANDBOX_FIXTURE",
      createdAt,
    });
    const integritySeal = this.integrityKeyring.seal({
      purpose: "SUPPLIER_ACCOUNT",
      scope: unboundIntegrityScope({
        currency: "XXX",
        supplierId: supplierSnapshot.supplierId,
        subjectId: supplierSnapshot.supplierId,
      }),
      subjectId: supplierSnapshot.supplierId,
      contentDigest: supplierContentDigest(supplierSnapshot),
      parentSealDigests: [],
      authenticatedAt: createdAt,
      chain: null,
    });
    const supplier: Supplier = Object.freeze({ ...supplierSnapshot, integritySeal });
    this.suppliers.set(supplier.supplierId, supplier);
    return supplierSnapshot;
  }

  async registerEndpoint(input: {
    supplierId: string;
    url: string;
    declaredVendor?: string;
  }): Promise<EndpointSnapshot> {
    this.verifyBillingIntegrity();
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

    const createdAt = timestamp();
    const endpointSnapshot: EndpointSnapshot = Object.freeze({
      endpointId: identifier("endpoint"),
      supplierId,
      url: parsed.toString(),
      ...(declaredVendor === undefined ? {} : { declaredVendor }),
      ...(detectedVendor === undefined ? {} : { detectedVendor }),
      detectionStatus,
      evidenceStatus: "PENDING_REVIEW",
      sandboxRoutable: detectionStatus === "VERIFIED_SANDBOX",
      createdAt,
    });
    const integritySeal = this.integrityKeyring.seal({
      purpose: "PROVIDER_ENDPOINT",
      scope: unboundIntegrityScope({
        currency: "XXX",
        supplierId,
        endpointId: endpointSnapshot.endpointId,
        subjectId: endpointSnapshot.endpointId,
      }),
      subjectId: endpointSnapshot.endpointId,
      contentDigest: endpointContentDigest(endpointSnapshot),
      parentSealDigests: [],
      authenticatedAt: createdAt,
      chain: null,
    });
    const endpoint: Endpoint = Object.freeze({ ...endpointSnapshot, integritySeal });
    this.endpoints.set(endpoint.endpointId, endpoint);
    return endpointSnapshot;
  }

  async setModelPrice(input: {
    supplierId: string;
    endpointId: string;
    model: string;
    currency: string;
    inputTokenPriceMinor: string;
    outputTokenPriceMinor: string;
  }): Promise<ModelPriceSnapshot> {
    this.verifyBillingIntegrity();
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
    const effectiveAt = timestamp();
    const priceSnapshot: ModelPriceSnapshot = Object.freeze({
      priceId: identifier("price"),
      supplierId,
      endpointId: endpoint.endpointId,
      model,
      currency,
      inputTokenPriceMinor: inputRate.toString(),
      outputTokenPriceMinor: outputRate.toString(),
      version,
      effectiveAt,
    });
    const previousPrice = priorVersions.at(-1);
    const integritySeal = this.integrityKeyring.seal({
      purpose: "SUPPLY_PRICE",
      scope: unboundIntegrityScope({
        currency,
        supplierId,
        endpointId: endpoint.endpointId,
        subjectId: priceSnapshot.priceId,
      }),
      subjectId: priceSnapshot.priceId,
      contentDigest: priceContentDigest(priceSnapshot),
      parentSealDigests: previousPrice === undefined
        ? []
        : [integritySealDigest(previousPrice.integritySeal)],
      authenticatedAt: effectiveAt,
      chain: null,
    });
    const price: ModelPrice = Object.freeze({ ...priceSnapshot, integritySeal });
    this.prices.push(price);
    this.priceChainHeads.set(priceStreamId(price), Object.freeze({
      version: price.version,
      sealDigest: integritySealDigest(price.integritySeal),
    }));
    return priceSnapshot;
  }

  async createBuyer(input: {
    name: string;
    currency: string;
    initialBalanceMinor: string;
  }): Promise<Readonly<{ buyer: BuyerSnapshot; apiKey: string }>> {
    this.verifyBillingIntegrity();
    const buyerId = identifier("buyer");
    const currency = requireCurrency(input.currency);
    const initialBalance = decimalInteger(input.initialBalanceMinor, "initialBalanceMinor", true);
    const apiKey = `ct_sandbox_${randomBytes(24).toString("base64url")}`;
    const apiKeyHash = sha256(apiKey);
    const createdAt = timestamp();
    const buyerTerms: Omit<BuyerInternal, "integritySeal"> = {
      buyerId,
      name: requireText(input.name, "name", 256),
      currency,
      apiKeyHash,
      createdAt,
    };
    const integritySeal = this.integrityKeyring.seal({
      purpose: "BUYER_ACCOUNT",
      scope: buyerIntegrityScope(buyerTerms),
      subjectId: buyerId,
      contentDigest: buyerContentDigest(buyerTerms),
      parentSealDigests: [],
      authenticatedAt: createdAt,
      chain: null,
    });
    const buyer: BuyerInternal = Object.freeze({ ...buyerTerms, integritySeal });
    if (initialBalance > 0n) {
      this.postJournal("SANDBOX_FUNDING", currency, `funding:${buyerId}`, [
        { account: "sandbox:cash", direction: "DEBIT", amount: initialBalance },
        { account: this.availableAccount(buyerId), direction: "CREDIT", amount: initialBalance },
      ]);
    }
    this.buyers.set(buyerId, buyer);
    this.buyerIdByApiKeyHash.set(apiKeyHash, buyerId);
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
    this.verifyBillingIntegrity();
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
    const quoteId = identifier("quote");
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.quoteLifetimeMs).toISOString();
    const quoteTerms: Omit<QuoteInternal, "ratingPolicyBinding" | "status"> = {
      quoteId,
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
      createdAt,
      expiresAt,
    };
    const quotePolicySeal = this.integrityKeyring.seal({
      purpose: "QUOTE_POLICY",
      scope: integrityScope(quoteTerms, null),
      subjectId: quoteId,
      contentDigest: quotePolicyContentDigest(quoteTerms, ratingPolicy),
      parentSealDigests: [integritySealDigest(price.integritySeal)],
      authenticatedAt: createdAt,
      chain: null,
    });
    const quote: QuoteInternal = {
      ...quoteTerms,
      ratingPolicyBinding: Object.freeze({
        pricingDigest: ratingPolicy.pricingDigest,
        billingPolicyVersion: ratingPolicy.billingPolicyVersion,
        meterSchemaId: ratingPolicy.meterSchemaId,
        meterSchemaVersion: ratingPolicy.meterSchemaVersion,
        priceSealDigest: integritySealDigest(price.integritySeal),
        integritySeal: quotePolicySeal,
      }),
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
    this.verifyBillingIntegrity();
    const buyer = this.authenticate(input.apiKey);
    const quoteId = requireText(input.quoteId, "quoteId", 128);
    const prompt = requireContentText(input.prompt, "prompt", 32 * 1_024);
    const replayKey = requireText(input.idempotencyKey, "idempotencyKey", 128);
    const idempotencyScope = `${buyer.buyerId}:${replayKey}`;
    const prior = this.idempotency.get(idempotencyScope);
    if (prior !== undefined) {
      try {
        this.integrityKeyring.assertAuthenticationCode(
          prior.requestAuthentication,
          "IDEMPOTENCY_REQUEST",
          [
            SANDBOX_ENVIRONMENT_ID,
            SANDBOX_MARKET_ID,
            buyer.buyerId,
            quoteId,
            replayKey,
            prompt,
          ],
        );
      } catch {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "idempotency key was already used for another request");
      }
      const replay = this.inferences.get(prior.inferenceId);
      if (replay === undefined) {
        integrityViolation();
      }
      return replay;
    }

    const quote = this.quotes.get(quoteId);
    if (quote === undefined || quote.quoteId !== quoteId || quote.buyerId !== buyer.buyerId) {
      throw new DomainError("QUOTE_NOT_FOUND", "quote was not found");
    }
    if (quote.status !== "ISSUED") {
      throw new DomainError("QUOTE_ALREADY_USED", "quote has already been consumed");
    }
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      throw new DomainError("QUOTE_EXPIRED", "quote has expired");
    }
    const ratingPolicy = this.quoteRatingPolicies.get(quote.quoteId);
    if (ratingPolicy === undefined) {
      throw new DomainError("INVALID_PRICE", "quote rating policy snapshot was not found");
    }
    this.assertQuoteRatingPolicyBinding(quote, ratingPolicy);
    const endpoint = this.requireEndpoint(quote.endpointId);
    if (!endpoint.sandboxRoutable || endpoint.detectedVendor !== quote.detectedVendor) {
      throw new DomainError("ENDPOINT_NOT_ROUTABLE", "endpoint is not sandbox routable");
    }
    const inferenceId = identifier("inference");
    const requestAuthentication = this.integrityKeyring.authenticate(
      "IDEMPOTENCY_REQUEST",
      [
        SANDBOX_ENVIRONMENT_ID,
        SANDBOX_MARKET_ID,
        buyer.buyerId,
        quoteId,
        replayKey,
        prompt,
      ],
    );
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
    const inferenceScope = integrityScope(quote, inferenceId);
    const usageStatement: IntegrityStatement = Object.freeze({
      purpose: "USAGE_RECORD",
      scope: inferenceScope,
      subjectId: metered.usageRecord.usageRecordId,
      contentDigest: metered.usageRecord.usageDigest,
      parentSealDigests: Object.freeze([
        integritySealDigest(quote.ratingPolicyBinding.integritySeal),
      ]),
      authenticatedAt: metered.usageRecord.createdAt,
      chain: null,
    });
    const usageIntegritySeal = this.integrityKeyring.seal(usageStatement);
    this.integrityKeyring.assertValid(usageIntegritySeal, usageStatement);
    const ratedAt = timestamp();
    const ratingRecord = createRatingRecord({
      ratingId: identifier("rating"),
      usageRecord: metered.usageRecord,
      policy: ratingPolicy,
      maximumChargeMinor: quote.maxHoldMinor,
      ratedAt,
    });
    const ratingStatement: IntegrityStatement = Object.freeze({
      purpose: "RATING_RECORD",
      scope: inferenceScope,
      subjectId: ratingRecord.ratingId,
      contentDigest: ratingRecord.ratingDigest,
      parentSealDigests: Object.freeze([integritySealDigest(usageIntegritySeal)]),
      authenticatedAt: ratingRecord.ratedAt,
      chain: null,
    });
    const ratingIntegritySeal = this.integrityKeyring.seal(ratingStatement);
    this.integrityKeyring.assertValid(ratingIntegritySeal, ratingStatement);
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
      requestAuthentication,
      usage,
      metered,
      ratingRecord,
      usageIntegritySeal,
      ratingIntegritySeal,
      journalDrafts,
    });
  }

  async getState(): Promise<Readonly<Record<string, unknown>>> {
    this.verifyBillingIntegrity();
    for (const quote of this.quotes.values()) {
      const policy = this.quoteRatingPolicies.get(quote.quoteId);
      if (policy === undefined) {
        integrityViolation();
      }
      this.assertQuoteRatingPolicyBinding(quote, policy);
    }
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
      suppliers: Object.freeze([...this.suppliers.values()].map(cloneSupplier)),
      endpoints: Object.freeze([...this.endpoints.values()].map(cloneEndpoint)),
      prices: Object.freeze(this.prices.map(clonePrice)),
      buyers: Object.freeze(buyers),
      quotes: Object.freeze(quotes),
      inferences: Object.freeze(inferences),
    });
  }

  async getLedger(): Promise<Readonly<{
    balanced: boolean;
    journals: readonly LedgerJournal[];
  }>> {
    this.verifyBillingIntegrity();
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
    this.verifyBillingIntegrity();
    return Object.freeze({
      sandbox: true,
      authoritativeProviderUsage: false,
      records: Object.freeze([...this.billingRecords.values()]),
    });
  }

  verifyBillingIntegrity(): Readonly<{
    valid: true;
    recordsVerified: number;
    chainStreamsVerified: number;
  }> {
    this.verifyCatalogIntegrity();
    this.verifyLedgerIntegrity();
    for (const [quoteKey, quote] of this.quotes) {
      assertExactKeys(quote, [
        "quoteId",
        "buyerId",
        "supplierId",
        "endpointId",
        "detectedVendor",
        "model",
        "currency",
        "maxInputTokens",
        "maxOutputTokens",
        "inputTokenPriceMinor",
        "outputTokenPriceMinor",
        "supplierMaxCostMinor",
        "platformFeeBps",
        "platformMaxFeeMinor",
        "maxHoldMinor",
        "priceId",
        "priceVersion",
        "ratingPolicyBinding",
        "createdAt",
        "expiresAt",
        "status",
      ]);
      const policy = this.quoteRatingPolicies.get(quote.quoteId);
      const buyer = this.buyers.get(quote.buyerId);
      const endpoint = this.endpoints.get(quote.endpointId);
      if (
        quoteKey !== quote.quoteId
        || policy === undefined
        || buyer === undefined
        || buyer.currency !== quote.currency
        || !this.suppliers.has(quote.supplierId)
        || endpoint === undefined
        || endpoint.supplierId !== quote.supplierId
        || endpoint.detectedVendor !== quote.detectedVendor
        || !endpoint.sandboxRoutable
        || (quote.status !== "ISSUED" && quote.status !== "USED")
      ) {
        integrityViolation();
      }
      this.assertQuoteRatingPolicyBinding(quote, policy);
    }
    if (
      this.quotes.size !== this.quoteRatingPolicies.size
      || [...this.quoteRatingPolicies.keys()].some((quoteId) => !this.quotes.has(quoteId))
    ) {
      integrityViolation();
    }

    const verifiedChainHeads = new Map<string, Readonly<{ sequence: bigint; sealDigest: string }>>();
    const usedJournalIds = new Set<string>();
    const usedQuoteIds = new Set<string>();
    const verifiedInferenceIds = new Set<string>();
    let recordsVerified = 0;

    for (const [recordKey, record] of this.billingRecords) {
      assertExactKeys(record, [
        "inferenceId",
        "quoteId",
        "usageRecord",
        "ratingRecord",
        "usageIntegritySeal",
        "ratingIntegritySeal",
        "settlementIntegritySeal",
        "requestAuthentication",
        "idempotencyScope",
        "ledgerDigest",
        "chainSequence",
        "billingStatus",
        "ledgerJournalIds",
        "settledAt",
      ]);
      const quote = this.quotes.get(record.quoteId);
      const policy = this.quoteRatingPolicies.get(record.quoteId);
      if (
        recordKey !== record.inferenceId
        || quote === undefined
        || policy === undefined
        || usedQuoteIds.has(record.quoteId)
        || record.inferenceId !== record.usageRecord.inferenceId
        || record.inferenceId !== record.ratingRecord.inferenceId
        || record.quoteId !== record.usageRecord.quoteId
        || record.quoteId !== record.ratingRecord.quoteId
        || record.billingStatus !== "SETTLED"
      ) {
        integrityViolation();
      }
      assertExactKeys(record.requestAuthentication, ["scheme", "keyId", "authenticationTag"]);
      this.assertQuoteRatingPolicyBinding(quote, policy);
      const scope = integrityScope(quote, record.inferenceId);
      const normalizedUsage = createUsageRecord({
        usageRecordId: record.usageRecord.usageRecordId,
        inferenceId: record.usageRecord.inferenceId,
        quoteId: record.usageRecord.quoteId,
        source: record.usageRecord.source,
        finality: record.usageRecord.finality,
        outcome: record.usageRecord.outcome,
        quantities: record.usageRecord.quantities,
        createdAt: record.usageRecord.createdAt,
      });
      assertExactData(record.usageRecord, normalizedUsage);
      const usageStatement: IntegrityStatement = Object.freeze({
        purpose: "USAGE_RECORD",
        scope,
        subjectId: normalizedUsage.usageRecordId,
        contentDigest: normalizedUsage.usageDigest,
        parentSealDigests: Object.freeze([
          integritySealDigest(quote.ratingPolicyBinding.integritySeal),
        ]),
        authenticatedAt: normalizedUsage.createdAt,
        chain: null,
      });
      this.integrityKeyring.assertValid(record.usageIntegritySeal, usageStatement);

      const normalizedRating = createRatingRecord({
        ratingId: record.ratingRecord.ratingId,
        usageRecord: normalizedUsage,
        policy,
        maximumChargeMinor: quote.maxHoldMinor,
        ratedAt: record.ratingRecord.ratedAt,
      });
      assertExactData(record.ratingRecord, normalizedRating);
      const ratingStatement: IntegrityStatement = Object.freeze({
        purpose: "RATING_RECORD",
        scope,
        subjectId: normalizedRating.ratingId,
        contentDigest: normalizedRating.ratingDigest,
        parentSealDigests: Object.freeze([integritySealDigest(record.usageIntegritySeal)]),
        authenticatedAt: normalizedRating.ratedAt,
        chain: null,
      });
      this.integrityKeyring.assertValid(record.ratingIntegritySeal, ratingStatement);

      const journals: LedgerJournal[] = [];
      for (const journalId of record.ledgerJournalIds) {
        if (usedJournalIds.has(journalId)) {
          integrityViolation();
        }
        const journal = this.journals.find((candidate) => candidate.journalId === journalId);
        if (journal === undefined) {
          integrityViolation();
        }
        usedJournalIds.add(journalId);
        journals.push(journal);
      }
      const ledgerDigest = ledgerJournalBatchDigest(journals);
      if (ledgerDigest !== record.ledgerDigest) {
        integrityViolation();
      }
      const inference = this.inferences.get(record.inferenceId);
      if (inference === undefined) {
        integrityViolation();
      }
      assertExactKeys(inference, [
        "sandbox",
        "inferenceId",
        "quoteId",
        "supplierId",
        "endpointId",
        "vendor",
        "model",
        "output",
        "usage",
        "currency",
        "supplierCostMinor",
        "platformFeeMinor",
        "buyerChargeMinor",
        "ledgerJournalIds",
        "createdAt",
      ]);
      if (typeof inference.output !== "string") {
        integrityViolation();
      }
      assertExactData(inference, Object.freeze({
        sandbox: true,
        inferenceId: record.inferenceId,
        quoteId: quote.quoteId,
        supplierId: quote.supplierId,
        endpointId: quote.endpointId,
        vendor: quote.detectedVendor,
        model: quote.model,
        output: inference.output,
        usage: Object.freeze({
          inputTokens: normalizedUsage.quantities.INPUT_TOKENS,
          outputTokens: normalizedUsage.quantities.OUTPUT_TOKENS,
          totalTokens: normalizedUsage.totalTokens,
        }),
        currency: quote.currency,
        supplierCostMinor: normalizedRating.supplierCostMinor,
        platformFeeMinor: normalizedRating.platformFeeMinor,
        buyerChargeMinor: normalizedRating.buyerChargeMinor,
        ledgerJournalIds: Object.freeze([...record.ledgerJournalIds]),
        createdAt: record.settledAt,
      }));
      const chainStreamId = `${SANDBOX_ENVIRONMENT_ID}:${SANDBOX_MARKET_ID}:${quote.currency}`;
      const previousChainHead = verifiedChainHeads.get(chainStreamId);
      const sequence = (previousChainHead?.sequence ?? 0n) + 1n;
      if (record.chainSequence !== sequence.toString()) {
        integrityViolation();
      }
      const settlementStatement: IntegrityStatement = Object.freeze({
        purpose: "SETTLEMENT_RECORD",
        scope,
        subjectId: `settlement:${record.inferenceId}`,
        contentDigest: settlementContentDigest({
          inferenceId: record.inferenceId,
          quoteId: record.quoteId,
          ratingRecord: normalizedRating,
          usageIntegritySeal: record.usageIntegritySeal,
          ratingIntegritySeal: record.ratingIntegritySeal,
          ledgerDigest,
          ledgerJournalIds: record.ledgerJournalIds,
          settledAt: record.settledAt,
          maximumHoldMinor: quote.maxHoldMinor,
          requestAuthentication: record.requestAuthentication,
          deliveredOutput: inference.output,
          idempotencyScope: record.idempotencyScope,
        }),
        parentSealDigests: Object.freeze([integritySealDigest(record.ratingIntegritySeal)]),
        authenticatedAt: record.settledAt,
        chain: Object.freeze({
          streamId: chainStreamId,
          sequence: sequence.toString(),
          previousSealDigest: previousChainHead?.sealDigest ?? null,
        }),
      });
      this.integrityKeyring.assertValid(record.settlementIntegritySeal, settlementStatement);
      verifiedChainHeads.set(chainStreamId, Object.freeze({
        sequence,
        sealDigest: integritySealDigest(record.settlementIntegritySeal),
      }));
      usedQuoteIds.add(record.quoteId);
      verifiedInferenceIds.add(record.inferenceId);
      recordsVerified += 1;
    }

    if (
      this.inferences.size !== this.billingRecords.size
      || this.idempotency.size !== this.billingRecords.size
      || verifiedInferenceIds.size !== this.inferences.size
    ) {
      integrityViolation();
    }
    const idempotencyInferenceIds = new Set<string>();
    for (const [idempotencyScope, record] of this.idempotency) {
      assertExactKeys(record, [
        "idempotencyScope",
        "inferenceId",
        "settlementSealDigest",
        "requestAuthentication",
      ]);
      const billingRecord = this.billingRecords.get(record.inferenceId);
      if (
        idempotencyScope !== record.idempotencyScope
        || idempotencyScope !== billingRecord?.idempotencyScope
        || billingRecord === undefined
        || idempotencyInferenceIds.has(record.inferenceId)
        || record.settlementSealDigest !== integritySealDigest(billingRecord.settlementIntegritySeal)
        || !exactDataEqual(record.requestAuthentication, billingRecord.requestAuthentication)
      ) {
        integrityViolation();
      }
      idempotencyInferenceIds.add(record.inferenceId);
    }
    for (const quote of this.quotes.values()) {
      const consumed = usedQuoteIds.has(quote.quoteId);
      if ((quote.status === "USED") !== consumed) {
        integrityViolation();
      }
    }

    if (verifiedChainHeads.size !== this.billingChainHeads.size) {
      integrityViolation();
    }
    for (const [streamId, expected] of verifiedChainHeads) {
      const actual = this.billingChainHeads.get(streamId);
      if (
        actual === undefined
        || actual.sequence !== expected.sequence
        || actual.sealDigest !== expected.sealDigest
      ) {
        integrityViolation();
      }
    }
    return Object.freeze({
      valid: true,
      recordsVerified,
      chainStreamsVerified: verifiedChainHeads.size,
    });
  }

  private verifyCatalogIntegrity(): void {
    this.integrityKeyring.assertValid(this.platformPolicySeal, {
      purpose: "PLATFORM_FEE_POLICY",
      scope: unboundIntegrityScope({
        currency: "XXX",
        subjectId: "platform-fee-policy-v1",
      }),
      subjectId: "platform-fee-policy-v1",
      contentDigest: digestIntegrityContent("PLATFORM_FEE_POLICY_RECORD", [
        "sandbox-cost-plus-v1",
        this.platformFeeBps.toString(),
        this.quoteLifetimeMs.toString(),
      ]),
      parentSealDigests: [],
      authenticatedAt: this.platformPolicyAuthenticatedAt,
      chain: null,
    });

    for (const [supplierId, supplier] of this.suppliers) {
      assertExactKeys(supplier, ["supplierId", "name", "kybStatus", "createdAt", "integritySeal"]);
      if (supplierId !== supplier.supplierId || supplier.kybStatus !== "SANDBOX_FIXTURE") {
        integrityViolation();
      }
      this.integrityKeyring.assertValid(supplier.integritySeal, {
        purpose: "SUPPLIER_ACCOUNT",
        scope: unboundIntegrityScope({
          currency: "XXX",
          supplierId: supplier.supplierId,
          subjectId: supplier.supplierId,
        }),
        subjectId: supplier.supplierId,
        contentDigest: supplierContentDigest(cloneSupplier(supplier)),
        parentSealDigests: [],
        authenticatedAt: supplier.createdAt,
        chain: null,
      });
    }

    if (this.buyers.size !== this.buyerIdByApiKeyHash.size) {
      integrityViolation();
    }
    for (const [buyerId, buyer] of this.buyers) {
      assertExactKeys(buyer, [
        "buyerId",
        "name",
        "currency",
        "apiKeyHash",
        "createdAt",
        "integritySeal",
      ]);
      if (
        buyerId !== buyer.buyerId
        || this.buyerIdByApiKeyHash.get(buyer.apiKeyHash) !== buyer.buyerId
      ) {
        integrityViolation();
      }
      const { integritySeal: _integritySeal, ...buyerTerms } = buyer;
      this.integrityKeyring.assertValid(buyer.integritySeal, {
        purpose: "BUYER_ACCOUNT",
        scope: buyerIntegrityScope(buyer),
        subjectId: buyer.buyerId,
        contentDigest: buyerContentDigest(buyerTerms),
        parentSealDigests: [],
        authenticatedAt: buyer.createdAt,
        chain: null,
      });
    }
    for (const [apiKeyHash, buyerId] of this.buyerIdByApiKeyHash) {
      const buyer = this.buyers.get(buyerId);
      if (buyer === undefined || buyer.apiKeyHash !== apiKeyHash) {
        integrityViolation();
      }
    }

    for (const [endpointId, endpoint] of this.endpoints) {
      assertExactKeys(endpoint, [
        "endpointId",
        "supplierId",
        "url",
        ...(Object.hasOwn(endpoint, "declaredVendor") ? ["declaredVendor"] : []),
        ...(Object.hasOwn(endpoint, "detectedVendor") ? ["detectedVendor"] : []),
        "detectionStatus",
        "evidenceStatus",
        "sandboxRoutable",
        "createdAt",
        "integritySeal",
      ]);
      if (endpointId !== endpoint.endpointId || !this.suppliers.has(endpoint.supplierId)) {
        integrityViolation();
      }
      const snapshot = cloneEndpoint(endpoint);
      this.integrityKeyring.assertValid(endpoint.integritySeal, {
        purpose: "PROVIDER_ENDPOINT",
        scope: unboundIntegrityScope({
          currency: "XXX",
          supplierId: endpoint.supplierId,
          endpointId: endpoint.endpointId,
          subjectId: endpoint.endpointId,
        }),
        subjectId: endpoint.endpointId,
        contentDigest: endpointContentDigest(snapshot),
        parentSealDigests: [],
        authenticatedAt: endpoint.createdAt,
        chain: null,
      });
    }

    const previousByPriceStream = new Map<string, ModelPrice>();
    for (const price of this.prices) {
      assertExactKeys(price, [
        "priceId",
        "supplierId",
        "endpointId",
        "model",
        "currency",
        "inputTokenPriceMinor",
        "outputTokenPriceMinor",
        "version",
        "effectiveAt",
        "integritySeal",
      ]);
      const endpoint = this.endpoints.get(price.endpointId);
      if (endpoint === undefined || endpoint.supplierId !== price.supplierId) {
        integrityViolation();
      }
      const streamId = priceStreamId(price);
      const previous = previousByPriceStream.get(streamId);
      if (price.version !== (previous === undefined ? "1" : (BigInt(previous.version) + 1n).toString())) {
        integrityViolation();
      }
      this.integrityKeyring.assertValid(price.integritySeal, {
        purpose: "SUPPLY_PRICE",
        scope: unboundIntegrityScope({
          currency: price.currency,
          supplierId: price.supplierId,
          endpointId: price.endpointId,
          subjectId: price.priceId,
        }),
        subjectId: price.priceId,
        contentDigest: priceContentDigest(clonePrice(price)),
        parentSealDigests: previous === undefined
          ? []
          : [integritySealDigest(previous.integritySeal)],
        authenticatedAt: price.effectiveAt,
        chain: null,
      });
      previousByPriceStream.set(streamId, price);
    }
    if (previousByPriceStream.size !== this.priceChainHeads.size) {
      integrityViolation();
    }
    for (const [streamId, price] of previousByPriceStream) {
      const head = this.priceChainHeads.get(streamId);
      if (head === undefined) {
        integrityViolation();
      }
      assertExactKeys(head, ["version", "sealDigest"]);
      if (head.version !== price.version || head.sealDigest !== integritySealDigest(price.integritySeal)) {
        integrityViolation();
      }
    }
  }

  private verifyLedgerIntegrity(): void {
    if (
      !(this.accountNetCredits instanceof Map)
      || !(this.journalBusinessKeys instanceof Set)
      || !(this.ledgerCheckpoints instanceof Map)
    ) {
      integrityViolation();
    }
    const replayedBalances = replayLedgerBalances(this.journals);
    if (!exactBalanceMapsEqual(replayedBalances, this.accountNetCredits)) {
      integrityViolation();
    }
    const expectedBusinessKeys = new Set(
      this.journals.map((journal) => `${journal.currency}:${journal.businessKey}`),
    );
    if (
      expectedBusinessKeys.size !== this.journalBusinessKeys.size
      || [...expectedBusinessKeys].some((key) => !this.journalBusinessKeys.has(key))
    ) {
      integrityViolation();
    }
    const journalsByCurrency = new Map<string, LedgerJournal[]>();
    for (const journal of this.journals) {
      if (journal.eventType === "SANDBOX_FUNDING") {
        const buyerId = journal.businessKey.startsWith("funding:")
          ? journal.businessKey.slice("funding:".length)
          : "";
        if (!this.buyers.has(buyerId)) {
          integrityViolation();
        }
      } else if (
        journal.eventType === "HOLD_PLACED"
        || journal.eventType === "INFERENCE_SETTLED"
        || journal.eventType === "HOLD_RELEASED"
      ) {
        const separator = journal.businessKey.indexOf(":");
        const quoteId = separator < 0 ? "" : journal.businessKey.slice(separator + 1);
        if (!this.quotes.has(quoteId)) {
          integrityViolation();
        }
      }
      const journals = journalsByCurrency.get(journal.currency) ?? [];
      journals.push(journal);
      journalsByCurrency.set(journal.currency, journals);
    }
    if (journalsByCurrency.size !== this.ledgerCheckpoints.size) {
      integrityViolation();
    }
    for (const [currency, journals] of journalsByCurrency) {
      const checkpoints = this.ledgerCheckpoints.get(currency);
      if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
        integrityViolation();
      }
      let previous: LedgerCheckpointRecord | undefined;
      let previousJournalCount = 0;
      for (const [index, checkpoint] of checkpoints.entries()) {
        assertExactKeys(checkpoint, [
          "currency",
          "sequence",
          "journalCount",
          "ledgerStateDigest",
          "createdAt",
          "integritySeal",
        ]);
        if (
          checkpoint.currency !== currency
          || checkpoint.sequence !== String(index + 1)
          || !/^[1-9]\d{0,29}$/.test(checkpoint.journalCount)
        ) {
          integrityViolation();
        }
        const journalCount = Number(checkpoint.journalCount);
        if (
          !Number.isSafeInteger(journalCount)
          || journalCount <= previousJournalCount
          || journalCount > journals.length
        ) {
          integrityViolation();
        }
        const prefix = journals.slice(0, journalCount);
        const prefixBalances = replayLedgerBalances(prefix);
        const ledgerStateDigest = ledgerStateContentDigest(currency, prefix, prefixBalances);
        if (checkpoint.ledgerStateDigest !== ledgerStateDigest) {
          integrityViolation();
        }
        this.integrityKeyring.assertValid(checkpoint.integritySeal, {
          purpose: "LEDGER_CHECKPOINT",
          scope: ledgerCheckpointScope(currency),
          subjectId: `ledger-checkpoint:${currency}:${index + 1}`,
          contentDigest: ledgerStateDigest,
          parentSealDigests: previous === undefined
            ? []
            : [integritySealDigest(previous.integritySeal)],
          authenticatedAt: checkpoint.createdAt,
          chain: Object.freeze({
            streamId: `${SANDBOX_ENVIRONMENT_ID}:${SANDBOX_MARKET_ID}:ledger:${currency}`,
            sequence: String(index + 1),
            previousSealDigest: previous === undefined
              ? null
              : integritySealDigest(previous.integritySeal),
          }),
        });
        previous = checkpoint;
        previousJournalCount = journalCount;
      }
      if (previousJournalCount !== journals.length) {
        integrityViolation();
      }
    }
  }

  private assertQuoteRatingPolicyBinding(
    quote: QuoteInternal,
    policy: RatingPolicySnapshot,
  ): void {
    const inputRate = policy.rates.find((rate) => rate.dimension === "INPUT_TOKENS");
    const outputRate = policy.rates.find((rate) => rate.dimension === "OUTPUT_TOKENS");
    const binding = quote.ratingPolicyBinding;
    assertExactKeys(binding, [
      "pricingDigest",
      "billingPolicyVersion",
      "meterSchemaId",
      "meterSchemaVersion",
      "priceSealDigest",
      "integritySeal",
    ]);
    const price = this.prices.find((candidate) => candidate.priceId === quote.priceId);
    if (
      price === undefined
      || policy.pricingDigest !== binding.pricingDigest
      || policy.billingPolicyVersion !== binding.billingPolicyVersion
      || policy.meterSchemaId !== binding.meterSchemaId
      || policy.meterSchemaVersion !== binding.meterSchemaVersion
      || policy.priceId !== quote.priceId
      || policy.priceVersion !== quote.priceVersion
      || policy.currency !== quote.currency
      || policy.platformFeeBps !== quote.platformFeeBps
      || price.supplierId !== quote.supplierId
      || price.endpointId !== quote.endpointId
      || price.model !== quote.model
      || price.currency !== quote.currency
      || price.version !== quote.priceVersion
      || price.inputTokenPriceMinor !== quote.inputTokenPriceMinor
      || price.outputTokenPriceMinor !== quote.outputTokenPriceMinor
      || integritySealDigest(price.integritySeal) !== binding.priceSealDigest
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
    const {
      ratingPolicyBinding: _ratingPolicyBinding,
      status: _status,
      ...quoteTerms
    } = quote;
    this.integrityKeyring.assertValid(binding.integritySeal, {
      purpose: "QUOTE_POLICY",
      scope: integrityScope(quote, null),
      subjectId: quote.quoteId,
      contentDigest: quotePolicyContentDigest(quoteTerms, policy),
      parentSealDigests: [binding.priceSealDigest],
      authenticatedAt: quote.createdAt,
      chain: null,
    });
  }

  private commitInferenceAtomically(input: {
    quote: QuoteInternal;
    inferenceId: string;
    idempotencyScope: string;
    requestAuthentication: IntegrityAuthenticationCode;
    usage: Usage;
    metered: Readonly<{ deliveredOutput: string; usageRecord: UsageRecord }>;
    ratingRecord: RatingRecord;
    usageIntegritySeal: IntegritySeal;
    ratingIntegritySeal: IntegritySeal;
    journalDrafts: readonly LedgerJournalDraft[];
  }): InferenceResult {
    const journalSnapshot = this.journals;
    const businessKeySnapshot = this.journalBusinessKeys;
    const balanceSnapshot = this.accountNetCredits;
    const ledgerCheckpointSnapshot = this.ledgerCheckpoints;
    const chainHeadSnapshot = this.billingChainHeads;
    const quoteStatusSnapshot = input.quote.status;
    const inferenceSnapshot = this.inferences.get(input.inferenceId);
    const billingSnapshot = this.billingRecords.get(input.inferenceId);
    const idempotencySnapshot = this.idempotency.get(input.idempotencyScope);

    try {
      const journals = this.postJournalBatch(input.journalDrafts);
      const ledgerJournalIds = Object.freeze(journals.map((journal) => journal.journalId));
      const createdAt = timestamp();
      const ledgerDigest = ledgerJournalBatchDigest(journals);
      const chainStreamId = `${SANDBOX_ENVIRONMENT_ID}:${SANDBOX_MARKET_ID}:${input.quote.currency}`;
      const previousChainHead = this.billingChainHeads.get(chainStreamId);
      const chainSequence = (previousChainHead?.sequence ?? 0n) + 1n;
      const settlementStatement: IntegrityStatement = Object.freeze({
        purpose: "SETTLEMENT_RECORD",
        scope: integrityScope(input.quote, input.inferenceId),
        subjectId: `settlement:${input.inferenceId}`,
        contentDigest: settlementContentDigest({
          inferenceId: input.inferenceId,
          quoteId: input.quote.quoteId,
          ratingRecord: input.ratingRecord,
          usageIntegritySeal: input.usageIntegritySeal,
          ratingIntegritySeal: input.ratingIntegritySeal,
          ledgerDigest,
          ledgerJournalIds,
          settledAt: createdAt,
          maximumHoldMinor: input.quote.maxHoldMinor,
          requestAuthentication: input.requestAuthentication,
          deliveredOutput: input.metered.deliveredOutput,
          idempotencyScope: input.idempotencyScope,
        }),
        parentSealDigests: Object.freeze([integritySealDigest(input.ratingIntegritySeal)]),
        authenticatedAt: createdAt,
        chain: Object.freeze({
          streamId: chainStreamId,
          sequence: chainSequence.toString(),
          previousSealDigest: previousChainHead?.sealDigest ?? null,
        }),
      });
      const settlementIntegritySeal = this.integrityKeyring.seal(settlementStatement);
      this.integrityKeyring.assertValid(settlementIntegritySeal, settlementStatement);
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
        usageIntegritySeal: input.usageIntegritySeal,
        ratingIntegritySeal: input.ratingIntegritySeal,
        settlementIntegritySeal,
        requestAuthentication: input.requestAuthentication,
        idempotencyScope: input.idempotencyScope,
        ledgerDigest,
        chainSequence: chainSequence.toString(),
        billingStatus: "SETTLED",
        ledgerJournalIds,
        settledAt: createdAt,
      });
      input.quote.status = "USED";
      this.inferences.set(result.inferenceId, result);
      this.billingRecords.set(result.inferenceId, billingRecord);
      this.idempotency.set(input.idempotencyScope, {
        idempotencyScope: input.idempotencyScope,
        inferenceId: result.inferenceId,
        settlementSealDigest: integritySealDigest(settlementIntegritySeal),
        requestAuthentication: input.requestAuthentication,
      });
      this.billingChainHeads = new Map(this.billingChainHeads).set(chainStreamId, Object.freeze({
        sequence: chainSequence,
        sealDigest: integritySealDigest(settlementIntegritySeal),
      }));
      return result;
    } catch (error: unknown) {
      this.journals = journalSnapshot;
      this.journalBusinessKeys = businessKeySnapshot;
      this.accountNetCredits = balanceSnapshot;
      this.ledgerCheckpoints = ledgerCheckpointSnapshot;
      this.billingChainHeads = chainHeadSnapshot;
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
    const stagedCheckpoints = new Map(this.ledgerCheckpoints);

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

    const allJournals = [...this.journals, ...stagedJournals];
    const affectedCurrencies = new Set(drafts.map((draft) => draft.currency));
    for (const currency of affectedCurrencies) {
      const priorCheckpoints = stagedCheckpoints.get(currency) ?? [];
      const previous = priorCheckpoints.at(-1);
      const sequence = BigInt(priorCheckpoints.length + 1);
      const currencyJournalCount = allJournals.filter((journal) => journal.currency === currency).length;
      const createdAt = timestamp();
      const ledgerStateDigest = ledgerStateContentDigest(currency, allJournals, stagedBalances);
      const statement: IntegrityStatement = Object.freeze({
        purpose: "LEDGER_CHECKPOINT",
        scope: ledgerCheckpointScope(currency),
        subjectId: `ledger-checkpoint:${currency}:${sequence}`,
        contentDigest: ledgerStateDigest,
        parentSealDigests: previous === undefined
          ? []
          : [integritySealDigest(previous.integritySeal)],
        authenticatedAt: createdAt,
        chain: Object.freeze({
          streamId: `${SANDBOX_ENVIRONMENT_ID}:${SANDBOX_MARKET_ID}:ledger:${currency}`,
          sequence: sequence.toString(),
          previousSealDigest: previous === undefined
            ? null
            : integritySealDigest(previous.integritySeal),
        }),
      });
      const integritySeal = this.integrityKeyring.seal(statement);
      this.integrityKeyring.assertValid(integritySeal, statement);
      const checkpoint: LedgerCheckpointRecord = Object.freeze({
        currency,
        sequence: sequence.toString(),
        journalCount: currencyJournalCount.toString(),
        ledgerStateDigest,
        createdAt,
        integritySeal,
      });
      stagedCheckpoints.set(currency, Object.freeze([...priorCheckpoints, checkpoint]));
    }

    this.journals = allJournals;
    this.journalBusinessKeys = stagedBusinessKeys;
    this.accountNetCredits = stagedBalances;
    this.ledgerCheckpoints = stagedCheckpoints;
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
