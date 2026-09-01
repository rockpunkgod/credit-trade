import { Buffer } from "node:buffer";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { DomainError } from "../errors.ts";

export const INTEGRITY_SCHEME = "CT-HMAC-SHA256-V1" as const;

export type IntegrityPurpose =
  | "SUPPLIER_ACCOUNT"
  | "BUYER_ACCOUNT"
  | "PROVIDER_ENDPOINT"
  | "SUPPLY_PRICE"
  | "PLATFORM_FEE_POLICY"
  | "QUOTE_POLICY"
  | "USAGE_RECORD"
  | "RATING_RECORD"
  | "LEDGER_CHECKPOINT"
  | "SETTLEMENT_RECORD";

export type IntegrityAuthenticationCode = Readonly<{
  scheme: typeof INTEGRITY_SCHEME;
  keyId: string;
  authenticationTag: string;
}>;

export type IntegrityScope = Readonly<{
  environmentId: string;
  marketId: string;
  currency: string;
  buyerId: string;
  supplierId: string;
  endpointId: string;
  quoteId: string;
  inferenceId: string | null;
}>;

export type IntegrityChainLink = Readonly<{
  streamId: string;
  sequence: string;
  previousSealDigest: string | null;
}>;

export type IntegrityStatement = Readonly<{
  purpose: IntegrityPurpose;
  scope: IntegrityScope;
  subjectId: string;
  contentDigest: string;
  parentSealDigests: readonly string[];
  authenticatedAt: string;
  chain: IntegrityChainLink | null;
}>;

export type IntegritySeal = Readonly<IntegrityStatement & {
  scheme: typeof INTEGRITY_SCHEME;
  keyId: string;
  authenticationTag: string;
}>;

export type HmacIntegrityKeyInput = Readonly<{
  keyId: string;
  keyMaterial: Uint8Array;
}>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const DECIMAL = /^(0|[1-9]\d{0,29})$/;
const AUTHENTICATION_TAG = /^[A-Za-z0-9_-]{43}$/;
const PURPOSES = Object.freeze([
  "SUPPLIER_ACCOUNT",
  "BUYER_ACCOUNT",
  "PROVIDER_ENDPOINT",
  "SUPPLY_PRICE",
  "PLATFORM_FEE_POLICY",
  "QUOTE_POLICY",
  "USAGE_RECORD",
  "RATING_RECORD",
  "LEDGER_CHECKPOINT",
  "SETTLEMENT_RECORD",
] as const);
const MAX_FRAME_PARTS = 2_048;
const MAX_FRAME_PART_BYTES = 128 * 1_024;
const MAX_FRAME_TOTAL_BYTES = 2 * 1_024 * 1_024;

function integrityFailure(): DomainError {
  return new DomainError("INTEGRITY_PROOF_INVALID", "authenticated integrity verification failed");
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const following = value.charCodeAt(index + 1);
      if (!(following >= 0xDC00 && following <= 0xDFFF)) {
        return false;
      }
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function requireText(value: unknown, field: string, maximum = 128): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || !isWellFormedUnicode(value)
  ) {
    throw integrityFailure();
  }
  return value;
}

function requireIdentifier(value: unknown, field: string): string {
  const candidate = requireText(value, field);
  if (!IDENTIFIER.test(candidate)) {
    throw integrityFailure();
  }
  return candidate;
}

function requireDigest(value: unknown): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw integrityFailure();
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  const candidate = requireText(value, "authenticatedAt", 64);
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== candidate) {
    throw integrityFailure();
  }
  return candidate;
}

function assertExactKeys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw integrityFailure();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw integrityFailure();
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw integrityFailure();
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw integrityFailure();
    }
  }
}

function normalizeScope(value: unknown): IntegrityScope {
  assertExactKeys(value, [
    "environmentId",
    "marketId",
    "currency",
    "buyerId",
    "supplierId",
    "endpointId",
    "quoteId",
    "inferenceId",
  ]);
  const currency = requireText(value.currency, "currency", 3);
  if (!CURRENCY.test(currency)) {
    throw integrityFailure();
  }
  const inferenceId = value.inferenceId === null
    ? null
    : requireIdentifier(value.inferenceId, "inferenceId");
  return Object.freeze({
    environmentId: requireIdentifier(value.environmentId, "environmentId"),
    marketId: requireIdentifier(value.marketId, "marketId"),
    currency,
    buyerId: requireIdentifier(value.buyerId, "buyerId"),
    supplierId: requireIdentifier(value.supplierId, "supplierId"),
    endpointId: requireIdentifier(value.endpointId, "endpointId"),
    quoteId: requireIdentifier(value.quoteId, "quoteId"),
    inferenceId,
  });
}

