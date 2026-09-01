import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  DomainError,
  HmacIntegrityKeyring,
  SandboxMarketplace,
  createUsageRecord,
  type SandboxBillingRecord,
} from "../src/index.ts";

const OLD_TEST_KEY = Buffer.alloc(32, 0x33);
const NEW_TEST_KEY = Buffer.alloc(32, 0x44);

function testKeyring(): HmacIntegrityKeyring {
  return new HmacIntegrityKeyring({
    activeKeyId: "sandbox-test-old",
    keys: [
      { keyId: "sandbox-test-old", keyMaterial: OLD_TEST_KEY },
      { keyId: "sandbox-test-new", keyMaterial: NEW_TEST_KEY },
    ],
  });
}

async function configuredMarketplace(integrityKeyring = testKeyring()): Promise<{
  marketplace: SandboxMarketplace;
  integrityKeyring: HmacIntegrityKeyring;
  supplierId: string;
  endpointId: string;
  apiKey: string;
}> {
  const marketplace = new SandboxMarketplace({ integrityKeyring });
  const supplier = await marketplace.createSupplier({ name: "Integrity Supplier" });
  const endpoint = await marketplace.registerEndpoint({
    supplierId: supplier.supplierId,
    url: "mock://acme-ai",
    declaredVendor: "acme-ai",
  });
  await marketplace.setModelPrice({
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    model: "acme-chat-v1",
    currency: "USD",
    inputTokenPriceMinor: "2",
    outputTokenPriceMinor: "4",
  });
  const buyer = await marketplace.createBuyer({
    name: "Integrity Buyer",
    currency: "USD",
    initialBalanceMinor: "100000",
  });
  return {
    marketplace,
    integrityKeyring,
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    apiKey: buyer.apiKey,
  };
}

async function inferOnce(
  setup: Awaited<ReturnType<typeof configuredMarketplace>>,
  suffix: string,
): Promise<Readonly<{ inferenceId: string; quoteId: string }>> {
  const quote = await setup.marketplace.createQuote({
    apiKey: setup.apiKey,
    supplierId: setup.supplierId,
    endpointId: setup.endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "32",
    maxOutputTokens: "16",
  });
  const result = await setup.marketplace.infer({
    apiKey: setup.apiKey,
    quoteId: quote.quoteId,
    prompt: `integrity request ${suffix}`,
    idempotencyKey: `integrity-${suffix}`,
  });
  return Object.freeze({ inferenceId: result.inferenceId, quoteId: quote.quoteId });
}

function isIntegrityFailure(error: unknown): boolean {
  return error instanceof DomainError && error.code === "INTEGRITY_PROOF_INVALID";
}

function privateBillingRecords(marketplace: SandboxMarketplace): Map<string, SandboxBillingRecord> {
  return Reflect.get(marketplace, "billingRecords") as Map<string, SandboxBillingRecord>;
}

test("quote, usage, rating, ledger and settlement are sealed without leaking key material", async () => {
  const setup = await configuredMarketplace();
  await inferOnce(setup, "complete");
  const report = setup.marketplace.verifyBillingIntegrity();
  assert.deepEqual(report, { valid: true, recordsVerified: 1, chainStreamsVerified: 1 });
  const billing = await setup.marketplace.getBillingRecords();
  const record = billing.records[0];
  assert.ok(record !== undefined);
  assert.equal(record.usageIntegritySeal.purpose, "USAGE_RECORD");
  assert.equal(record.ratingIntegritySeal.purpose, "RATING_RECORD");
  assert.equal(record.settlementIntegritySeal.purpose, "SETTLEMENT_RECORD");
  assert.equal(record.chainSequence, "1");
  assert.match(record.ledgerDigest, /^[a-f0-9]{64}$/);
  const stateText = JSON.stringify(await setup.marketplace.getState());
  const billingText = JSON.stringify(billing);
  for (const secret of [OLD_TEST_KEY.toString("hex"), OLD_TEST_KEY.toString("base64url")]) {
    assert.doesNotMatch(stateText, new RegExp(secret, "i"));
    assert.doesNotMatch(billingText, new RegExp(secret, "i"));
  }
  assert.doesNotMatch(stateText, /authenticationTag|integritySeal|keyId/i);
});

