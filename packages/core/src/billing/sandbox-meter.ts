import { Buffer } from "node:buffer";

import { DomainError } from "../errors.ts";
import { createMeterQuantities, createUsageRecord } from "./calculator.ts";
import type { UsageRecord } from "./contracts.ts";

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} must be a string`, { field });
  }
  return value;
}

function tokenLimit(value: unknown, field: string): bigint {
  const quantities = createMeterQuantities({ INPUT_TOKENS: value as string });
  return BigInt(quantities.INPUT_TOKENS);
}

export function estimateTextTokens(value: string): string {
  const text = requireText(value, "text");
  const bytes = BigInt(Buffer.byteLength(text, "utf8"));
  return (bytes === 0n ? 0n : (bytes + 3n) / 4n).toString();
}

export function truncateTextToEstimatedTokenLimit(value: string, maximumTokens: string): string {
  const text = requireText(value, "text");
  const limit = tokenLimit(maximumTokens, "maximumTokens");
  if (limit === 0n || text.length === 0) {
    return "";
  }
  const maximumBytes = limit * 4n;
  if (BigInt(Buffer.byteLength(text, "utf8")) <= maximumBytes) {
    return text;
  }
  let usedBytes = 0n;
  let delivered = "";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of segmenter.segment(text)) {
    const segmentBytes = BigInt(Buffer.byteLength(segment, "utf8"));
    if (usedBytes + segmentBytes > maximumBytes) {
      break;
    }
    delivered += segment;
    usedBytes += segmentBytes;
  }
  return delivered;
}

export function meterSandboxText(input: {
  usageRecordId: string;
  inferenceId: string;
  quoteId: string;
  inputText: string;
  generatedOutput: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  createdAt: string;
}): Readonly<{ deliveredOutput: string; usageRecord: UsageRecord }> {
  const inputText = requireText(input.inputText, "inputText");
  const generatedOutput = requireText(input.generatedOutput, "generatedOutput");
  const limits = createMeterQuantities({
    INPUT_TOKENS: input.maxInputTokens,
    OUTPUT_TOKENS: input.maxOutputTokens,
  });
  const inputTokens = estimateTextTokens(inputText);
  if (BigInt(inputTokens) > BigInt(limits.INPUT_TOKENS)) {
    throw new DomainError("USAGE_LIMIT_EXCEEDED", "input usage exceeds the immutable quote limit", {
      dimension: "INPUT_TOKENS",
    });
  }
  const deliveredOutput = truncateTextToEstimatedTokenLimit(
    generatedOutput,
    limits.OUTPUT_TOKENS,
  );
  const usageRecord = createUsageRecord({
    usageRecordId: input.usageRecordId,
    inferenceId: input.inferenceId,
    quoteId: input.quoteId,
    source: "SANDBOX_ESTIMATE",
    finality: "FINAL",
    outcome: "SUCCEEDED",
    quantities: {
      INPUT_TOKENS: inputTokens,
      OUTPUT_TOKENS: estimateTextTokens(deliveredOutput),
      CACHE_READ_TOKENS: "0",
      CACHE_WRITE_TOKENS: "0",
      TOOL_CALLS: "0",
      REQUESTS: "1",
    },
    createdAt: input.createdAt,
  });
  return Object.freeze({ deliveredOutput, usageRecord });
}
