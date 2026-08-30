import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { SandboxMarketplace } from "../../../packages/core/src/index.ts";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 256;
const MAX_PROMPT_LENGTH = 32 * 1024;
const DECIMAL_INTEGER = /^(0|[1-9]\d{0,29})$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type JsonObject = Record<string, unknown>;

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

const DOMAIN_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  INVALID_ARGUMENT: 400,
  INVALID_INPUT: 400,
  INVALID_MONEY: 400,
  INVALID_PRICE: 400,
  INVALID_URL: 400,
  UNSAFE_ENDPOINT: 400,
  UNAUTHORIZED: 401,
  INVALID_API_KEY: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SUPPLIER_NOT_FOUND: 404,
  ENDPOINT_NOT_FOUND: 404,
  BUYER_NOT_FOUND: 404,
  QUOTE_NOT_FOUND: 404,
  MODEL_PRICE_NOT_FOUND: 404,
  CURRENCY_MISMATCH: 409,
  IDEMPOTENCY_CONFLICT: 409,
  QUOTE_EXPIRED: 409,
  QUOTE_ALREADY_USED: 409,
  INSUFFICIENT_BALANCE: 409,
  INSUFFICIENT_FUNDS: 409,
  ENDPOINT_NOT_ROUTABLE: 422,
  ENDPOINT_NOT_SANDBOX_USABLE: 422,
  NO_ELIGIBLE_ROUTE: 422,
  QUOTE_LIMIT_EXCEEDED: 422,
});

function setCommonHeaders(response: ServerResponse, requestId: string): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Request-Id", requestId);
  response.setHeader("X-Sandbox-Mode", "true");
}

function writeJson(
  response: ServerResponse,
  requestId: string,
  status: number,
  value: unknown,
): void {
  if (response.writableEnded) {
    return;
  }

  const body = JSON.stringify(value);
  response.statusCode = status;
  setCommonHeaders(response, requestId);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function success(response: ServerResponse, requestId: string, status: number, data: unknown): void {
  writeJson(response, requestId, status, { sandbox: true, data });
}

function safeDomainFailure(error: unknown): { status: number; code: string } | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = Reflect.get(error, "code");
  if (typeof code !== "string") {
    return undefined;
  }

  const status = DOMAIN_ERROR_STATUS[code];
  return status === undefined ? undefined : { status, code };
}

function writeFailure(response: ServerResponse, requestId: string, error: unknown): void {
  if (error instanceof HttpError) {
    if (error.status === 401) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="credit-trade-sandbox"');
    }
    if (error.status >= 400 && error.status < 500) {
      response.setHeader("Connection", "close");
    }
    writeJson(response, requestId, error.status, {
      sandbox: true,
      error: { code: error.code, message: error.message },
      requestId,
    });
    return;
  }

  const domainFailure = safeDomainFailure(error);
  if (domainFailure !== undefined) {
    if (domainFailure.status === 401) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="credit-trade-sandbox"');
    }
    writeJson(response, requestId, domainFailure.status, {
      sandbox: true,
      error: { code: domainFailure.code, message: "The sandbox request was rejected" },
      requestId,
    });
    return;
  }

  writeJson(response, requestId, 500, {
    sandbox: true,
    error: { code: "INTERNAL_ERROR", message: "The sandbox request failed" },
    requestId,
  });
}

function assertJsonContentType(request: IncomingMessage): void {
  const contentEncoding = request.headers["content-encoding"];
  if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== "identity") {
    request.resume();
    throw new HttpError(415, "UNSUPPORTED_CONTENT_ENCODING", "Compressed request bodies are not accepted");
  }

  const contentType = request.headers["content-type"];
  if (contentType === undefined || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    request.resume();
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
}