test("recomputed public usage digest cannot bypass the authenticated seal", async () => {
  const setup = await configuredMarketplace();
  const completed = await inferOnce(setup, "usage-tamper");
  const records = privateBillingRecords(setup.marketplace);
  const original = records.get(completed.inferenceId);
  assert.ok(original !== undefined);
  const tamperedUsage = createUsageRecord({
    usageRecordId: original.usageRecord.usageRecordId,
    inferenceId: original.usageRecord.inferenceId,
    quoteId: original.usageRecord.quoteId,
    source: original.usageRecord.source,
    finality: original.usageRecord.finality,
    outcome: original.usageRecord.outcome,
    quantities: {
      ...original.usageRecord.quantities,
      INPUT_TOKENS: (BigInt(original.usageRecord.quantities.INPUT_TOKENS) + 1n).toString(),
    },
    createdAt: original.usageRecord.createdAt,
  });
  assert.notEqual(tamperedUsage.usageDigest, original.usageRecord.usageDigest);
  records.set(completed.inferenceId, Object.freeze({ ...original, usageRecord: tamperedUsage }));
  assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
  await assert.rejects(setup.marketplace.getBillingRecords(), isIntegrityFailure);
});

test("full ledger-content sealing detects balanced journal rewrites", async () => {
  const setup = await configuredMarketplace();
  const completed = await inferOnce(setup, "ledger-tamper");
  const records = privateBillingRecords(setup.marketplace);
  const record = records.get(completed.inferenceId);
  assert.ok(record !== undefined);
  const journals = Reflect.get(setup.marketplace, "journals") as Array<{
    journalId: string;
    eventType: string;
    currency: string;
    businessKey: string;
    postings: readonly { account: string; direction: "DEBIT" | "CREDIT"; amountMinor: string }[];
    createdAt: string;
  }>;
  const settlementIndex = journals.findIndex((journal) => journal.eventType === "INFERENCE_SETTLED");
  assert.ok(settlementIndex >= 0);
  const settlement = journals[settlementIndex];
  assert.ok(settlement !== undefined);
  const postings = settlement.postings.map((posting, index) => Object.freeze({
    ...posting,
    amountMinor: index < 2 ? (BigInt(posting.amountMinor) + 1n).toString() : posting.amountMinor,
  }));
  journals[settlementIndex] = Object.freeze({ ...settlement, postings: Object.freeze(postings) });
  assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
});

test("a valid seal cannot be transplanted across buyers and quotes sharing the same key", async () => {
  const sharedKeyring = testKeyring();
  const first = await configuredMarketplace(sharedKeyring);
  const second = await configuredMarketplace(sharedKeyring);
  const firstResult = await inferOnce(first, "first-context");
  const secondResult = await inferOnce(second, "second-context");
  const firstRecord = privateBillingRecords(first.marketplace).get(firstResult.inferenceId);
  const secondRecords = privateBillingRecords(second.marketplace);
  const secondRecord = secondRecords.get(secondResult.inferenceId);
  assert.ok(firstRecord !== undefined && secondRecord !== undefined);
  secondRecords.set(secondResult.inferenceId, Object.freeze({
    ...secondRecord,
    usageIntegritySeal: firstRecord.usageIntegritySeal,
  }));
  assert.throws(() => second.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
});

test("billing chain detects middle deletion, tail deletion and reordering", async () => {
  const setup = await configuredMarketplace();
  await inferOnce(setup, "chain-one");
  await inferOnce(setup, "chain-two");
  const records = privateBillingRecords(setup.marketplace);
  const entries = [...records.entries()];
  assert.equal(entries.length, 2);

  Reflect.set(setup.marketplace, "billingRecords", new Map(entries.slice(1)));
  assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);

  Reflect.set(setup.marketplace, "billingRecords", new Map(entries.slice(0, 1)));
  assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);

  Reflect.set(setup.marketplace, "billingRecords", new Map(entries.reverse()));
  assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);

  Reflect.set(setup.marketplace, "billingRecords", new Map(entries.reverse()));
  assert.deepEqual(
    setup.marketplace.verifyBillingIntegrity(),
    { valid: true, recordsVerified: 2, chainStreamsVerified: 1 },
  );
});

