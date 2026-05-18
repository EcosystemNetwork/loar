/**
 * OpenAI-compatible chat completions helper.
 *
 * OpenAI / Z.AI / Doubao / Groq all expose `/chat/completions` with the
 * same body and response shape (modulo `tool_choice: 'required'` on Z.AI
 * and a `reasoning_content` extension on some Z.AI models). The
 * per-provider service adapters in `services/{openai,zai,bytedance}.ts`
 * already wrap this for their own SDK ergonomics; this helper is the
 * thin path for cases where the dispatcher would otherwise have to
 * inline a raw fetch (currently Groq).
 *
 * Used by `dispatchLlm`'s Groq branch. Other providers can opt in by
 * pointing their `baseUrl` here instead of their service-specific client.
 */
import { TRPCError } from '@trpc/server';
import { redactSecrets } from '../../lib/redact-secrets';
import type { LlmMessage, LlmTool } from './dispatch';

export interface OpenAICompatChatInput {
  baseUrl: string;
  apiKey: string;
  /** The `model` value passed through verbatim. */
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Adds `response_format: { type: 'json_object' }`. */
  jsonMode?: boolean;
  /** Adds `response_format: { type: 'json_schema', ... }`. Drop on Groq — it 400s. */
  responseSchema?: Record<string, unknown>;
  /** Skip `response_format` when the provider doesn't support it. */
  skipResponseSchema?: boolean;
  tools?: LlmTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** Caller-supplied cancellation. */
  signal?: AbortSignal;
  /** Per-call timeout in ms. Default 120s. */
  timeoutMs?: number;
  /** Used for the error message prefix only. */
  providerLabel: string;
}

export interface OpenAICompatChatResult {
  text: string;
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
}

interface OpenAICompatRawResp {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
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

export async function callOpenAICompatChat(
  input: OpenAICompatChatInput
): Promise<OpenAICompatChatResult> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  };
  if (input.temperature != null) body.temperature = input.temperature;
  if (input.topP != null) body.top_p = input.topP;
  if (input.maxTokens != null) body.max_tokens = input.maxTokens;
  if (input.tools) body.tools = input.tools;
  if (input.toolChoice) body.tool_choice = input.toolChoice;
  if (!input.skipResponseSchema) {
    if (input.responseSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', schema: input.responseSchema, strict: true },
      };
    } else if (input.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
  } else if (input.jsonMode) {
    // Even when schema is unsupported, `json_object` is usually safe.
    body.response_format = { type: 'json_object' };
  }

  // Compose a signal that aborts on caller signal OR after timeoutMs.
  const timeoutMs = input.timeoutMs ?? 120_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('request timeout')), timeoutMs);
  const onCallerAbort = () => ac.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) ac.abort(input.signal.reason);
    else input.signal.addEventListener('abort', onCallerAbort, { once: true });
  }
  try {
    const res = await fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `${input.providerLabel} chat ${res.status}: ${redactSecrets(err).slice(0, 200)}`,
      });
    }
    const data = (await res.json()) as OpenAICompatRawResp;
    const choice = data.choices[0];
    const toolCalls = choice?.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeJsonParse(tc.function.arguments),
    }));
    return {
      text: choice?.message.content ?? '',
      toolCalls,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      finishReason: choice?.finish_reason,
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onCallerAbort);
  }
}
