import assert from "node:assert/strict";
import test from "node:test";

import { DomainError, SandboxMarketplace } from "../src/index.ts";

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

  const result = await marketplace.infer({
    apiKey,
    quoteId: quote.quoteId,
    prompt: "synthetic input only",
    idempotencyKey: "core-flow-1",
  });
  assert.equal(result.vendor, "ACME_AI");
  assert.equal(result.model, "acme-chat-v1");
  assert.match(result.usage.inputTokens, /^\d+$/);
  assert.match(result.usage.outputTokens, /^\d+$/);
  assert.match(result.buyerChargeMinor, /^\d+$/);

  const ledger = await marketplace.getLedger();
  assert.equal(ledger.balanced, true);
  assert.ok(ledger.journals.length >= 4);
  for (const journal of ledger.journals) {
    const debit = journal.postings
      .filter((posting) => posting.direction === "DEBIT")
      .reduce((sum, posting) => sum + BigInt(posting.amountMinor), 0n);
    const credit = journal.postings
      .filter((posting) => posting.direction === "CREDIT")
      .reduce((sum, posting) => sum + BigInt(posting.amountMinor), 0n);
    assert.equal(debit, credit);
  }
});

test("same idempotency key returns one inference and creates no duplicate financial effect", async () => {
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
  const first = await marketplace.infer(request);
  const ledgerAfterFirst = await marketplace.getLedger();
  const second = await marketplace.infer(request);
  const ledgerAfterSecond = await marketplace.getLedger();

  assert.equal(second.inferenceId, first.inferenceId);
  assert.equal(ledgerAfterSecond.journals.length, ledgerAfterFirst.journals.length);
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