test("key rotation preserves old records and signs new records with the active key", async () => {
  const setup = await configuredMarketplace();
  const first = await inferOnce(setup, "before-rotation");
  setup.integrityKeyring.rotateActiveKey("sandbox-test-new");
  const second = await inferOnce(setup, "after-rotation");
  const records = privateBillingRecords(setup.marketplace);
  assert.equal(records.get(first.inferenceId)?.settlementIntegritySeal.keyId, "sandbox-test-old");
  assert.equal(records.get(second.inferenceId)?.settlementIntegritySeal.keyId, "sandbox-test-new");
  assert.deepEqual(
    setup.marketplace.verifyBillingIntegrity(),
    { valid: true, recordsVerified: 2, chainStreamsVerified: 1 },
  );
});

test("quote-term tampering fails before metering or financial mutation", async () => {
  const setup = await configuredMarketplace();
  const quote = await setup.marketplace.createQuote({
    apiKey: setup.apiKey,
    supplierId: setup.supplierId,
    endpointId: setup.endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "32",
    maxOutputTokens: "16",
  });
  const quotes = Reflect.get(setup.marketplace, "quotes") as Map<string, Record<string, unknown>>;
  const original = quotes.get(quote.quoteId);
  assert.ok(original !== undefined);
  quotes.set(quote.quoteId, { ...original, maxHoldMinor: "1" });
  const journalCountBefore = (Reflect.get(setup.marketplace, "journals") as unknown[]).length;
  await assert.rejects(
    setup.marketplace.infer({
      apiKey: setup.apiKey,
      quoteId: quote.quoteId,
      prompt: "must fail before metering",
      idempotencyKey: "quote-term-tamper",
    }),
    isIntegrityFailure,
  );
  assert.equal((Reflect.get(setup.marketplace, "journals") as unknown[]).length, journalCountBefore);
  assert.equal(privateBillingRecords(setup.marketplace).size, 0);
});

test("settlement sealing failure rolls back journals, balances, quote state and indexes", async () => {
  const setup = await configuredMarketplace();
  const quote = await setup.marketplace.createQuote({
    apiKey: setup.apiKey,
    supplierId: setup.supplierId,
    endpointId: setup.endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "32",
    maxOutputTokens: "16",
  });
  const originalSeal = setup.integrityKeyring.seal.bind(setup.integrityKeyring);
  let failOnce = true;
  Reflect.set(setup.integrityKeyring, "seal", (value: Parameters<HmacIntegrityKeyring["seal"]>[0]) => {
    if (failOnce && value.purpose === "SETTLEMENT_RECORD") {
      failOnce = false;
      throw new Error("simulated settlement-seal outage");
    }
    return originalSeal(value);
  });
  const journalsBefore = JSON.stringify(Reflect.get(setup.marketplace, "journals"));
  const balancesBefore = [...(Reflect.get(setup.marketplace, "accountNetCredits") as Map<string, bigint>)]
    .map(([account, amount]) => [account, amount.toString()]);
  const request = {
    apiKey: setup.apiKey,
    quoteId: quote.quoteId,
    prompt: "retry after integrity service recovery",
    idempotencyKey: "integrity-seal-retry",
  };

  await assert.rejects(setup.marketplace.infer(request), /simulated settlement-seal outage/);
  assert.equal(JSON.stringify(Reflect.get(setup.marketplace, "journals")), journalsBefore);
  assert.deepEqual(
    [...(Reflect.get(setup.marketplace, "accountNetCredits") as Map<string, bigint>)]
      .map(([account, amount]) => [account, amount.toString()]),
    balancesBefore,
  );
  assert.equal(privateBillingRecords(setup.marketplace).size, 0);
  const failedState = await setup.marketplace.getState();
  const failedQuotes = failedState.quotes as readonly Array<{ quoteId: string; status: string }>;
  assert.equal(failedQuotes.find((candidate) => candidate.quoteId === quote.quoteId)?.status, "ISSUED");

  const retried = await setup.marketplace.infer(request);
  assert.ok(retried.ledgerJournalIds.length >= 2);
  assert.deepEqual(
    setup.marketplace.verifyBillingIntegrity(),
    { valid: true, recordsVerified: 1, chainStreamsVerified: 1 },
  );
});

