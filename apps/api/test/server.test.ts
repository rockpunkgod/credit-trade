import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { SandboxMarketplace } from "../../../packages/core/src/index.ts";
import { apiLimits, createApiServer } from "../src/server.ts";

type JsonRecord = Record<string, unknown>;

function marketplaceDouble(overrides: Partial<Record<string, (...args: never[]) => unknown>> = {}): SandboxMarketplace {
  const base = {
    createSupplier: (input: JsonRecord) => ({ supplierId: "supplier_test", ...input }),
    registerEndpoint: (input: JsonRecord) => ({ endpointId: "endpoint_test", ...input }),
    setModelPrice: (input: JsonRecord) => ({ priceId: "price_test", ...input }),
    createBuyer: (input: JsonRecord) => ({ buyerId: "buyer_test", apiKey: "ct_test_api_key", ...input }),
    createQuote: (input: JsonRecord) => ({ quoteId: "quote_test", ...input }),
    infer: (input: JsonRecord) => ({ inferenceId: "inference_test", output: "sandbox output", ...input }),
    getState: () => ({
      apiKeyHash: "must-not-leak",
      integrityKey: "must-not-leak-integrity-key",
      keyMaterial: "must-not-leak-key-material",
      privateKey: "must-not-leak-private-key",
      integritySeal: "must-not-leak-integrity-seal",
      authenticationTag: "must-not-leak-authentication-tag",
      requestAuthentication: { keyId: "must-not-leak-key-id" },
      buyers: [{ buyerId: "buyer_test" }],
    }),
    getLedger: () => ({ balanced: true, journals: [] }),
  };

  return Object.assign(base, overrides) as unknown as SandboxMarketplace;
}

async function startServer(marketplace: SandboxMarketplace = marketplaceDouble()): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createApiServer(marketplace);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error === undefined ? resolve() : reject(error));
    }),
  };
}

