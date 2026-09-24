/**
 * Pre-call cost estimate for a Gemini VLM call — the figure booked as a budget
 * hold before the call goes out (see cost-tracker `reserveProviderBudget`).
 *
 * Media is uploaded via the Files API, so its duration/size is not known here;
 * each file part gets a flat token allowance instead (~4 min of video at
 * Gemini's ~263 tokens/s). That makes this a HEURISTIC, not a bound: a longer
 * video can cost more than the hold. The real cost is recorded afterwards
 * either way, so the cap still bites on the next call.
 */

/** Files-API part (video/audio) — flat allowance, see above. */
export const VLM_FILE_TOKEN_ALLOWANCE = 60_000;
/** Inline (base64) image part. */
export const VLM_INLINE_IMAGE_TOKENS = 1_500;
/** Structured-JSON extractions run long; assume a generous output. */
export const VLM_OUTPUT_TOKEN_ESTIMATE = 8_192;

const CHARS_PER_TOKEN = 3;

export interface VlmEstimateInput {
  prompt: string;
  system?: string;
  media?: Array<{ fileData: unknown } | { inlineData: unknown }>;
}

export function estimateVlmCostUsd(
  input: VlmEstimateInput,
  usdPerMtokIn: number,
  usdPerMtokOut: number
): number {
  let inputTokens = Math.ceil(
    ((input.prompt?.length ?? 0) + (input.system?.length ?? 0)) / CHARS_PER_TOKEN
  );
  for (const part of input.media ?? []) {
    inputTokens += 'fileData' in part ? VLM_FILE_TOKEN_ALLOWANCE : VLM_INLINE_IMAGE_TOKENS;
  }
  return (
    (inputTokens / 1_000_000) * usdPerMtokIn +
    (VLM_OUTPUT_TOKEN_ESTIMATE / 1_000_000) * usdPerMtokOut
  );
}
