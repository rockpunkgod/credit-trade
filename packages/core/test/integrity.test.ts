import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  HmacIntegrityKeyring,
  INTEGRITY_SCHEME,
  digestIntegrityContent,
  integritySealDigest,
  type IntegritySeal,
  type IntegrityStatement,
} from "../src/billing/index.ts";
import { DomainError } from "../src/errors.ts";

const FIXED_TIME = "2026-09-01T00:00:00.000Z";
const FIRST_KEY = Buffer.alloc(32, 0x11);
const SECOND_KEY = Buffer.alloc(32, 0x22);

function keyring(activeKeyId = "key-one"): HmacIntegrityKeyring {
  return new HmacIntegrityKeyring({
    activeKeyId,
    keys: [
      { keyId: "key-one", keyMaterial: FIRST_KEY },
      { keyId: "key-two", keyMaterial: SECOND_KEY },
    ],
  });
}

function statement(overrides: Partial<IntegrityStatement> = {}): IntegrityStatement {
  return {
    purpose: "USAGE_RECORD",
    scope: {
      environmentId: "sandbox",
      marketId: "market-neutral",
      currency: "USD",
      buyerId: "buyer_test",
      supplierId: "supplier_test",
      endpointId: "endpoint_test",
      quoteId: "quote_test",
      inferenceId: "inference_test",
    },
    subjectId: "usage_test",
    contentDigest: digestIntegrityContent("TEST_USAGE", ["1", "2"]),
    parentSealDigests: [],
    authenticatedAt: FIXED_TIME,
    chain: null,
    ...overrides,
  };
}

function isIntegrityFailure(error: unknown): boolean {
  return error instanceof DomainError && error.code === "INTEGRITY_PROOF_INVALID";
}

test("HMAC seals are deterministic, domain-separated and contain no key material", () => {
  const ring = keyring();
  const expected = statement();
  const first = ring.seal(expected);
  const second = ring.seal(expected);
  assert.deepEqual(first, second);
  assert.equal(first.scheme, INTEGRITY_SCHEME);
  assert.equal(first.authenticationTag.length, 43);
  assert.match(first.authenticationTag, /^[A-Za-z0-9_-]{43}$/);
  assert.match(integritySealDigest(first), /^[a-f0-9]{64}$/);
  assert.deepEqual(ring.assertValid(first, expected), first);

  const rating = ring.seal(statement({ purpose: "RATING_RECORD", subjectId: "rating_test" }));
  assert.notEqual(rating.authenticationTag, first.authenticationTag);
  const serialized = JSON.stringify(ring);
  assert.equal(serialized, "{}");
  assert.doesNotMatch(serialized, new RegExp(FIRST_KEY.toString("base64url"), "i"));
});

test("verification uses caller-expected context and rejects cross-scope replacement", () => {
  const ring = keyring();
  const original = statement();
  const seal = ring.seal(original);
  const replacements: IntegrityStatement[] = [
    statement({ scope: { ...original.scope, buyerId: "buyer_other" } }),
    statement({ scope: { ...original.scope, supplierId: "supplier_other" } }),
    statement({ scope: { ...original.scope, quoteId: "quote_other" } }),
    statement({ scope: { ...original.scope, inferenceId: "inference_other" } }),
    statement({ scope: { ...original.scope, currency: "EUR" } }),
    statement({ contentDigest: digestIntegrityContent("TEST_USAGE", ["changed"]) }),
  ];
  for (const replacement of replacements) {
    assert.throws(() => ring.assertValid(seal, replacement), isIntegrityFailure);
  }
});

test("proof parser rejects downgrade, unknown fields and malformed base64url tags", () => {
  const ring = keyring();
  const expected = statement();
  const seal = ring.seal(expected);
  const malformed: unknown[] = [
    { ...seal, scheme: "SHA256" },
    { ...seal, keyId: "unknown-key" },
    { ...seal, unexpected: "field" },
    { ...seal, authenticationTag: "A".repeat(42) },
    { ...seal, authenticationTag: "A".repeat(44) },
    { ...seal, authenticationTag: `${seal.authenticationTag}=` },
    { ...seal, authenticationTag: `+${seal.authenticationTag.slice(1)}` },
    { ...seal, authenticationTag: "_".repeat(43) },
    { ...seal, scope: { ...seal.scope, unexpected: "field" } },
    { ...seal, parentSealDigests: ["0".repeat(64), "0".repeat(64)] },
  ];
  for (const candidate of malformed) {
    assert.throws(
      () => ring.assertValid(candidate as IntegritySeal, expected),
      isIntegrityFailure,
    );
  }
});