test("tampered inference usage views are rejected before state or ledger reads", async () => {
  const setup = await configuredMarketplace();
  const completed = await inferOnce(setup, "inference-view-tamper");
  const inferences = Reflect.get(setup.marketplace, "inferences") as Map<string, Record<string, unknown>>;
  const original = inferences.get(completed.inferenceId);
  assert.ok(original !== undefined);
  const usage = original.usage as { inputTokens: string; outputTokens: string; totalTokens: string };
  inferences.set(completed.inferenceId, {
    ...original,
    usage: { ...usage, inputTokens: (BigInt(usage.inputTokens) + 1n).toString() },
  });
  assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
  await assert.rejects(setup.marketplace.getState(), isIntegrityFailure);
  await assert.rejects(setup.marketplace.getLedger(), isIntegrityFailure);
});

test("rating derived fields and injected audit fields are rejected exactly", async () => {
  const setup = await configuredMarketplace();
  const completed = await inferOnce(setup, "rating-derived-tamper");
  const records = privateBillingRecords(setup.marketplace);
  const original = records.get(completed.inferenceId);
  assert.ok(original !== undefined);
  records.set(completed.inferenceId, {
    ...original,
    ratingRecord: {
      ...original.ratingRecord,
      buyerChargeMinor: "0",
      injectedAuditDecision: "APPROVED",
    } as never,
  });
  assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
});

test("ledger checkpoints reject forged journals, funding rewrites and materialized balance edits", async () => {
  const forged = await configuredMarketplace();
  const forgedJournals = Reflect.get(forged.marketplace, "journals") as Array<Record<string, unknown>>;
  const funding = forgedJournals[0];
  assert.ok(funding !== undefined);
  forgedJournals.push({
    ...funding,
    journalId: "journal_forged",
    businessKey: "forged:balanced",
  });
  assert.throws(() => forged.marketplace.verifyBillingIntegrity(), isIntegrityFailure);

  const rewritten = await configuredMarketplace();
  const rewrittenJournals = Reflect.get(rewritten.marketplace, "journals") as Array<Record<string, unknown>>;
  const originalFunding = rewrittenJournals[0];
  assert.ok(originalFunding !== undefined);
  const postings = originalFunding.postings as readonly Array<Record<string, unknown>>;
  rewrittenJournals[0] = {
    ...originalFunding,
    postings: postings.map((posting) => ({
      ...posting,
      amountMinor: (BigInt(String(posting.amountMinor)) + 1n).toString(),
    })),
  };
  assert.throws(() => rewritten.marketplace.verifyBillingIntegrity(), isIntegrityFailure);

  const balanceEdited = await configuredMarketplace();
  const balances = Reflect.get(balanceEdited.marketplace, "accountNetCredits") as Map<string, bigint>;
  const [firstAccount] = balances.keys();
  assert.ok(firstAccount !== undefined);
  balances.set(firstAccount, (balances.get(firstAccount) ?? 0n) + 1n);
  assert.throws(() => balanceEdited.marketplace.verifyBillingIntegrity(), isIntegrityFailure);

  const reordered = await configuredMarketplace();
  const originalBalances = Reflect.get(reordered.marketplace, "accountNetCredits") as Map<string, bigint>;
  Reflect.set(reordered.marketplace, "accountNetCredits", new Map([...originalBalances].reverse()));
  assert.deepEqual(
    reordered.marketplace.verifyBillingIntegrity(),
    { valid: true, recordsVerified: 0, chainStreamsVerified: 0 },
  );
});

