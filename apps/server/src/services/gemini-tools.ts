/**
 * Gemini function-calling translation (OpenAI-style tools <-> Gemini REST).
 *
 * Pure functions, no I/O — `geminiChat` (services/gemini.ts) composes them.
 *   request : tools -> tools[].functionDeclarations, toolChoice -> toolConfig
 *   history : assistant tool calls -> model `functionCall` parts,
 *             tool results          -> user `functionResponse` parts
 *   response: `functionCall` parts -> toolCalls
 */

export interface GeminiToolDef {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Gemini "thinking" models sign function calls; the signature must be echoed back on replay. */
  thoughtSignature?: string;
}

export type GeminiToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

/** Keys Gemini's function-declaration schema (an OpenAPI subset) accepts. */
const ALLOWED_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
  'title',
]);

/**
 * OpenAI tool schemas are full JSON Schema; Gemini rejects unknown keys
 * (`additionalProperties`, `$schema`, `default`, `examples`, ...) with a 400.
 * Strip them, fold `type: [x, 'null']` into `nullable`, turn `const` into a
 * one-value `enum`, and recurse into `properties` / `items` / `anyOf`.
 */
export function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);
  if (!schema || typeof schema !== 'object') return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(src)) {
    if (key === 'const') {
      out.enum = [value];
      continue;
    }
    if (key === 'type' && Array.isArray(value)) {
      const nonNull = value.filter((t) => t !== 'null');
      out.type = nonNull[0] ?? 'string';
      if (nonNull.length !== value.length) out.nullable = true;
      continue;
    }
    if (!ALLOWED_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          sanitizeSchemaForGemini(v),
        ])
      );
    } else if (key === 'items' || key === 'anyOf') {
      out[key] = sanitizeSchemaForGemini(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function toFunctionDeclarations(
  tools: Array<{ type: 'function'; function: GeminiToolDef }>
) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        ...(t.function.description ? { description: t.function.description } : {}),
        // Gemini rejects an empty `properties` object on OBJECT params, so a
        // parameterless tool omits `parameters` entirely.
        ...(t.function.parameters && hasProperties(t.function.parameters)
          ? { parameters: sanitizeSchemaForGemini(t.function.parameters) }
          : {}),
      })),
    },
  ];
}

function hasProperties(schema: Record<string, unknown>): boolean {
  const p = schema.properties;
  return !!p && typeof p === 'object' && Object.keys(p as object).length > 0;
}

/** OpenAI `tool_choice` -> Gemini `toolConfig.functionCallingConfig`. */
export function toToolConfig(choice: GeminiToolChoice | undefined) {
  if (choice === undefined || choice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } };
  if (choice === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  if (choice === 'required') return { functionCallingConfig: { mode: 'ANY' } };
  return {
    functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.function.name] },
  };
}

export interface GeminiFunctionCallPart {
  functionCall: { name: string; args: Record<string, unknown>; id?: string };
  thoughtSignature?: string;
}

export function functionCallPart(call: GeminiToolCall): GeminiFunctionCallPart {
  return {
    functionCall: {
      name: call.name,
      args: call.arguments ?? {},
      ...(call.id ? { id: call.id } : {}),
    },
    ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
  };
}

/**
 * A tool result as a Gemini `functionResponse` part. `response` must be a JSON
 * object: an object-shaped JSON string is passed through, anything else is
 * wrapped as `{ result: <value> }`.
 */
export function functionResponsePart(name: string, content: string, id?: string) {
  let response: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(content);
    response =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { result: parsed };
  } catch {
    response = { result: content };
  }
  return { functionResponse: { name, response, ...(id ? { id } : {}) } };
}

/** Pull `functionCall` parts out of a candidate's parts, generating ids when Gemini omits them. */
export function extractToolCalls(parts: Array<Record<string, any>> | undefined): GeminiToolCall[] {
  const calls: GeminiToolCall[] = [];
  for (const p of parts ?? []) {
    const fc = p?.functionCall;
    if (!fc || typeof fc.name !== 'string') continue;
    calls.push({
      id: typeof fc.id === 'string' && fc.id ? fc.id : `call_${calls.length}`,
      name: fc.name,
      arguments: fc.args && typeof fc.args === 'object' ? fc.args : {},
      ...(typeof p.thoughtSignature === 'string' ? { thoughtSignature: p.thoughtSignature } : {}),
    });
  }
  return calls;
}
