import assert from "node:assert/strict";
import test from "node:test";

import { DomainError, SandboxMarketplace, estimateTextTokens } from "../src/index.ts";

async function configuredMarketplace(): Promise<{
  marketplace: SandboxMarketplace;
  supplierId: string;
  endpointId: string;
  buyerId: string;
  apiKey: string;
}> {
  const marketplace = new SandboxMarketplace();
  const supplier = await marketplace.createSupplier({ name: "Synthetic Supplier" });
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
  const buyerResult = await marketplace.createBuyer({
    name: "Synthetic Buyer",
    currency: "USD",
    initialBalanceMinor: "10000",
  });
  return {
    marketplace,
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    buyerId: buyerResult.buyer.buyerId,
    apiKey: buyerResult.apiKey,
  };
}

test("mock endpoint is identified and bound to its exact supplier price", async () => {
  const marketplace = new SandboxMarketplace();
  const supplier = await marketplace.createSupplier({ name: "Supplier" });
  const endpoint = await marketplace.registerEndpoint({
    supplierId: supplier.supplierId,
    url: "mock://acme-ai",
    declaredVendor: "acme-ai",
  });

  assert.equal(endpoint.detectedVendor, "ACME_AI");
  assert.equal(endpoint.detectionStatus, "VERIFIED_SANDBOX");
  assert.equal(endpoint.evidenceStatus, "PENDING_REVIEW");
  assert.equal(endpoint.sandboxRoutable, true);

  const price = await marketplace.setModelPrice({
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    model: "acme-chat-v1",
    currency: "USD",
    inputTokenPriceMinor: "7",
    outputTokenPriceMinor: "11",
  });
  assert.equal(price.inputTokenPriceMinor, "7");
  assert.equal(price.outputTokenPriceMinor, "11");
  assert.equal(price.version, "1");
});

