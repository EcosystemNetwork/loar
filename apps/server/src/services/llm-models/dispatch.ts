/**
 * LLM dispatcher — normalizes chat completion across every supported
 * provider to a single shape.
 *
 * Each provider exposes a chat-completions surface (OpenAI-compatible for
 * most; Gemini is the outlier — not yet wired here). The dispatcher picks
 * the model row from the registry, resolves a BYOK or server-pool key,
 * and forwards the call.
 */
import { TRPCError } from '@trpc/server';
import { resolveProviderKey } from '../../lib/byok';
import { withProviderRateLimit } from '../../lib/rate-limit';
import { redactSecrets } from '../../lib/redact-secrets';
import { sanitizePrompt } from '../../lib/prompt-sanitize';
import { getLlmModelById } from './registry';
import type { LlmModelConfig } from './types';
import {
  recordProviderCost,
  assertProviderAllowed,
  ProviderPausedError,
  CostCapExceededError,
  llmFallbackHopTotal,
  providerCallFailureTotal,
  type CostProvider,
  type CostKind,
} from '../cost-tracker';

function classifyDispatchError(
  err: unknown
): 'paused' | 'cap' | 'rate_limit' | 'timeout' | 'auth' | 'bad_request' | 'other' {
  if (err instanceof ProviderPausedError) return 'paused';
  if (err instanceof CostCapExceededError) return 'cap';
  if (err instanceof TRPCError) {
    if (err.code === 'TOO_MANY_REQUESTS') return 'rate_limit';
    if (err.code === 'TIMEOUT') return 'timeout';
    if (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN') return 'auth';
    if (err.code === 'BAD_REQUEST') return 'bad_request';
    return 'other';
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit')) return 'rate_limit';
    if (msg.includes('timeout') || msg.includes('etimedout')) return 'timeout';
    if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid api key'))
      return 'auth';
  }
  return 'other';
}

// LlmModelConfig.provider → CostProvider for the ledger.
function costProviderFor(p: LlmModelConfig['provider']): CostProvider {
  switch (p) {
    case 'openai':
      return 'openai';
    case 'google':
      return 'gemini';
    case 'zai':
      return 'zai';
    case 'bytedance':
      return 'bytedance';
    case 'groq':
      return 'groq';
    case 'anthropic-via-aai':
      return 'other';
  }
}

function computeCostUsd(
  model: LlmModelConfig,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number
): number {
  // Cached input is billed at the discounted rate; the rest at full input rate.
  const billedInput = Math.max(0, inputTokens - cachedInputTokens);
  const inputUsd = (billedInput / 1_000_000) * model.providerInputUsdPerMtok;
  const cachedUsd = (cachedInputTokens / 1_000_000) * model.providerCachedInputUsdPerMtok;
  const outputUsd = (outputTokens / 1_000_000) * model.providerOutputUsdPerMtok;
  return inputUsd + cachedUsd + outputUsd;
}

async function recordDispatchCost(
  model: LlmModelConfig,
  usage: { promptTokens?: number; completionTokens?: number; cachedInputTokens?: number }
): Promise<void> {
  const inputTokens = usage.promptTokens ?? 0;
  const outputTokens = usage.completionTokens ?? 0;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return;
  const costUsd = computeCostUsd(model, inputTokens, outputTokens, cachedInputTokens);
  // VLM = vision-capable model; everything else billed as plain LLM.
  const kind: CostKind = model.capabilities.includes('vision') ? 'vlm' : 'llm';
  await recordProviderCost({
    provider: costProviderFor(model.provider),
    model: model.id,
    kind,
    costUsd,
    inputTokens,
    outputTokens,
    tokensUsed: inputTokens + outputTokens,
  }).catch((err) => {
    // Cost-tracker must never break the dispatch path.
    console.warn('[llm-dispatch] cost record failed:', (err as Error).message);
  });
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Plain text, or content blocks for vision-capable models. */
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
      >;
  tool_call_id?: string;
  name?: string;
}

export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface LlmDispatchInput {
  modelId: string;
  messages: LlmMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Force JSON-only output. */
  jsonMode?: boolean;
  /** Strict JSON schema enforcement (OpenAI / Z.AI). */
  responseSchema?: Record<string, unknown>;
  tools?: LlmTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** Caller uid for BYOK key resolution. */
  userId?: string | null;
}

export interface LlmDispatchResult {
  text: string;
  /** Some providers expose reasoning chains separately (Z.AI). */
  reasoningContent?: string;
  toolCalls?: Array<{
    id?: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    cachedInputTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  modelId: string;
  provider: LlmModelConfig['provider'];
}

function safeJsonParse(s: string | undefined | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function dispatchLlm(input: LlmDispatchInput): Promise<LlmDispatchResult> {
  const model = getLlmModelById(input.modelId);
  if (!model) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unknown LLM model: ${input.modelId}`,
    });
  }
  if (!model.isEnabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `LLM model ${model.id} is disabled`,
    });
  }

  // Centralized prompt-injection sanitization. Direct callers (canon-check,
  // wikia, future internal callers) inherit the defense without each
  // having to remember `sanitizePrompt` at their own entry point.
  input = {
    ...input,
    messages: input.messages.map((m) => {
      if (typeof m.content === 'string') {
        return { ...m, content: sanitizePrompt(m.content) };
      }
      return {
        ...m,
        content: m.content.map((c) =>
          c.type === 'text' ? { ...c, text: sanitizePrompt(c.text) } : c
        ),
      };
    }),
  };

  // Vision capability gate — if any message carries image_url parts and the
  // chosen model lacks 'vision', fail fast with an actionable error instead
  // of either (a) silently stripping the image or (b) shipping it to the
  // provider for a cryptic 400.
  const hasImageParts = input.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url')
  );
  if (hasImageParts && !model.capabilities.includes('vision')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Model ${model.id} does not support vision — pick a model with the 'vision' capability (e.g. gpt-5-mini, glm-4-6v, doubao-seed-1-6-vision)`,
    });
  }

  // Admin kill-switch + platform cost cap preflight. Throws
  // ProviderPausedError / CostCapExceededError before we burn a real call.
  try {
    await assertProviderAllowed({ provider: costProviderFor(model.provider) });
  } catch (err) {
    providerCallFailureTotal
      .labels(
        costProviderFor(model.provider),
        model.capabilities.includes('vision') ? 'vlm' : 'llm',
        model.id,
        classifyDispatchError(err)
      )
      .inc();
    throw err;
  }

  // Per-provider concurrency gate — prevents 429 storms on shared keys at
  // scale. Caps are env-tunable; see lib/rate-limit.ts.
  try {
    const result = await withProviderRateLimit(costProviderFor(model.provider), () =>
      dispatchLlmInner(model, input)
    );
    await recordDispatchCost(model, result.usage);
    return result;
  } catch (err) {
    // Failure path — bump the failure counter so ops can graph error rate
    // per provider/model without scraping logs.
    providerCallFailureTotal
      .labels(
        costProviderFor(model.provider),
        model.capabilities.includes('vision') ? 'vlm' : 'llm',
        model.id,
        classifyDispatchError(err)
      )
      .inc();
    throw err;
  }
}