async function readJsonObject(request: IncomingMessage): Promise<JsonObject> {
  assertJsonContentType(request);

  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new HttpError(400, "INVALID_CONTENT_LENGTH", "Content-Length is invalid");
    }
    if (declaredLength > MAX_JSON_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, "REQUEST_BODY_TOO_LARGE", "JSON body exceeds 64 KiB");
    }
  }

  const chunks: Buffer[] = [];
  let received = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > MAX_JSON_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) {
      chunks.push(bytes);
    }
  }

  if (tooLarge) {
    throw new HttpError(413, "REQUEST_BODY_TOO_LARGE", "JSON body exceeds 64 KiB");
  }
  if (received === 0) {
    throw new HttpError(400, "EMPTY_JSON_BODY", "A JSON object is required");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid UTF-8 JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "INVALID_JSON_OBJECT", "Request body must be a JSON object");
  }
  return parsed as JsonObject;
}

function requiredString(
  input: JsonObject,
  field: string,
  options: { allowOuterWhitespace?: boolean; maxLength?: number; pattern?: RegExp } = {},
): string {
  const value = input[field];
  const maxLength = options.maxLength ?? MAX_TEXT_LENGTH;
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || (options.allowOuterWhitespace === true ? value.trim().length === 0 : value.trim() !== value)
    || (options.pattern !== undefined && !options.pattern.test(value))
  ) {
    throw new HttpError(400, "INVALID_INPUT", `${field} is invalid`);
  }
  return value;
}

function optionalString(input: JsonObject, field: string): string | undefined {
  if (input[field] === undefined) {
    return undefined;
  }
  return requiredString(input, field);
}

function decimalInteger(input: JsonObject, field: string): string {
  return requiredString(input, field, { maxLength: 30, pattern: DECIMAL_INTEGER });
}

function bearerToken(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (header === undefined) {
    throw new HttpError(401, "AUTHENTICATION_REQUIRED", "A Bearer API key is required");
  }

  const match = /^Bearer ([^\s]{8,512})$/.exec(header);
  if (match === null || match[1] === undefined) {
    throw new HttpError(401, "INVALID_AUTHORIZATION", "Authorization must contain one Bearer API key");
  }
  return match[1];
}

function idempotencyKey(request: IncomingMessage): string {
  const header = request.headers["idempotency-key"];
  if (typeof header !== "string" || !IDENTIFIER.test(header)) {
    throw new HttpError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key is required and invalid");
  }
  return header;
}

function supplierIdFromPath(pathname: string): string | undefined {
  const match = /^\/sandbox\/suppliers\/([^/]+)\/endpoints$/.exec(pathname);
  if (match === null || match[1] === undefined) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    throw new HttpError(400, "INVALID_SUPPLIER_ID", "Supplier ID is invalid");
  }
  if (!IDENTIFIER.test(decoded)) {
    throw new HttpError(400, "INVALID_SUPPLIER_ID", "Supplier ID is invalid");
  }
  return decoded;
}

function redactSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSnapshot);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const redacted: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:api.?key(?:hash)?|credential(?:secret)?ref|secret|authorizationHeader|prompt)$/i.test(key)) {
      continue;
    }
    redacted[key] = redactSnapshot(nested);
  }
  return redacted;
}

function oneTimeBuyerCredential(value: unknown): { buyer: JsonObject; apiKey: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Sandbox buyer creation returned an invalid result");
  }

  const apiKey = Reflect.get(value, "apiKey");
  if (typeof apiKey !== "string" || apiKey.length < 8) {
    throw new Error("Sandbox buyer creation did not return a one-time API key");
  }

  const nestedBuyer = Reflect.get(value, "buyer");
  if (typeof nestedBuyer === "object" && nestedBuyer !== null && !Array.isArray(nestedBuyer)) {
    return { buyer: redactSnapshot(nestedBuyer) as JsonObject, apiKey };
  }

  const buyer: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key !== "apiKey") {
      buyer[key] = nested;
    }
  }
  return { buyer: redactSnapshot(buyer) as JsonObject, apiKey };
}

