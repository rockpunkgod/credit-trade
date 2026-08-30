import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type RequestOptions = {
  method?: string;
  body?: unknown;
  apiKey?: string;
  idempotencyKey?: string;
};

async function findFreePort() {
  return await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("Could not allocate a local demo port."));
        return;
      }

      const port = address.port;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function rememberOutput(previous, chunk) {
  const combined = `${previous}${chunk.toString("utf8")}`;
  return combined.slice(-8_000);
}

async function waitForApi(baseUrl, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The local API exited during startup with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.sandbox !== true) {
          throw new Error("The API did not identify itself as a sandbox.");
        }
        if (payload.productionPaymentsEnabled !== false) {
          throw new Error("The API production-payment lock is not closed.");
        }
        return payload;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("did not identify")) {
        throw error;
      }
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error("Timed out waiting for the local sandbox API.");
}

async function request(baseUrl: string, path: string, options: RequestOptions = {}) {
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.apiKey !== undefined) {
    headers.set("authorization", `Bearer ${options.apiKey}`);
  }
  if (options.idempotencyKey !== undefined) {
    headers.set("idempotency-key", options.idempotencyKey);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    const message = payload?.error?.message ?? "Sandbox request failed.";
    throw new Error(`${code}: ${message}`);
  }
  if (payload?.sandbox !== true || !("data" in payload)) {
    throw new Error(`Unexpected response envelope from ${path}.`);
  }
  return payload.data;
}

function verifyLedger(ledger) {
  const entries = Array.isArray(ledger)
    ? ledger
    : ledger?.journals ?? ledger?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return false;
  }

  const journalsBalance = entries.every((entry) => {
    if (entry?.balanced === true) {
      return true;
    }
    if (!Array.isArray(entry?.postings)) {
      return false;
    }

    let debits = 0n;
    let credits = 0n;
    for (const posting of entry.postings) {
      const amount = BigInt(posting.amountMinor ?? posting.amount ?? "0");
      if (posting.direction === "DEBIT" || posting.side === "DEBIT") {
        debits += amount;
      } else if (posting.direction === "CREDIT" || posting.side === "CREDIT") {
        credits += amount;
      } else {
        return false;
      }
    }
    return debits === credits;
  });
  return journalsBalance && (ledger?.balanced === undefined || ledger.balanced === true);
}

function countLedgerEntries(ledger) {
  if (Array.isArray(ledger)) {
    return ledger.length;
  }
  if (Array.isArray(ledger?.entries)) {
    return ledger.entries.length;
  }
  return Array.isArray(ledger?.journals) ? ledger.journals.length : 0;
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill();
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
  ]);
}

async function main() {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "apps/api/src/main.ts"],
    {
      cwd: repositoryRoot,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let childOutput = "";
  child.stdout.on("data", (chunk) => {
    childOutput = rememberOutput(childOutput, chunk);
  });
  child.stderr.on("data", (chunk) => {
    childOutput = rememberOutput(childOutput, chunk);
  });

  try {
    const health = await waitForApi(baseUrl, child);

    const supplier = await request(baseUrl, "/sandbox/suppliers", {
      method: "POST",
      body: { name: "Synthetic Demo Supplier" },
    });
    const registered = await request(
      baseUrl,
      `/sandbox/suppliers/${encodeURIComponent(supplier.supplierId)}/endpoints`,
      {
        method: "POST",
        body: {
          url: "mock://acme-ai",
          declaredVendor: "acme-ai",
          model: "acme-chat-v1",
          currency: "USD",
          inputTokenPriceMinor: "1",
          outputTokenPriceMinor: "2",
        },
      },
    );
    const buyerResult = await request(baseUrl, "/sandbox/buyers", {
      method: "POST",
      body: {
        name: "Synthetic Demo Buyer",
        currency: "USD",
        initialBalanceMinor: "10000",
      },
    });

    const quote = await request(baseUrl, "/v1/quotes", {
      method: "POST",
      apiKey: buyerResult.apiKey,
      body: {
        supplierId: supplier.supplierId,
        endpointId: registered.endpoint.endpointId,
        model: "acme-chat-v1",
        maxInputTokens: "32",
        maxOutputTokens: "16",
      },
    });
    const inference = await request(baseUrl, "/v1/inference", {
      method: "POST",
      apiKey: buyerResult.apiKey,
      idempotencyKey: "credit-trade-local-demo-v1",
      body: {
        quoteId: quote.quoteId,
        prompt: "Synthetic local demo input: red green blue.",
      },
    });

    const state = await request(baseUrl, "/sandbox/state");
    const ledger = await request(baseUrl, "/sandbox/ledger");
    const ledgerBalanced = verifyLedger(ledger);
    if (!ledgerBalanced) {
      throw new Error("The sandbox ledger did not provide balanced journal evidence.");
    }

    const summary = {
      sandbox: true,
      productionPaymentsAvailable: false,
      realProviderUsed: false,
      apiHealth: health.status,
      supplierId: supplier.supplierId,
      endpointId: registered.endpoint.endpointId,
      detectedVendor:
        registered.endpoint.detectedVendor ?? "mock",
      evidenceStatus:
        registered.endpoint.evidenceStatus ??
        "PENDING_REVIEW",
      buyerId: buyerResult.buyer.buyerId,
      quoteId: quote.quoteId,
      inferenceId: inference.inferenceId,
      ledgerBalanced,
      ledgerEntryCount: countLedgerEntries(ledger),
      stateCaptured: state !== null && typeof state === "object",
    };
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (childOutput.length > 0) {
      console.error(childOutput);
    }
    throw new Error(`Local sandbox demo failed: ${message}`);
  } finally {
    await stopChild(child);
  }
}

await main();