async function dispatchLlmInner(
  model: LlmModelConfig,
  input: LlmDispatchInput
): Promise<LlmDispatchResult> {
  // ── OpenAI ─────────────────────────────────────────────────────────
  if (model.provider === 'openai') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'openai');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'OpenAI key missing — set OPENAI_API_KEY or BYOK',
      });
    }
    const { openAIService } = await import('../openai');
    const r = await openAIService.chat({
      apiKey,
      model: model.providerModelId as
        | 'gpt-5'
        | 'gpt-5-mini'
        | 'gpt-5-nano'
        | 'o3'
        | 'o4-mini'
        | 'gpt-4.1'
        | 'gpt-4.1-mini'
        | 'gpt-4.1-nano',
      messages: input.messages,
      temperature: input.temperature,
      topP: input.topP,
      maxTokens: input.maxTokens,
      jsonMode: input.jsonMode,
      responseSchema: input.responseSchema,
      tools: input.tools,
      toolChoice: input.toolChoice,
    });
    return {
      text: r.text,
      toolCalls: r.toolCalls,
      usage: {
        promptTokens: r.usage.prompt_tokens,
        completionTokens: r.usage.completion_tokens,
        cachedInputTokens: r.usage.cached_input_tokens,
        totalTokens: r.usage.total_tokens,
      },
      finishReason: r.finishReason,
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── Z.AI ───────────────────────────────────────────────────────────
  if (model.provider === 'zai') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'zai');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Z.AI key missing — set ZAI_API_KEY or BYOK',
      });
    }
    const { zaiService } = await import('../zai');
    // Z.AI's tool_choice doesn't accept 'required' — drop it.
    const zaiToolChoice = input.toolChoice === 'required' ? undefined : input.toolChoice;
    const r = await zaiService.chat({
      apiKey,
      model: model.providerModelId,
      messages: input.messages as Parameters<typeof zaiService.chat>[0]['messages'],
      temperature: input.temperature,
      topP: input.topP,
      maxTokens: input.maxTokens,
      jsonMode: input.jsonMode,
      responseSchema: input.responseSchema,
      tools: input.tools,
      toolChoice: zaiToolChoice,
    });
    return {
      text: r.content,
      reasoningContent: r.reasoningContent,
      toolCalls: r.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.function?.name ?? '',
        arguments: safeJsonParse(tc.function?.arguments),
      })),
      usage: {
        promptTokens: r.usage?.promptTokens,
        completionTokens: r.usage?.completionTokens,
        totalTokens: r.usage?.totalTokens,
      },
      finishReason: r.finishReason,
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── ByteDance (Doubao Seed) ────────────────────────────────────────
  if (model.provider === 'bytedance') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'bytedance');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'ByteDance key missing — set BYTEDANCE_API_KEY or BYOK',
      });
    }
    const { bytedanceService } = await import('../bytedance');
    // Doubao chat takes plain-text content only; flatten vision parts.
    const flatMessages = input.messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
      }
      const text = m.content
        .map((c) => (c.type === 'text' ? c.text : ''))
        .filter(Boolean)
        .join('\n\n');
      return { role: m.role as 'system' | 'user' | 'assistant', content: text };
    });
    const r = await bytedanceService.chat({
      apiKey,
      model: model.providerModelId,
      messages: flatMessages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      jsonMode: input.jsonMode,
    });
    return {
      text: r.content,
      usage: {
        promptTokens: r.usage?.promptTokens,
        completionTokens: r.usage?.completionTokens,
        totalTokens: r.usage?.totalTokens,
      },
      finishReason: r.finishReason,
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── Groq (OpenAI-compatible /chat/completions) ─────────────────────
  if (model.provider === 'groq') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'groq');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Groq key missing — set GROQ_API_KEY or BYOK',
      });
    }
    const { callOpenAICompatChat } = await import('./openai-compat');
    const r = await callOpenAICompatChat({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey,
      model: model.providerModelId,
      messages: input.messages,
      temperature: input.temperature,
      topP: input.topP,
      maxTokens: input.maxTokens,
      jsonMode: input.jsonMode,
      // Groq's chat completions rejects `response_format: json_schema`
      // — coerce to `json_object` via skipResponseSchema.
      responseSchema: input.responseSchema,
      skipResponseSchema: true,
      tools: input.tools,
      toolChoice: input.toolChoice,
      providerLabel: 'Groq',
    });
    return {
      text: r.text,
      toolCalls: r.toolCalls,
      usage: r.usage,
      finishReason: r.finishReason,
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── Google Gemini ──────────────────────────────────────────────────
  if (model.provider === 'google') {
    // Fail loudly when callers request unsupported features instead of
    // silently dropping them — Gemini's tool-call wiring is not yet
    // bridged through this dispatcher, and tool messages can't be flattened
    // into a model turn without corrupting multi-turn sessions.
    if (input.tools && input.tools.length > 0) {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: `tools[] is not supported on the Gemini dispatcher yet — use an OpenAI / Z.AI / Doubao / Groq model for tool calls.`,
      });
    }
    if (input.messages.some((m) => m.role === 'tool')) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `role:'tool' messages are not supported on Gemini — wrap the tool result into a 'user' message.`,
      });
    }
    const apiKey = await resolveProviderKey(input.userId ?? null, 'google');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Google key missing — set GOOGLE_API_KEY or BYOK',
      });
    }
    const { geminiChat } = await import('../gemini');
    // Map OpenAI-style content blocks to Gemini's text/image parts.
    const messages = input.messages.map((m) => {
      if (typeof m.content === 'string') {
        return {
          role: m.role === 'tool' ? 'assistant' : m.role,
          content: m.content,
        } as const;
      }
      return {
        role: m.role === 'tool' ? 'assistant' : m.role,
        content: m.content.map((c) =>
          c.type === 'text'
            ? { type: 'text' as const, text: c.text }
            : { type: 'image_url' as const, imageUrl: c.image_url.url }
        ),
      } as const;
    });
    const r = await geminiChat({
      apiKey,
      model: model.providerModelId,
      messages,
      temperature: input.temperature,
      topP: input.topP,
      maxOutputTokens: input.maxTokens,
      jsonMode: input.jsonMode,
      responseSchema: input.responseSchema,
    });
    return {
      text: r.text,
      usage: {
        promptTokens: r.usage.promptTokens,
        completionTokens: r.usage.completionTokens,
        totalTokens: r.usage.totalTokens,
      },
      finishReason: r.finishReason,
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── AssemblyAI LeMUR (Anthropic pass-through) ──────────────────────
  if (model.provider === 'anthropic-via-aai') {
    throw new TRPCError({
      code: 'NOT_IMPLEMENTED',
      message:
        'LeMUR / Anthropic-via-AssemblyAI dispatcher is not wired yet. Use a direct OpenAI/Z.AI/Doubao model.',
    });
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `No LLM dispatcher for provider ${model.provider}`,
  });
}