async function routeRequest(
  marketplace: SandboxMarketplace,
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
): Promise<void> {
  const method = request.method ?? "GET";
  const rawUrl = request.url ?? "/";
  if (!rawUrl.startsWith("/")) {
    throw new HttpError(400, "INVALID_REQUEST_TARGET", "Request target is invalid");
  }

  const url = new URL(rawUrl, "http://sandbox.invalid");
  if (url.search.length !== 0) {
    throw new HttpError(400, "QUERY_NOT_SUPPORTED", "Query parameters are not supported");
  }

  if (method === "GET" && url.pathname === "/health") {
    writeJson(response, requestId, 200, {
      sandbox: true,
      status: "ok",
      productionPaymentsEnabled: false,
      bindPolicy: "loopback-only",
    });
    return;
  }

  if (method === "POST" && url.pathname === "/sandbox/suppliers") {
    const body = await readJsonObject(request);
    const supplier = await marketplace.createSupplier({ name: requiredString(body, "name") });
    success(response, requestId, 201, supplier);
    return;
  }

  const supplierId = supplierIdFromPath(url.pathname);
  if (method === "POST" && supplierId !== undefined) {
    const body = await readJsonObject(request);
    const declaredVendor = optionalString(body, "declaredVendor");
    const endpoint = await marketplace.registerEndpoint({
      supplierId,
      url: requiredString(body, "url", { maxLength: 2_048 }),
      ...(declaredVendor === undefined ? {} : { declaredVendor }),
    });
    const price = await marketplace.setModelPrice({
      supplierId,
      endpointId: endpoint.endpointId,
      model: requiredString(body, "model"),
      currency: requiredString(body, "currency", { maxLength: 3, pattern: /^[A-Z]{3}$/ }),
      inputTokenPriceMinor: decimalInteger(body, "inputTokenPriceMinor"),
      outputTokenPriceMinor: decimalInteger(body, "outputTokenPriceMinor"),
    });
    success(response, requestId, 201, { endpoint, price });
    return;
  }

  if (method === "POST" && url.pathname === "/sandbox/buyers") {
    const body = await readJsonObject(request);
    const buyer = await marketplace.createBuyer({
      name: requiredString(body, "name"),
      currency: requiredString(body, "currency", { maxLength: 3, pattern: /^[A-Z]{3}$/ }),
      initialBalanceMinor: decimalInteger(body, "initialBalanceMinor"),
    });
    success(response, requestId, 201, oneTimeBuyerCredential(buyer));
    return;
  }

  if (method === "POST" && url.pathname === "/v1/quotes") {
    const apiKey = bearerToken(request);
    const body = await readJsonObject(request);
    const quote = await marketplace.createQuote({
      apiKey,
      supplierId: requiredString(body, "supplierId", { pattern: IDENTIFIER }),
      endpointId: requiredString(body, "endpointId", { pattern: IDENTIFIER }),
      model: requiredString(body, "model"),
      maxInputTokens: decimalInteger(body, "maxInputTokens"),
      maxOutputTokens: decimalInteger(body, "maxOutputTokens"),
    });
    success(response, requestId, 201, quote);
    return;
  }

  if (method === "POST" && url.pathname === "/v1/inference") {
    const apiKey = bearerToken(request);
    const replayKey = idempotencyKey(request);
    const body = await readJsonObject(request);
    const inference = await marketplace.infer({
      apiKey,
      quoteId: requiredString(body, "quoteId", { pattern: IDENTIFIER }),
      prompt: requiredString(body, "prompt", { allowOuterWhitespace: true, maxLength: MAX_PROMPT_LENGTH }),
      idempotencyKey: replayKey,
    });
    success(response, requestId, 200, inference);
    return;
  }

  if (method === "GET" && url.pathname === "/sandbox/state") {
    success(response, requestId, 200, redactSnapshot(await marketplace.getState()));
    return;
  }

  if (method === "GET" && url.pathname === "/sandbox/ledger") {
    success(response, requestId, 200, redactSnapshot(await marketplace.getLedger()));
    return;
  }

  throw new HttpError(404, "NOT_FOUND", "Route not found");
}

export function createApiServer(
  marketplace: SandboxMarketplace = new SandboxMarketplace(),
): Server {
  const server = createServer((request, response) => {
    const requestId = crypto.randomUUID();
    void routeRequest(marketplace, request, response, requestId).catch((error: unknown) => {
      writeFailure(response, requestId, error);
    });
  });

  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    }
  });

  return server;
}

export const apiLimits = Object.freeze({ maxJsonBodyBytes: MAX_JSON_BODY_BYTES });