test("key rotation signs with the new key while retaining old-key verification", () => {
  const ring = keyring();
  const oldStatement = statement();
  const oldSeal = ring.seal(oldStatement);
  ring.rotateActiveKey("key-two");
  const newStatement = statement({
    subjectId: "usage_rotated",
    contentDigest: digestIntegrityContent("TEST_USAGE", ["rotated"]),
  });
  const newSeal = ring.seal(newStatement);
  assert.equal(oldSeal.keyId, "key-one");
  assert.equal(newSeal.keyId, "key-two");
  assert.deepEqual(ring.assertValid(oldSeal, oldStatement), oldSeal);
  assert.deepEqual(ring.assertValid(newSeal, newStatement), newSeal);
});

test("the same key ID with different key material cannot verify a seal", () => {
  const signer = new HmacIntegrityKeyring({
    activeKeyId: "shared-id",
    keys: [{ keyId: "shared-id", keyMaterial: FIRST_KEY }],
  });
  const verifier = new HmacIntegrityKeyring({
    activeKeyId: "shared-id",
    keys: [{ keyId: "shared-id", keyMaterial: SECOND_KEY }],
  });
  const expected = statement();
  assert.throws(() => verifier.assertValid(signer.seal(expected), expected), isIntegrityFailure);
});

test("content framing is unambiguous and rejects malformed Unicode", () => {
  assert.notEqual(
    digestIntegrityContent("TEST_DOMAIN", ["ab", "c"]),
    digestIntegrityContent("TEST_DOMAIN", ["a", "bc"]),
  );
  assert.notEqual(
    digestIntegrityContent("TEST_DOMAIN", ["same"]),
    digestIntegrityContent("OTHER_DOMAIN", ["same"]),
  );
  assert.notEqual(
    digestIntegrityContent("TEST_DOMAIN", ["é"]),
    digestIntegrityContent("TEST_DOMAIN", ["e\u0301"]),
  );
  assert.throws(
    () => digestIntegrityContent("TEST_DOMAIN", ["\uD800"]),
    isIntegrityFailure,
  );
});

test("key configuration rejects short, duplicate and missing active keys", () => {
  assert.throws(() => new HmacIntegrityKeyring({
    activeKeyId: "short",
    keys: [{ keyId: "short", keyMaterial: Buffer.alloc(31) }],
  }), DomainError);
  assert.throws(() => new HmacIntegrityKeyring({
    activeKeyId: "duplicate",
    keys: [
      { keyId: "duplicate", keyMaterial: FIRST_KEY },
      { keyId: "duplicate", keyMaterial: SECOND_KEY },
    ],
  }), DomainError);
  assert.throws(() => new HmacIntegrityKeyring({
    activeKeyId: "missing",
    keys: [{ keyId: "present", keyMaterial: FIRST_KEY }],
  }), DomainError);
});

test("opaque authentication codes hide request content and survive key rotation", () => {
  const ring = keyring();
  const parts = ["sandbox", "market-neutral", "buyer_test", "quote_test", "prompt secret"];
  const code = ring.authenticate("IDEMPOTENCY_REQUEST", parts);
  assert.deepEqual(
    ring.assertAuthenticationCode(code, "IDEMPOTENCY_REQUEST", parts),
    code,
  );
  assert.doesNotMatch(JSON.stringify(code), /prompt secret/);
  assert.throws(
    () => ring.assertAuthenticationCode(code, "IDEMPOTENCY_REQUEST", [...parts, "changed"]),
    isIntegrityFailure,
  );
  assert.throws(
    () => ring.assertAuthenticationCode({ ...code, unexpected: "field" } as never, "IDEMPOTENCY_REQUEST", parts),
    isIntegrityFailure,
  );
  ring.rotateActiveKey("key-two");
  assert.deepEqual(
    ring.assertAuthenticationCode(code, "IDEMPOTENCY_REQUEST", parts),
    code,
  );
  assert.equal(ring.authenticate("IDEMPOTENCY_REQUEST", parts).keyId, "key-two");
});