/**
 * Heuristic for "the provider is transiently sad" — rate limits, 5xx,
 * network errors, model overload. These should trigger a fallback hop.
 * BAD_REQUEST / 4xx-other / auth errors are *not* retryable — they'd just
 * fail again on a different model with the same input.
 */
function isRetryableProviderError(err: unknown): boolean {
  // Admin paused this provider — try the next one in the chain rather than
  // erroring the user. CostCapExceededError is *not* retryable (the cap is
  // already breached; another provider would just deepen the bill).
  if (err instanceof ProviderPausedError) return true;
  if (err instanceof TRPCError) {
    return (
      err.code === 'BAD_GATEWAY' || err.code === 'TIMEOUT' || err.code === 'INTERNAL_SERVER_ERROR'
    );
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('overloaded') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('socket hang up') ||
      /\b5\d\d\b/.test(msg) // any 5xx
    );
  }
  return false;
}

/**
 * Dispatch through a fallback chain. Tries `primaryModelId` first; on
 * retryable provider errors (429 / 5xx / network / overload) walks
 * `fallbackModelIds` in order until one succeeds. Auth / bad-request
 * failures short-circuit immediately — they aren't going to fix themselves
 * on a different model.
 *
 * Returns the successful result plus the model id that won, so callers can
 * log "wanted X got Y" for observability.
 */