test("detected historical tampering blocks all new billing mutations", async () => {
  const setup = await configuredMarketplace();
  const completed = await inferOnce(setup, "historical-tamper");
  const records = privateBillingRecords(setup.marketplace);
  const original = records.get(completed.inferenceId);
  assert.ok(original !== undefined);
  records.set(completed.inferenceId, {
    ...original,
    usageRecord: {
      ...original.usageRecord,
      totalTokens: (BigInt(original.usageRecord.totalTokens) + 1n).toString(),
    },
  } as SandboxBillingRecord);
  const journalCount = (Reflect.get(setup.marketplace, "journals") as unknown[]).length;
  await assert.rejects(
    setup.marketplace.createQuote({
      apiKey: setup.apiKey,
      supplierId: setup.supplierId,
      endpointId: setup.endpointId,
      model: "acme-chat-v1",
      maxInputTokens: "8",
      maxOutputTokens: "8",
    }),
    isIntegrityFailure,
  );
  assert.equal((Reflect.get(setup.marketplace, "journals") as unknown[]).length, journalCount);
});

test("idempotency replay is rebuilt from authenticated canonical state", async () => {
  const setup = await configuredMarketplace();
  const completed = await inferOnce(setup, "idempotency-cache");
  const idempotency = Reflect.get(setup.marketplace, "idempotency") as Map<string, Record<string, unknown>>;
  const entry = [...idempotency.entries()][0];
  assert.ok(entry !== undefined);
  const [key, record] = entry;
  assert.equal(Object.hasOwn(record, "result"), false);
  assert.equal(Object.hasOwn(record, "fingerprint"), false);
  idempotency.set(key, { ...record, settlementSealDigest: "0".repeat(64) });
  await assert.rejects(
    setup.marketplace.infer({
      apiKey: setup.apiKey,
      quoteId: completed.quoteId,
      prompt: "integrity request idempotency-cache",
      idempotencyKey: "integrity-idempotency-cache",
    }),
    isIntegrityFailure,
  );
});

test("a consumed quote cannot be reopened by changing its mutable status", async () => {
  const setup = await configuredMarketplace();
  const completed = await inferOnce(setup, "quote-consumption");
  const quotes = Reflect.get(setup.marketplace, "quotes") as Map<string, Record<string, unknown>>;
  const original = quotes.get(completed.quoteId);
  assert.ok(original !== undefined);
  quotes.set(completed.quoteId, { ...original, status: "ISSUED" });
  const journalCount = (Reflect.get(setup.marketplace, "journals") as unknown[]).length;
  await assert.rejects(
    setup.marketplace.infer({
      apiKey: setup.apiKey,
      quoteId: completed.quoteId,
      prompt: "second consumption must fail",
      idempotencyKey: "second-consumption",
    }),
    isIntegrityFailure,
  );
  assert.equal((Reflect.get(setup.marketplace, "journals") as unknown[]).length, journalCount);
});

