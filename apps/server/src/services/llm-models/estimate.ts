/**
 * Pre-call cost estimate for an LLM dispatch — the figure booked as a budget
 * hold before the call goes out (see cost-tracker `reserveProviderBudget`).
 *
 * The call's real cost is only known from provider usage AFTER it returns, so
 * this is deliberately an upper-ish estimate, not a bound:
 *   - input: ~3 chars/token (pessimistic vs. the usual ~4), plus the tool /
 *     response-schema JSON that rides along, plus a flat allowance per image;
 *   - output: the caller's `maxTokens` when given (a true ceiling for the
 *     billed output), else a modest default. With no `maxTokens`, a very long
 *     completion or hidden reasoning tokens can still exceed the hold — the
 *     actual cost is recorded afterwards either way, so the cap still bites on
 *     the *next* call. Cached-input discounts are ignored (worst case).
 */
import type { LlmModelConfig } from './types';

/** Structural subset of LlmDispatchInput (avoids importing the heavy dispatcher). */
export interface LlmEstimateInput {
  messages: Array<{
    content:
      | string
      | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: unknown }>;
  }>;
  maxTokens?: number;
  tools?: unknown;
  responseSchema?: unknown;
}

const CHARS_PER_TOKEN = 3;
/** Roughly a high-detail image on the common providers. */
export const IMAGE_TOKEN_ALLOWANCE = 1500;
/** Output assumed when the caller sets no `maxTokens`. */
export const DEFAULT_OUTPUT_TOKEN_ESTIMATE = 2048;

export function estimateLlmInputTokens(input: LlmEstimateInput): number {
  let chars = 0;
  let images = 0;
  for (const m of input.messages) {
    if (typeof m.content === 'string') {
      chars += m.content.length;
      continue;
    }
    for (const part of m.content) {
      if (part.type === 'text') chars += part.text.length;
      else images += 1;
    }
  }
  if (input.tools) chars += JSON.stringify(input.tools).length;
  if (input.responseSchema) chars += JSON.stringify(input.responseSchema).length;
  return Math.ceil(chars / CHARS_PER_TOKEN) + images * IMAGE_TOKEN_ALLOWANCE;
}

export function estimateLlmCostUsd(
  model: Pick<
    LlmModelConfig,
    'providerInputUsdPerMtok' | 'providerOutputUsdPerMtok' | 'maxOutputTokens'
  >,
  input: LlmEstimateInput
): number {
  const inputTokens = estimateLlmInputTokens(input);
  const requested = input.maxTokens ?? DEFAULT_OUTPUT_TOKEN_ESTIMATE;
  const outputTokens = model.maxOutputTokens
    ? Math.min(requested, model.maxOutputTokens)
    : requested;
  return (
    (inputTokens / 1_000_000) * model.providerInputUsdPerMtok +
    (outputTokens / 1_000_000) * model.providerOutputUsdPerMtok
  );
}