test("unknown real endpoint remains registered as PENDING_REVIEW and is never contacted or routed", async () => {
  const marketplace = new SandboxMarketplace();
  const supplier = await marketplace.createSupplier({ name: "Pending Supplier" });
  const endpoint = await marketplace.registerEndpoint({
    supplierId: supplier.supplierId,
    url: "https://inference.invalid.example/v1",
    declaredVendor: "unresearched-vendor",
  });
  assert.equal(endpoint.detectionStatus, "UNIDENTIFIED");
  assert.equal(endpoint.evidenceStatus, "PENDING_REVIEW");
  assert.equal(endpoint.sandboxRoutable, false);

  await marketplace.setModelPrice({
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    model: "unknown-model",
    currency: "USD",
    inputTokenPriceMinor: "1",
    outputTokenPriceMinor: "1",
  });
  const buyer = await marketplace.createBuyer({
    name: "Buyer",
    currency: "USD",
    initialBalanceMinor: "1000",
  });
  await assert.rejects(
    marketplace.createQuote({
      apiKey: buyer.apiKey,
      supplierId: supplier.supplierId,
      endpointId: endpoint.endpointId,
      model: "unknown-model",
      maxInputTokens: "1",
      maxOutputTokens: "1",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "ENDPOINT_NOT_ROUTABLE",
  );
});

test("vendor declaration conflicts stay registered but cannot route", async () => {
  const marketplace = new SandboxMarketplace();
  const supplier = await marketplace.createSupplier({ name: "Conflict Supplier" });
  const endpoint = await marketplace.registerEndpoint({
    supplierId: supplier.supplierId,
    url: "mock://acme-ai",
    declaredVendor: "contoso-ai",
  });
  assert.equal(endpoint.detectedVendor, "ACME_AI");
  assert.equal(endpoint.detectionStatus, "CONFLICT");
  assert.equal(endpoint.evidenceStatus, "PENDING_REVIEW");
  assert.equal(endpoint.sandboxRoutable, false);
});

test("endpoint URLs cannot persist query credentials", async () => {
  const marketplace = new SandboxMarketplace();
  const supplier = await marketplace.createSupplier({ name: "URL Supplier" });
  await assert.rejects(
    marketplace.registerEndpoint({
      supplierId: supplier.supplierId,
      url: "https://example.invalid/v1?api_key=must-not-be-stored",
      declaredVendor: "pending-vendor",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "UNSAFE_ENDPOINT",
  );
  assert.doesNotMatch(JSON.stringify(await marketplace.getState()), /must-not-be-stored/);
});

test("quote, hold, inference, settlement and release preserve a balanced ledger", async () => {
  const { marketplace, supplierId, endpointId, apiKey } = await configuredMarketplace();
  const quote = await marketplace.createQuote({
    apiKey,
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "32",
    maxOutputTokens: "16",
  });
  assert.equal(quote.currency, "USD");
  assert.match(quote.maxHoldMinor, /^[1-9]\d*$/);
  assert.equal(quote.priceVersion, "1");

  const prompt = "  synthetic input only  ";
  const result = await marketplace.infer({
    apiKey,
    quoteId: quote.quoteId,
    prompt,
    idempotencyKey: "core-flow-1",
  });
  assert.equal(result.vendor, "ACME_AI");
  assert.equal(result.model, "acme-chat-v1");
  assert.match(result.usage.inputTokens, /^\d+$/);
  assert.equal(result.usage.inputTokens, estimateTextTokens(prompt));
  assert.match(result.usage.outputTokens, /^\d+$/);
  assert.match(result.buyerChargeMinor, /^\d+$/);

  const billing = await marketplace.getBillingRecords();
  assert.equal(billing.sandbox, true);
  assert.equal(billing.authoritativeProviderUsage, false);
  assert.equal(billing.records.length, 1);
  const billingRecord = billing.records[0];
  assert.ok(billingRecord !== undefined);
  assert.equal(billingRecord.inferenceId, result.inferenceId);
  assert.equal(billingRecord.quoteId, quote.quoteId);
  assert.equal(billingRecord.billingStatus, "SETTLED");
  assert.equal(billingRecord.usageRecord.source, "SANDBOX_ESTIMATE");
  assert.equal(billingRecord.usageRecord.finality, "FINAL");
  assert.equal(billingRecord.usageRecord.outcome, "SUCCEEDED");
  assert.equal(billingRecord.usageRecord.quantities.INPUT_TOKENS, result.usage.inputTokens);
  assert.equal(billingRecord.usageRecord.quantities.OUTPUT_TOKENS, result.usage.outputTokens);
  assert.equal(billingRecord.ratingRecord.priceId, quote.priceId);
  assert.equal(billingRecord.ratingRecord.priceVersion, quote.priceVersion);
  assert.equal(billingRecord.ratingRecord.maximumChargeMinor, quote.maxHoldMinor);
  assert.equal(billingRecord.ratingRecord.supplierCostMinor, result.supplierCostMinor);
  assert.equal(billingRecord.ratingRecord.platformFeeMinor, result.platformFeeMinor);
  assert.equal(billingRecord.ratingRecord.buyerChargeMinor, result.buyerChargeMinor);
  assert.deepEqual(billingRecord.ledgerJournalIds, result.ledgerJournalIds);
  assert.doesNotMatch(JSON.stringify(billingRecord), /synthetic input only/);

  const ledger = await marketplace.getLedger();
  assert.equal(ledger.balanced, true);
  assert.ok(ledger.journals.length >= 4);
  assert.equal(
    BigInt(result.buyerChargeMinor),
    BigInt(result.supplierCostMinor) + BigInt(result.platformFeeMinor),
  );
  const businessKeys = new Set<string>();
  for (const journal of ledger.journals) {
    assert.equal(businessKeys.has(`${journal.currency}:${journal.businessKey}`), false);
    businessKeys.add(`${journal.currency}:${journal.businessKey}`);
    assert.ok(journal.postings.every((posting) => BigInt(posting.amountMinor) > 0n));
    const debit = journal.postings
      .filter((posting) => posting.direction === "DEBIT")
      .reduce((sum, posting) => sum + BigInt(posting.amountMinor), 0n);
    const credit = journal.postings
      .filter((posting) => posting.direction === "CREDIT")
      .reduce((sum, posting) => sum + BigInt(posting.amountMinor), 0n);
    assert.equal(debit, credit);
  }
  const holdAmount = ledger.journals
    .find((journal) => journal.eventType === "HOLD_PLACED")
    ?.postings.find((posting) => posting.direction === "DEBIT")?.amountMinor;
  const settledAmount = ledger.journals
    .find((journal) => journal.eventType === "INFERENCE_SETTLED")
    ?.postings.find((posting) => posting.direction === "DEBIT")?.amountMinor;
  const releasedAmount = ledger.journals
    .find((journal) => journal.eventType === "HOLD_RELEASED")
    ?.postings.find((posting) => posting.direction === "DEBIT")?.amountMinor ?? "0";
  assert.ok(holdAmount !== undefined);
  assert.ok(settledAmount !== undefined);
  assert.equal(BigInt(holdAmount), BigInt(settledAmount) + BigInt(releasedAmount));
});

test("concurrent use of the same idempotency key creates one financial effect", async () => {
  const { marketplace, supplierId, endpointId, apiKey } = await configuredMarketplace();
  const quote = await marketplace.createQuote({
    apiKey,
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "32",
    maxOutputTokens: "16",
  });
  const request = {
    apiKey,
    quoteId: quote.quoteId,
    prompt: "same request",
    idempotencyKey: "same-effect-1",
  };
  const [first, second] = await Promise.all([
    marketplace.infer(request),
    marketplace.infer(request),
  ]);
  const ledgerAfterReplay = await marketplace.getLedger();

  assert.equal(second.inferenceId, first.inferenceId);
  assert.equal((await marketplace.getBillingRecords()).records.length, 1);
  assert.equal(
    ledgerAfterReplay.journals.filter((journal) => journal.businessKey.endsWith(quote.quoteId)).length,
    first.ledgerJournalIds.length,
  );
});

test("inference journal batch rolls back completely and can be retried after a commit failure", async () => {
  const { marketplace, supplierId, endpointId, apiKey } = await configuredMarketplace();
  const quote = await marketplace.createQuote({
    apiKey,
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "32",
    maxOutputTokens: "16",
  });
  const stateBefore = await marketplace.getState();
  const ledgerBefore = await marketplace.getLedger();
  const originalPostJournalBatch = Reflect.get(marketplace, "postJournalBatch") as Function;
  let failOnce = true;
  Reflect.set(marketplace, "postJournalBatch", (drafts: readonly unknown[]) => {
    const journals = Reflect.apply(originalPostJournalBatch, marketplace, [drafts]);
    if (failOnce) {
      failOnce = false;
      throw new Error("simulated failure after the staged journal batch");
    }
    return journals;
  });
  const request = {
    apiKey,
    quoteId: quote.quoteId,
    prompt: "retryable inference",
    idempotencyKey: "atomic-retry-1",
  };

  await assert.rejects(marketplace.infer(request), /simulated failure/);
  assert.deepEqual(await marketplace.getLedger(), ledgerBefore);
  assert.deepEqual(await marketplace.getState(), stateBefore);
  assert.equal((await marketplace.getBillingRecords()).records.length, 0);

  const result = await marketplace.infer(request);
  assert.ok(result.ledgerJournalIds.length >= 2);
  assert.equal((await marketplace.getLedger()).balanced, true);
  assert.equal((await marketplace.getBillingRecords()).records.length, 1);
});

test("quote fails closed when its frozen rating policy is swapped", async () => {
  const { marketplace, supplierId, endpointId, apiKey } = await configuredMarketplace();
  const firstQuote = await marketplace.createQuote({
    apiKey,
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "8",
    maxOutputTokens: "8",
  });
  await marketplace.setModelPrice({
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    currency: "USD",
    inputTokenPriceMinor: "100",
    outputTokenPriceMinor: "100",
  });
  const secondQuote = await marketplace.createQuote({
    apiKey,
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "8",
    maxOutputTokens: "8",
  });
  const policies = Reflect.get(marketplace, "quoteRatingPolicies") as Map<string, unknown>;
  const firstPolicy = policies.get(firstQuote.quoteId);
  const secondPolicy = policies.get(secondQuote.quoteId);
  assert.ok(firstPolicy !== undefined && secondPolicy !== undefined);
  const ledgerBefore = await marketplace.getLedger();
  policies.set(secondQuote.quoteId, firstPolicy);

  await assert.rejects(
    marketplace.infer({
      apiKey,
      quoteId: secondQuote.quoteId,
      prompt: "must not settle with the wrong price",
      idempotencyKey: "policy-swap-1",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "RATING_POLICY_TAMPERED",
  );
  await assert.rejects(
    marketplace.getLedger(),
    (error: unknown) => error instanceof DomainError && error.code === "RATING_POLICY_TAMPERED",
  );
  await assert.rejects(
    marketplace.getBillingRecords(),
    (error: unknown) => error instanceof DomainError && error.code === "RATING_POLICY_TAMPERED",
  );
  await assert.rejects(
    marketplace.getState(),
    (error: unknown) => error instanceof DomainError && error.code === "RATING_POLICY_TAMPERED",
  );
  policies.set(secondQuote.quoteId, secondPolicy);
  assert.deepEqual(await marketplace.getLedger(), ledgerBefore);
  assert.equal((await marketplace.getBillingRecords()).records.length, 0);
  const state = await marketplace.getState();
  const quotes = state.quotes as readonly Array<{ quoteId: string; status: string }>;
  assert.equal(quotes.find((candidate) => candidate.quoteId === secondQuote.quoteId)?.status, "ISSUED");
});

test("an idempotency key cannot be reused with different inference input", async () => {
  const { marketplace, supplierId, endpointId, apiKey } = await configuredMarketplace();
  const quote = await marketplace.createQuote({
    apiKey,
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "32",
    maxOutputTokens: "16",
  });
  await marketplace.infer({
    apiKey,
    quoteId: quote.quoteId,
    prompt: "first input",
    idempotencyKey: "conflict-1",
  });
  await assert.rejects(
    marketplace.infer({
      apiKey,
      quoteId: quote.quoteId,
      prompt: "different input",
      idempotencyKey: "conflict-1",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("insufficient balance rejects a quote without adding a financial journal", async () => {
  const marketplace = new SandboxMarketplace();
  const supplier = await marketplace.createSupplier({ name: "Expensive Supplier" });
  const endpoint = await marketplace.registerEndpoint({
    supplierId: supplier.supplierId,
    url: "mock://acme-ai",
    declaredVendor: "acme-ai",
  });
  await marketplace.setModelPrice({
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    model: "expensive-model",
    currency: "USD",
    inputTokenPriceMinor: "100",
    outputTokenPriceMinor: "100",
  });
  const buyer = await marketplace.createBuyer({
    name: "Small Balance Buyer",
    currency: "USD",
    initialBalanceMinor: "1",
  });
  const before = await marketplace.getLedger();
  await assert.rejects(
    marketplace.createQuote({
      apiKey: buyer.apiKey,
      supplierId: supplier.supplierId,
      endpointId: endpoint.endpointId,
      model: "expensive-model",
      maxInputTokens: "1",
      maxOutputTokens: "1",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "INSUFFICIENT_BALANCE",
  );
  const after = await marketplace.getLedger();
  assert.equal(after.journals.length, before.journals.length);
  assert.equal(after.balanced, true);
});

test("a newer supplier price never rewrites an issued quote", async () => {
  const { marketplace, supplierId, endpointId, apiKey } = await configuredMarketplace();
  const quote = await marketplace.createQuote({
    apiKey,
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "32",
    maxOutputTokens: "16",
  });
  await marketplace.setModelPrice({
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    currency: "USD",
    inputTokenPriceMinor: "200",
    outputTokenPriceMinor: "400",
  });
  const result = await marketplace.infer({
    apiKey,
    quoteId: quote.quoteId,
    prompt: "price snapshot",
    idempotencyKey: "price-snapshot-1",
  });
  const expectedSupplierCost = BigInt(result.usage.inputTokens) * BigInt(quote.inputTokenPriceMinor)
    + BigInt(result.usage.outputTokens) * BigInt(quote.outputTokenPriceMinor);
  assert.equal(result.supplierCostMinor, expectedSupplierCost.toString());
  assert.equal(quote.priceVersion, "1");
});

test("a zero output-token limit returns and bills no output", async () => {
  const { marketplace, supplierId, endpointId, apiKey } = await configuredMarketplace();
  const quote = await marketplace.createQuote({
    apiKey,
    supplierId,
    endpointId,
    model: "acme-chat-v1",
    maxInputTokens: "32",
    maxOutputTokens: "0",
  });
  const result = await marketplace.infer({
    apiKey,
    quoteId: quote.quoteId,
    prompt: "bill only delivered output",
    idempotencyKey: "zero-output-1",
  });
  assert.equal(result.output, "");
  assert.equal(result.usage.outputTokens, "0");
  const records = await marketplace.getBillingRecords();
  const outputLine = records.records[0]?.ratingRecord.lineItems.find(
    (lineItem) => lineItem.dimension === "OUTPUT_TOKENS",
  );
  assert.equal(outputLine?.quantity, "0");
  assert.equal(outputLine?.amountMinor, "0");
});

test("a zero-value inference creates no zero-amount ledger postings", async () => {
  const marketplace = new SandboxMarketplace({ platformFeeBps: "0" });
  const supplier = await marketplace.createSupplier({ name: "Free Input Supplier" });
  const endpoint = await marketplace.registerEndpoint({
    supplierId: supplier.supplierId,
    url: "mock://acme-ai",
    declaredVendor: "acme-ai",
  });
  await marketplace.setModelPrice({
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    model: "free-input-model",
    currency: "USD",
    inputTokenPriceMinor: "0",
    outputTokenPriceMinor: "1",
  });
  const buyer = await marketplace.createBuyer({
    name: "Zero Balance Buyer",
    currency: "USD",
    initialBalanceMinor: "0",
  });
  const quote = await marketplace.createQuote({
    apiKey: buyer.apiKey,
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    model: "free-input-model",
    maxInputTokens: "1",
    maxOutputTokens: "0",
  });
  assert.equal(quote.maxHoldMinor, "0");
  const result = await marketplace.infer({
    apiKey: buyer.apiKey,
    quoteId: quote.quoteId,
    prompt: "a",
    idempotencyKey: "zero-value-1",
  });
  assert.equal(result.buyerChargeMinor, "0");
  assert.deepEqual(result.ledgerJournalIds, []);
  const ledger = await marketplace.getLedger();
  assert.equal(ledger.balanced, true);
  assert.deepEqual(ledger.journals, []);
});

test("latest supplier price is selected within the buyer currency", async () => {
  const marketplace = new SandboxMarketplace();
  const supplier = await marketplace.createSupplier({ name: "Multi Currency Supplier" });
  const endpoint = await marketplace.registerEndpoint({
    supplierId: supplier.supplierId,
    url: "mock://acme-ai",
    declaredVendor: "acme-ai",
  });
  const usdPrice = await marketplace.setModelPrice({
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    model: "multi-currency-model",
    currency: "USD",
    inputTokenPriceMinor: "2",
    outputTokenPriceMinor: "4",
  });
  await marketplace.setModelPrice({
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    model: "multi-currency-model",
    currency: "EUR",
    inputTokenPriceMinor: "3",
    outputTokenPriceMinor: "5",
  });
  const buyer = await marketplace.createBuyer({
    name: "USD Buyer",
    currency: "USD",
    initialBalanceMinor: "1000",
  });
  const quote = await marketplace.createQuote({
    apiKey: buyer.apiKey,
    supplierId: supplier.supplierId,
    endpointId: endpoint.endpointId,
    model: "multi-currency-model",
    maxInputTokens: "10",
    maxOutputTokens: "10",
  });
  assert.equal(quote.currency, "USD");
  assert.equal(quote.priceId, usdPrice.priceId);
  assert.equal(quote.inputTokenPriceMinor, "2");
  assert.equal(quote.outputTokenPriceMinor, "4");
});

test("API keys are returned once and never exposed in state snapshots", async () => {
  const marketplace = new SandboxMarketplace();
  const created = await marketplace.createBuyer({
    name: "Key Test Buyer",
    currency: "USD",
    initialBalanceMinor: "10",
  });
  assert.match(created.apiKey, /^ct_sandbox_/);
  const serializedState = JSON.stringify(await marketplace.getState());
  assert.doesNotMatch(serializedState, new RegExp(created.apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(serializedState, /apiKeyHash|credential|secret/i);

  await assert.rejects(
    marketplace.createQuote({
      apiKey: "ct_sandbox_invalid",
      supplierId: "supplier_missing",
      endpointId: "endpoint_missing",
      model: "missing",
      maxInputTokens: "1",
      maxOutputTokens: "1",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_API_KEY",
  );
});