test("provider identity and supply price edits cannot be washed into a new signed quote", async () => {
  const priceSetup = await configuredMarketplace();
  const prices = Reflect.get(priceSetup.marketplace, "prices") as Array<Record<string, unknown>>;
  const originalPrice = prices[0];
  assert.ok(originalPrice !== undefined);
  prices[0] = { ...originalPrice, inputTokenPriceMinor: "999" };
  await assert.rejects(
    priceSetup.marketplace.createQuote({
      apiKey: priceSetup.apiKey,
      supplierId: priceSetup.supplierId,
      endpointId: priceSetup.endpointId,
      model: "acme-chat-v1",
      maxInputTokens: "8",
      maxOutputTokens: "8",
    }),
    isIntegrityFailure,
  );

  const endpointSetup = await configuredMarketplace();
  const endpoints = Reflect.get(endpointSetup.marketplace, "endpoints") as Map<string, Record<string, unknown>>;
  const endpoint = endpoints.get(endpointSetup.endpointId);
  assert.ok(endpoint !== undefined);
  endpoints.set(endpointSetup.endpointId, { ...endpoint, detectedVendor: "FORGED_VENDOR" });
  await assert.rejects(
    endpointSetup.marketplace.createQuote({
      apiKey: endpointSetup.apiKey,
      supplierId: endpointSetup.supplierId,
      endpointId: endpointSetup.endpointId,
      model: "acme-chat-v1",
      maxInputTokens: "8",
      maxOutputTokens: "8",
    }),
    isIntegrityFailure,
  );
});

test("sparse or decorated rating arrays cannot bypass exact record validation", async () => {
  for (const variant of ["sparse", "decorated"] as const) {
    const setup = await configuredMarketplace();
    const completed = await inferOnce(setup, `array-${variant}`);
    const records = privateBillingRecords(setup.marketplace);
    const original = records.get(completed.inferenceId);
    assert.ok(original !== undefined);
    const lineItems = variant === "sparse"
      ? Array(original.ratingRecord.lineItems.length)
      : [...original.ratingRecord.lineItems];
    if (variant === "decorated") {
      Reflect.set(lineItems, "auditOverride", "evil");
    }
    records.set(completed.inferenceId, {
      ...original,
      ratingRecord: { ...original.ratingRecord, lineItems },
    } as SandboxBillingRecord);
    assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
  }
});