function normalizeChain(value: unknown): IntegrityChainLink | null {
  if (value === null) {
    return null;
  }
  assertExactKeys(value, ["streamId", "sequence", "previousSealDigest"]);
  const sequence = requireText(value.sequence, "sequence", 30);
  if (!DECIMAL.test(sequence) || sequence === "0") {
    throw integrityFailure();
  }
  return Object.freeze({
    streamId: requireIdentifier(value.streamId, "streamId"),
    sequence,
    previousSealDigest: value.previousSealDigest === null
      ? null
      : requireDigest(value.previousSealDigest),
  });
}

function normalizeStatement(value: unknown): IntegrityStatement {
  assertExactKeys(value, [
    "purpose",
    "scope",
    "subjectId",
    "contentDigest",
    "parentSealDigests",
    "authenticatedAt",
    "chain",
  ]);
  if (typeof value.purpose !== "string" || !PURPOSES.includes(value.purpose as IntegrityPurpose)) {
    throw integrityFailure();
  }
  if (!Array.isArray(value.parentSealDigests) || value.parentSealDigests.length > 8) {
    throw integrityFailure();
  }
  const parentSealDigests = value.parentSealDigests.map((digest) => requireDigest(digest));
  if (new Set(parentSealDigests).size !== parentSealDigests.length) {
    throw integrityFailure();
  }
  return Object.freeze({
    purpose: value.purpose as IntegrityPurpose,
    scope: normalizeScope(value.scope),
    subjectId: requireIdentifier(value.subjectId, "subjectId"),
    contentDigest: requireDigest(value.contentDigest),
    parentSealDigests: Object.freeze(parentSealDigests),
    authenticatedAt: requireTimestamp(value.authenticatedAt),
    chain: normalizeChain(value.chain),
  });
}

function normalizeSeal(value: unknown): IntegritySeal {
  assertExactKeys(value, [
    "scheme",
    "keyId",
    "purpose",
    "scope",
    "subjectId",
    "contentDigest",
    "parentSealDigests",
    "authenticatedAt",
    "chain",
    "authenticationTag",
  ]);
  if (value.scheme !== INTEGRITY_SCHEME) {
    throw integrityFailure();
  }
  const statement = normalizeStatement({
    purpose: value.purpose,
    scope: value.scope,
    subjectId: value.subjectId,
    contentDigest: value.contentDigest,
    parentSealDigests: value.parentSealDigests,
    authenticatedAt: value.authenticatedAt,
    chain: value.chain,
  });
  if (typeof value.authenticationTag !== "string" || !AUTHENTICATION_TAG.test(value.authenticationTag)) {
    throw integrityFailure();
  }
  const decoded = Buffer.from(value.authenticationTag, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value.authenticationTag) {
    throw integrityFailure();
  }
  return Object.freeze({
    scheme: INTEGRITY_SCHEME,
    keyId: requireIdentifier(value.keyId, "keyId"),
    ...statement,
    authenticationTag: value.authenticationTag,
  });
}

function framed(parts: readonly string[]): Buffer {
  if (parts.length > MAX_FRAME_PARTS) {
    throw integrityFailure();
  }
  let totalBytes = 0;
  const encoded = parts.map((part) => {
    if (typeof part !== "string" || !isWellFormedUnicode(part)) {
      throw integrityFailure();
    }
    const bytes = Buffer.from(part, "utf8");
    if (bytes.length > MAX_FRAME_PART_BYTES) {
      throw integrityFailure();
    }
    totalBytes += bytes.length + 4;
    if (totalBytes > MAX_FRAME_TOTAL_BYTES) {
      throw integrityFailure();
    }
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    return [length, bytes] as const;
  });
  const count = Buffer.allocUnsafe(4);
  count.writeUInt32BE(parts.length);
  return Buffer.concat([
    Buffer.from("CT-LENGTH-PREFIXED-UTF8-V1\0", "ascii"),
    count,
    ...encoded.flat(),
  ]);
}

