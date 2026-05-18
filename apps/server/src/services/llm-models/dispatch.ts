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
import { getLlmModelById } from './registry';
import type { LlmModelConfig } from './types';

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
    const body: Record<string, unknown> = {
      model: model.providerModelId,
      messages: input.messages,
    };
    if (input.temperature != null) body.temperature = input.temperature;
    if (input.topP != null) body.top_p = input.topP;
    if (input.maxTokens != null) body.max_tokens = input.maxTokens;
    if (input.tools) body.tools = input.tools;
    if (input.toolChoice) body.tool_choice = input.toolChoice;
    if (input.jsonMode && !input.responseSchema) {
      body.response_format = { type: 'json_object' };
    }
    if (input.responseSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', schema: input.responseSchema, strict: true },
      };
    }
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `Groq chat ${res.status}: ${err.slice(0, 200)}`,
      });
    }
    interface GroqResp {
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
      };
    }
    const data = (await res.json()) as GroqResp;
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
        totalTokens: data.usage?.total_tokens,
      },
      finishReason: choice?.finish_reason,
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── Google Gemini ──────────────────────────────────────────────────
  if (model.provider === 'google') {
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