test("quote and idempotency map keys are part of exact authenticated coverage", async () => {
  const quoteSetup = await configuredMarketplace();
  const quote = await quoteSetup.marketplace.createQuote({
    apiKey: quoteSetup.apiKey,
    supplierId: quoteSetup.supplierId,
    endpointId: quoteSetup.endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "8",
    maxOutputTokens: "8",
  });
  const quotes = Reflect.get(quoteSetup.marketplace, "quotes") as Map<string, Record<string, unknown>>;
  const quoteRecord = quotes.get(quote.quoteId);
  assert.ok(quoteRecord !== undefined);
  quotes.delete(quote.quoteId);
  quotes.set("quote_alias", quoteRecord);
  assert.throws(() => quoteSetup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
  await assert.rejects(
    quoteSetup.marketplace.infer({
      apiKey: quoteSetup.apiKey,
      quoteId: "quote_alias",
      prompt: "alias must not be billable",
      idempotencyKey: "quote-alias",
    }),
    isIntegrityFailure,
  );

  const idempotencySetup = await configuredMarketplace();
  await inferOnce(idempotencySetup, "idempotency-index");
  const idempotency = Reflect.get(idempotencySetup.marketplace, "idempotency") as Map<string, unknown>;
  const entry = [...idempotency.entries()][0];
  assert.ok(entry !== undefined);
  idempotency.delete(entry[0]);
  idempotency.set("buyer_alias:request_alias", entry[1]);
  assert.throws(() => idempotencySetup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
});

test("buyer API-key attribution and supplier admission fields are authenticated", async () => {
  const buyerSetup = await configuredMarketplace();
  const secondBuyer = await buyerSetup.marketplace.createBuyer({
    name: "Second Integrity Buyer",
    currency: "USD",
    initialBalanceMinor: "1000",
  });
  const apiKeyIndex = Reflect.get(buyerSetup.marketplace, "buyerIdByApiKeyHash") as Map<string, string>;
  const firstEntry = [...apiKeyIndex.entries()].find(([, buyerId]) => buyerId !== secondBuyer.buyer.buyerId);
  assert.ok(firstEntry !== undefined);
  apiKeyIndex.set(firstEntry[0], secondBuyer.buyer.buyerId);
  await assert.rejects(
    buyerSetup.marketplace.createQuote({
      apiKey: buyerSetup.apiKey,
      supplierId: buyerSetup.supplierId,
      endpointId: buyerSetup.endpointId,
      model: "acme-chat-v1",
      maxInputTokens: "8",
      maxOutputTokens: "8",
    }),
    isIntegrityFailure,
  );

  const supplierSetup = await configuredMarketplace();
  const suppliers = Reflect.get(supplierSetup.marketplace, "suppliers") as Map<string, Record<string, unknown>>;
  const supplier = suppliers.get(supplierSetup.supplierId);
  assert.ok(supplier !== undefined);
  suppliers.set(supplierSetup.supplierId, {
    ...supplier,
    kybStatus: "VERIFIED_PRODUCTION",
    manualApproval: true,
  });
  assert.throws(() => supplierSetup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
});

test("supply-price stream heads detect deletion of the newest version", async () => {
  const setup = await configuredMarketplace();
  await setup.marketplace.setModelPrice({
    supplierId: setup.supplierId,
    endpointId: setup.endpointId,
    model: "acme-chat-v1",
    currency: "USD",
    inputTokenPriceMinor: "999",
    outputTokenPriceMinor: "999",
  });
  const prices = Reflect.get(setup.marketplace, "prices") as unknown[];
  assert.equal(prices.length, 2);
  prices.pop();
  assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
});

test("buyer creation leaves no identity or ledger residue when checkpoint sealing fails", async () => {
  const integrityKeyring = testKeyring();
  const marketplace = new SandboxMarketplace({ integrityKeyring });
  const originalSeal = integrityKeyring.seal.bind(integrityKeyring);
  Reflect.set(integrityKeyring, "seal", (value: Parameters<HmacIntegrityKeyring["seal"]>[0]) => {
    if (value.purpose === "LEDGER_CHECKPOINT") {
      throw new Error("simulated ledger checkpoint signer outage");
    }
    return originalSeal(value);
  });
  await assert.rejects(
    marketplace.createBuyer({
      name: "Must Roll Back",
      currency: "USD",
      initialBalanceMinor: "100",
    }),
    /simulated ledger checkpoint signer outage/,
  );
  assert.equal((Reflect.get(marketplace, "buyers") as Map<string, unknown>).size, 0);
  assert.equal((Reflect.get(marketplace, "buyerIdByApiKeyHash") as Map<string, unknown>).size, 0);
  assert.equal((Reflect.get(marketplace, "journals") as unknown[]).length, 0);
  assert.equal((Reflect.get(marketplace, "ledgerCheckpoints") as Map<string, unknown>).size, 0);
  assert.deepEqual(
    marketplace.verifyBillingIntegrity(),
    { valid: true, recordsVerified: 0, chainStreamsVerified: 0 },
  );
});

test("platform fee and quote-lifetime configuration cannot change outside its authenticated policy", async () => {
  for (const [field, value] of [
    ["platformFeeBps", 9_000n],
    ["quoteLifetimeMs", 60_000],
  ] as const) {
    const setup = await configuredMarketplace();
    Reflect.set(setup.marketplace, field, value);
    assert.throws(() => setup.marketplace.verifyBillingIntegrity(), isIntegrityFailure);
    await assert.rejects(
      setup.marketplace.createQuote({
        apiKey: setup.apiKey,
        supplierId: setup.supplierId,
        endpointId: setup.endpointId,
        model: "acme-chat-v1",
        maxInputTokens: "8",
        maxOutputTokens: "8",
      }),
      isIntegrityFailure,
    );
  }
});