function statementParts(
  statement: IntegrityStatement,
  scheme: typeof INTEGRITY_SCHEME,
  keyId: string,
): readonly string[] {
  const chain = statement.chain;
  return Object.freeze([
    "credit-trade-integrity",
    "1",
    scheme,
    keyId,
    statement.purpose,
    statement.scope.environmentId,
    statement.scope.marketId,
    statement.scope.currency,
    statement.scope.buyerId,
    statement.scope.supplierId,
    statement.scope.endpointId,
    statement.scope.quoteId,
    statement.scope.inferenceId === null ? "0" : "1",
    statement.scope.inferenceId ?? "",
    statement.subjectId,
    statement.contentDigest,
    statement.authenticatedAt,
    statement.parentSealDigests.length.toString(),
    ...statement.parentSealDigests,
    chain === null ? "0" : "1",
    chain?.streamId ?? "",
    chain?.sequence ?? "",
    chain?.previousSealDigest === null || chain === null ? "0" : "1",
    chain?.previousSealDigest ?? "",
  ]);
}

function authenticationBytes(
  statement: IntegrityStatement,
  keyId: string,
): Buffer {
  return framed(statementParts(statement, INTEGRITY_SCHEME, keyId));
}

function normalizeAuthenticationCode(value: unknown): IntegrityAuthenticationCode {
  assertExactKeys(value, ["scheme", "keyId", "authenticationTag"]);
  if (value.scheme !== INTEGRITY_SCHEME) {
    throw integrityFailure();
  }
  if (typeof value.authenticationTag !== "string" || !AUTHENTICATION_TAG.test(value.authenticationTag)) {
    throw integrityFailure();
  }
  const decoded = Buffer.from(value.authenticationTag, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value.authenticationTag) {
    throw integrityFailure();
  }
  return Object.freeze({
    scheme: INTEGRITY_SCHEME,
    keyId: requireIdentifier(value.keyId, "keyId"),
    authenticationTag: value.authenticationTag,
  });
}

function authenticationCodeBytes(domain: string, keyId: string, parts: readonly string[]): Buffer {
  const normalizedDomain = requireIdentifier(domain, "domain");
  if (!Array.isArray(parts)) {
    throw integrityFailure();
  }
  return framed([
    "credit-trade-authentication-code",
    "1",
    INTEGRITY_SCHEME,
    keyId,
    normalizedDomain,
    parts.length.toString(),
    ...parts,
  ]);
}

export function digestIntegrityContent(domain: string, parts: readonly string[]): string {
  const normalizedDomain = requireIdentifier(domain, "domain");
  if (!Array.isArray(parts)) {
    throw integrityFailure();
  }
  return createHash("sha256")
    .update(framed([
      "credit-trade-content-digest",
      "1",
      normalizedDomain,
      parts.length.toString(),
      ...parts,
    ]))
    .digest("hex");
}

export function integritySealDigest(value: IntegritySeal): string {
  const seal = normalizeSeal(value);
  return createHash("sha256")
    .update(framed([
      "credit-trade-integrity-seal-digest",
      "1",
      ...statementParts(seal, seal.scheme, seal.keyId),
      seal.authenticationTag,
    ]))
    .digest("hex");
}

export class HmacIntegrityKeyring {
  readonly #keys: Map<string, Buffer>;
  #activeKeyId: string;

  constructor(input: { activeKeyId: string; keys: readonly HmacIntegrityKeyInput[] }) {
    const activeKeyId = requireIdentifier(input.activeKeyId, "activeKeyId");
    if (!Array.isArray(input.keys) || input.keys.length === 0 || input.keys.length > 16) {
      throw new DomainError("INTEGRITY_KEY_INVALID", "integrity key configuration is invalid");
    }
    const keys = new Map<string, Buffer>();
    for (const candidate of input.keys) {
      const keyId = requireIdentifier(candidate.keyId, "keyId");
      if (!(candidate.keyMaterial instanceof Uint8Array)) {
        throw new DomainError("INTEGRITY_KEY_INVALID", "integrity key configuration is invalid");
      }
      const material = Buffer.from(candidate.keyMaterial);
      if (material.length < 32 || material.length > 128 || keys.has(keyId)) {
        material.fill(0);
        throw new DomainError("INTEGRITY_KEY_INVALID", "integrity key configuration is invalid");
      }
      keys.set(keyId, material);
    }
    if (!keys.has(activeKeyId)) {
      for (const material of keys.values()) {
        material.fill(0);
      }
      throw new DomainError("INTEGRITY_KEY_INVALID", "active integrity key was not found");
    }
    this.#keys = keys;
    this.#activeKeyId = activeKeyId;
  }