async function json(response: Response): Promise<JsonRecord> {
  return await response.json() as JsonRecord;
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

test("health is explicitly sandbox-only and does not enable CORS", async () => {
  const api = await startServer();
  try {
    const response = await fetch(`${api.baseUrl}/health`, {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("x-sandbox-mode"), "true");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await json(response), {
      sandbox: true,
      status: "ok",
      productionPaymentsEnabled: false,
      bindPolicy: "loopback-only",
    });

    const preflight = await fetch(`${api.baseUrl}/health`, { method: "OPTIONS" });
    assert.equal(preflight.status, 404);
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
  } finally {
    await api.close();
  }
});

test("supplier endpoint registration also publishes its exact string price", async () => {
  const calls: Array<{ operation: string; input: JsonRecord }> = [];
  const marketplace = marketplaceDouble({
    registerEndpoint: ((input: JsonRecord) => {
      calls.push({ operation: "endpoint", input });
      return { endpointId: "endpoint_test", ...input };
    }) as (...args: never[]) => unknown,
    setModelPrice: ((input: JsonRecord) => {
      calls.push({ operation: "price", input });
      return { priceId: "price_test", ...input };
    }) as (...args: never[]) => unknown,
  });
  const api = await startServer(marketplace);

  try {
    const supplierResponse = await fetch(`${api.baseUrl}/sandbox/suppliers`, jsonRequest({ name: "Fixture Supplier" }));
    assert.equal(supplierResponse.status, 201);
    assert.equal((await json(supplierResponse)).sandbox, true);

    const response = await fetch(
      `${api.baseUrl}/sandbox/suppliers/supplier_test/endpoints`,
      jsonRequest({
        url: "mock://vendor-a",
        declaredVendor: "vendor-a",
        model: "model-a",
        currency: "USD",
        inputTokenPriceMinor: "15",
        outputTokenPriceMinor: "30",
      }),
    );
    assert.equal(response.status, 201);
    const body = await json(response);
    assert.equal(body.sandbox, true);
    assert.deepEqual(calls, [
      {
        operation: "endpoint",
        input: { supplierId: "supplier_test", url: "mock://vendor-a", declaredVendor: "vendor-a" },
      },
      {
        operation: "price",
        input: {
          supplierId: "supplier_test",
          endpointId: "endpoint_test",
          model: "model-a",
          currency: "USD",
          inputTokenPriceMinor: "15",
          outputTokenPriceMinor: "30",
        },
      },
    ]);
  } finally {
    await api.close();
  }
});

test("buyer quote and inference require Bearer auth and an idempotency key", async () => {
  const calls: Array<{ operation: string; input: JsonRecord }> = [];
  const marketplace = marketplaceDouble({
    createQuote: ((input: JsonRecord) => {
      calls.push({ operation: "quote", input });
      return { quoteId: "quote_test" };
    }) as (...args: never[]) => unknown,
    infer: ((input: JsonRecord) => {
      calls.push({ operation: "infer", input });
      return { inferenceId: "inference_test", output: "sandbox output" };
    }) as (...args: never[]) => unknown,
  });
  const api = await startServer(marketplace);

  try {
    const quoteInput = {
      supplierId: "supplier_test",
      endpointId: "endpoint_test",
      model: "model-a",
      maxInputTokens: "100",
      maxOutputTokens: "20",
    };
    const missingAuth = await fetch(`${api.baseUrl}/v1/quotes`, jsonRequest(quoteInput));
    assert.equal(missingAuth.status, 401);
    assert.match(missingAuth.headers.get("www-authenticate") ?? "", /^Bearer /);

    const quote = await fetch(
      `${api.baseUrl}/v1/quotes`,
      jsonRequest(quoteInput, { authorization: "Bearer ct_test_api_key" }),
    );
    assert.equal(quote.status, 201);

    const missingReplayKey = await fetch(
      `${api.baseUrl}/v1/inference`,
      jsonRequest({ quoteId: "quote_test", prompt: "hello" }, { authorization: "Bearer ct_test_api_key" }),
    );
    assert.equal(missingReplayKey.status, 400);

    const inference = await fetch(
      `${api.baseUrl}/v1/inference`,
      jsonRequest(
        { quoteId: "quote_test", prompt: "  hello  " },
        { authorization: "Bearer ct_test_api_key", "idempotency-key": "request-0001" },
      ),
    );
    assert.equal(inference.status, 200);
    assert.deepEqual(calls, [
      { operation: "quote", input: { apiKey: "ct_test_api_key", ...quoteInput } },
      {
        operation: "infer",
        input: {
          apiKey: "ct_test_api_key",
          quoteId: "quote_test",
          prompt: "  hello  ",
          idempotencyKey: "request-0001",
        },
      },
    ]);
  } finally {
    await api.close();
  }
});

test("JSON boundary rejects numeric money, unsupported media and oversized bodies", async () => {
  const api = await startServer();
  try {
    const numericMoney = await fetch(
      `${api.baseUrl}/sandbox/buyers`,
      jsonRequest({ name: "Buyer", currency: "USD", initialBalanceMinor: 1000 }),
    );
    assert.equal(numericMoney.status, 400);

    const wrongMedia = await fetch(`${api.baseUrl}/sandbox/suppliers`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-json",
    });
    assert.equal(wrongMedia.status, 415);

    const oversized = JSON.stringify({ name: "x".repeat(apiLimits.maxJsonBodyBytes) });
    const tooLarge = await fetch(`${api.baseUrl}/sandbox/suppliers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
    });
    assert.equal(tooLarge.status, 413);
  } finally {
    await api.close();
  }
});

test("unexpected failures and state snapshots do not disclose sensitive values", async () => {
  const marketplace = marketplaceDouble({
    createSupplier: (() => {
      throw new Error("credential=super-secret-internal-value");
    }) as (...args: never[]) => unknown,
  });
  const api = await startServer(marketplace);

  try {
    const failed = await fetch(`${api.baseUrl}/sandbox/suppliers`, jsonRequest({ name: "Supplier" }));
    assert.equal(failed.status, 500);
    const failedText = await failed.text();
    assert.doesNotMatch(failedText, /super-secret|credential=/i);
    assert.match(failedText, /INTERNAL_ERROR/);

    const state = await fetch(`${api.baseUrl}/sandbox/state`);
    const stateText = await state.text();
    assert.equal(state.status, 200);
    assert.doesNotMatch(
      stateText,
      /must-not-leak|apiKeyHash|integrityKey|keyMaterial|privateKey|integritySeal|authenticationTag/i,
    );
  } finally {
    await api.close();
  }
});

test("internal billing integrity failures are redacted as server failures", async () => {
  const internalCodes = [
    "INVALID_RATE",
    "DUPLICATE_BUSINESS_EVENT",
    "INTEGRITY_KEY_UNAVAILABLE",
    "INTEGRITY_PROOF_INVALID",
    "METER_SCHEMA_MISMATCH",
    "RATING_POLICY_TAMPERED",
    "UNPRICED_USAGE",
    "USAGE_CONFLICT",
  ];

  for (const code of internalCodes) {
    const marketplace = marketplaceDouble({
      infer: (() => {
        throw Object.assign(new Error("sensitive internal billing detail"), { code });
      }) as (...args: never[]) => unknown,
    });
    const api = await startServer(marketplace);
    try {
      const failed = await fetch(
        `${api.baseUrl}/v1/inference`,
        jsonRequest(
          { quoteId: "quote_test", prompt: "hello" },
          { authorization: "Bearer ct_test_api_key", "idempotency-key": `internal-${code}` },
        ),
      );
      assert.equal(failed.status, 500);
      const failedText = await failed.text();
      assert.match(failedText, /INTERNAL_ERROR/);
      assert.doesNotMatch(failedText, /sensitive|billing detail/i);
    } finally {
      await api.close();
    }
  }
});

test("real sandbox core completes quote, inference, replay and balanced-ledger flow", async () => {
  const api = await startServer(new (await import("../../../packages/core/src/index.ts")).SandboxMarketplace());

  try {
    const supplierResponse = await fetch(
      `${api.baseUrl}/sandbox/suppliers`,
      jsonRequest({ name: "API Flow Supplier" }),
    );
    assert.equal(supplierResponse.status, 201);
    const supplierEnvelope = await json(supplierResponse);
    const supplier = supplierEnvelope.data as JsonRecord;

    const endpointResponse = await fetch(
      `${api.baseUrl}/sandbox/suppliers/${encodeURIComponent(String(supplier.supplierId))}/endpoints`,
      jsonRequest({
        url: "mock://acme-ai",
        declaredVendor: "acme-ai",
        model: "acme-chat-v1",
        currency: "USD",
        inputTokenPriceMinor: "2",
        outputTokenPriceMinor: "4",
      }),
    );
    assert.equal(endpointResponse.status, 201);
    const endpointEnvelope = await json(endpointResponse);
    const endpointAndPrice = endpointEnvelope.data as JsonRecord;
    const endpoint = endpointAndPrice.endpoint as JsonRecord;
    assert.equal(endpoint.sandboxRoutable, true);

    const buyerResponse = await fetch(
      `${api.baseUrl}/sandbox/buyers`,
      jsonRequest({ name: "API Flow Buyer", currency: "USD", initialBalanceMinor: "10000" }),
    );
    assert.equal(buyerResponse.status, 201);
    const buyerEnvelope = await json(buyerResponse);
    const buyerWithKey = buyerEnvelope.data as JsonRecord;
    const buyer = buyerWithKey.buyer as JsonRecord;
    const apiKey = String(buyerWithKey.apiKey);
    assert.match(String(buyer.buyerId), /^buyer_/);
    assert.match(apiKey, /^ct_sandbox_/);

    const quoteResponse = await fetch(
      `${api.baseUrl}/v1/quotes`,
      jsonRequest(
        {
          supplierId: supplier.supplierId,
          endpointId: endpoint.endpointId,
          model: "acme-chat-v1",
          maxInputTokens: "32",
          maxOutputTokens: "16",
        },
        { authorization: `Bearer ${apiKey}` },
      ),
    );
    assert.equal(quoteResponse.status, 201);
    const quoteEnvelope = await json(quoteResponse);
    const quote = quoteEnvelope.data as JsonRecord;
    assert.equal(quote.currency, "USD");

    const inferenceRequest = jsonRequest(
      { quoteId: quote.quoteId, prompt: "synthetic API test input" },
      { authorization: `Bearer ${apiKey}`, "idempotency-key": "api-flow-replay-1" },
    );
    const firstResponse = await fetch(`${api.baseUrl}/v1/inference`, inferenceRequest);
    assert.equal(firstResponse.status, 200);
    const firstEnvelope = await json(firstResponse);
    const first = firstEnvelope.data as JsonRecord;

    const replayResponse = await fetch(
      `${api.baseUrl}/v1/inference`,
      jsonRequest(
        { quoteId: quote.quoteId, prompt: "synthetic API test input" },
        { authorization: `Bearer ${apiKey}`, "idempotency-key": "api-flow-replay-1" },
      ),
    );
    assert.equal(replayResponse.status, 200);
    const replayEnvelope = await json(replayResponse);
    const replay = replayEnvelope.data as JsonRecord;
    assert.equal(replay.inferenceId, first.inferenceId);

    const stateResponse = await fetch(`${api.baseUrl}/sandbox/state`);
    const stateText = await stateResponse.text();
    assert.equal(stateResponse.status, 200);
    assert.doesNotMatch(stateText, new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(stateText, /apiKeyHash|credential|secret/i);

    const ledgerResponse = await fetch(`${api.baseUrl}/sandbox/ledger`);
    assert.equal(ledgerResponse.status, 200);
    const ledgerEnvelope = await json(ledgerResponse);
    const ledger = ledgerEnvelope.data as JsonRecord;
    assert.equal(ledger.balanced, true);
    assert.ok(Array.isArray(ledger.journals));
    assert.ok((ledger.journals as unknown[]).length >= 4);
  } finally {
    await api.close();
  }
});