export interface LlmFallbackResult extends LlmDispatchResult {
  attemptedModelIds: string[];
}

export async function dispatchLlmWithFallback(
  input: Omit<LlmDispatchInput, 'modelId'> & {
    primaryModelId: string;
    fallbackModelIds: string[];
  }
): Promise<LlmFallbackResult> {
  const chain = [input.primaryModelId, ...input.fallbackModelIds];
  const attempted: string[] = [];
  let lastErr: unknown;
  for (const modelId of chain) {
    attempted.push(modelId);
    try {
      const r = await dispatchLlm({ ...input, modelId });
      if (attempted.length > 1) {
        console.warn(
          `[llm-dispatch] primary=${input.primaryModelId} failed, succeeded on fallback=${modelId} after ${attempted.length - 1} hop(s)`
        );
        llmFallbackHopTotal.labels(input.primaryModelId, modelId).inc();
      }
      return { ...r, attemptedModelIds: attempted };
    } catch (err) {
      lastErr = err;
      if (!isRetryableProviderError(err)) {
        // Non-retryable: bail out immediately rather than wasting other providers.
        throw err;
      }
      console.warn(
        `[llm-dispatch] model=${modelId} failed retryably (${(err as Error).message?.slice(0, 200)}); trying next fallback`
      );
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new TRPCError({
        code: 'BAD_GATEWAY',
        message: `All LLM models failed for chain ${chain.join(' → ')}`,
      });
}