  seal(value: IntegrityStatement): IntegritySeal {
    const statement = normalizeStatement(value);
    const key = this.#keys.get(this.#activeKeyId);
    if (key === undefined) {
      throw new DomainError("INTEGRITY_KEY_UNAVAILABLE", "active integrity key is unavailable");
    }
    const authenticationTag = createHmac("sha256", key)
      .update(authenticationBytes(statement, this.#activeKeyId))
      .digest("base64url");
    return Object.freeze({
      scheme: INTEGRITY_SCHEME,
      keyId: this.#activeKeyId,
      ...statement,
      authenticationTag,
    });
  }

  assertValid(value: IntegritySeal, expectedValue: IntegrityStatement): IntegritySeal {
    const seal = normalizeSeal(value);
    const expected = normalizeStatement(expectedValue);
    const key = this.#keys.get(seal.keyId);
    if (key === undefined) {
      throw integrityFailure();
    }
    const actualMessage = authenticationBytes(seal, seal.keyId);
    const expectedMessage = authenticationBytes(expected, seal.keyId);
    const presentedTag = Buffer.from(seal.authenticationTag, "base64url");
    const expectedTag = createHmac("sha256", key).update(expectedMessage).digest();
    const messageMatches = actualMessage.equals(expectedMessage);
    const tagMatches = presentedTag.length === expectedTag.length
      && timingSafeEqual(presentedTag, expectedTag);
    if (!messageMatches || !tagMatches) {
      throw integrityFailure();
    }
    return seal;
  }

  authenticate(domain: string, parts: readonly string[]): IntegrityAuthenticationCode {
    const key = this.#keys.get(this.#activeKeyId);
    if (key === undefined) {
      throw new DomainError("INTEGRITY_KEY_UNAVAILABLE", "active integrity key is unavailable");
    }
    const authenticationTag = createHmac("sha256", key)
      .update(authenticationCodeBytes(domain, this.#activeKeyId, parts))
      .digest("base64url");
    return Object.freeze({
      scheme: INTEGRITY_SCHEME,
      keyId: this.#activeKeyId,
      authenticationTag,
    });
  }

  assertAuthenticationCode(
    value: IntegrityAuthenticationCode,
    domain: string,
    parts: readonly string[],
  ): IntegrityAuthenticationCode {
    const code = normalizeAuthenticationCode(value);
    const key = this.#keys.get(code.keyId);
    if (key === undefined) {
      throw integrityFailure();
    }
    const presentedTag = Buffer.from(code.authenticationTag, "base64url");
    const expectedTag = createHmac("sha256", key)
      .update(authenticationCodeBytes(domain, code.keyId, parts))
      .digest();
    if (presentedTag.length !== expectedTag.length || !timingSafeEqual(presentedTag, expectedTag)) {
      throw integrityFailure();
    }
    return code;
  }

  rotateActiveKey(keyId: string): void {
    const candidate = requireIdentifier(keyId, "keyId");
    if (!this.#keys.has(candidate)) {
      throw new DomainError("INTEGRITY_KEY_INVALID", "integrity key configuration is invalid");
    }
    this.#activeKeyId = candidate;
  }
}

export function createEphemeralHmacIntegrityKeyring(): HmacIntegrityKeyring {
  const keyId = `sandbox-ephemeral-${randomUUID()}`;
  const keyMaterial = randomBytes(32);
  try {
    return new HmacIntegrityKeyring({ activeKeyId: keyId, keys: [{ keyId, keyMaterial }] });
  } finally {
    keyMaterial.fill(0);
  }
}
