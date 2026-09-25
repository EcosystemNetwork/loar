/**
 * Gemini function calling — the pure translation layer, `geminiChat` and the
 * `dispatchLlm` Gemini branch, exercised against a REAL local HTTP server that
 * implements Gemini's generateContent contract (tools / toolConfig in,
 * functionCall parts out). Not verified against the live Gemini API.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';

const PORT = vi.hoisted(() => {
  const port = 40000 + Math.floor(Math.random() * 20000);
  process.env.GEMINI_API_BASE = `http://127.0.0.1:${port}/v1beta`;
  return port;
});
// setup.ts stubs services/gemini; this file needs the real one.
vi.unmock('../services/gemini');
vi.mock('../lib/byok', async (orig) => ({
  ...(await orig<typeof import('../lib/byok')>()),
  resolveProviderKey: async () => 'gemini-test-key',
}));

import {
  extractToolCalls,
  functionResponsePart,
  sanitizeSchemaForGemini,
  toFunctionDeclarations,
  toToolConfig,
} from '../services/gemini-tools';
import { toWireMessages } from '../services/llm-models/dispatch';

let requests: Array<{ url: string; key?: string; body: any }> = [];
let reply: Record<string, unknown> = {};
let server: Server;
beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push({
        url: req.url!,
        key: req.headers['x-goog-api-key'] as string | undefined,
        body: raw ? JSON.parse(raw) : undefined,
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const usage = { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 };
const textReply = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: usage,
});
beforeEach(() => {
  requests = [];
  reply = textReply('ok');
});

const weatherTool = {
  type: 'function' as const,
  function: {
    name: 'get_weather',
    description: 'Get the weather',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City' } },
      required: ['city'],
      additionalProperties: false,
    },
  },
};

describe('schema + config translation (pure)', () => {
  it('strips keys Gemini rejects and keeps the ones it accepts', () => {
    const out = sanitizeSchemaForGemini({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        unit: { type: 'string', enum: ['c', 'f'], default: 'c' },
        tags: { type: 'array', items: { type: 'string', examples: ['x'] } },
        note: { type: ['string', 'null'] },
        kind: { const: 'weather' },
        nested: {
          type: 'object',
          additionalProperties: true,
          properties: { a: { type: 'integer', minimum: 1 } },
        },
      },
      required: ['unit'],
    });
    expect(out).toEqual({
      type: 'object',
      properties: {
        unit: { type: 'string', enum: ['c', 'f'] },
        tags: { type: 'array', items: { type: 'string' } },
        note: { type: 'string', nullable: true },
        kind: { enum: ['weather'] },
        nested: { type: 'object', properties: { a: { type: 'integer', minimum: 1 } } },
      },
      required: ['unit'],
    });
  });

  it('builds functionDeclarations; a parameterless tool omits parameters', () => {
    const [{ functionDeclarations }] = toFunctionDeclarations([
      weatherTool,
      {
        type: 'function',
        function: { name: 'ping', parameters: { type: 'object', properties: {} } },
      },
    ]);
    expect(functionDeclarations[0]).toMatchObject({
      name: 'get_weather',
      description: 'Get the weather',
    });
    expect((functionDeclarations[0] as any).parameters.additionalProperties).toBeUndefined();
    expect(functionDeclarations[1]).toEqual({ name: 'ping' });
  });

  it('maps tool_choice to functionCallingConfig', () => {
    expect(toToolConfig(undefined)).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
    expect(toToolConfig('none')).toEqual({ functionCallingConfig: { mode: 'NONE' } });
    expect(toToolConfig('required')).toEqual({ functionCallingConfig: { mode: 'ANY' } });
    expect(toToolConfig({ type: 'function', function: { name: 'get_weather' } })).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['get_weather'] },
    });
  });

  it('functionResponse: objects pass through, everything else is wrapped', () => {
    expect(functionResponsePart('f', '{"temp":21}').functionResponse.response).toEqual({
      temp: 21,
    });
    expect(functionResponsePart('f', '[1,2]').functionResponse.response).toEqual({
      result: [1, 2],
    });
    expect(functionResponsePart('f', 'sunny').functionResponse.response).toEqual({
      result: 'sunny',
    });
  });

  it('extractToolCalls generates ids when Gemini omits them and keeps thought signatures', () => {
    expect(
      extractToolCalls([
        { text: 'thinking' },
        { functionCall: { name: 'a', args: { x: 1 } }, thoughtSignature: 'sig' },
        { functionCall: { name: 'b', args: {}, id: 'given' } },
      ])
    ).toEqual([
      { id: 'call_0', name: 'a', arguments: { x: 1 }, thoughtSignature: 'sig' },
      { id: 'given', name: 'b', arguments: {} },
    ]);
  });

  it('toWireMessages converts toolCalls to OpenAI tool_calls and never leaks the camelCase key', () => {
    const out = toWireMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'f', arguments: { a: 1 } }] },
      { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1', name: 'f' },
    ]) as any[];
    expect(out[0]).toEqual({ role: 'user', content: 'hi' });
    expect(out[1].toolCalls).toBeUndefined();
    expect(out[1].tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } },
    ]);
    expect(out[2]).toEqual({ role: 'tool', content: '{"ok":true}', tool_call_id: 'c1', name: 'f' });
  });
});

describe('geminiChat with tools (local Gemini contract server)', () => {
  it("sends declarations + toolConfig and returns the model's functionCall as toolCalls", async () => {
    reply = {
      candidates: [
        {
          content: { parts: [{ functionCall: { name: 'get_weather', args: { city: 'Oslo' } } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: usage,
    };
    const { geminiChat } = await import('../services/gemini');
    const out = await geminiChat({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Weather in Oslo?' }],
      tools: [weatherTool],
      toolChoice: 'required',
    });
    expect(out.toolCalls).toEqual([
      { id: 'call_0', name: 'get_weather', arguments: { city: 'Oslo' } },
    ]);
    expect(out.text).toBe('');
    const sent = requests[0];
    expect(sent.url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(sent.key).toBe('k');
    expect(sent.body.tools[0].functionDeclarations[0].name).toBe('get_weather');
    expect(
      sent.body.tools[0].functionDeclarations[0].parameters.additionalProperties
    ).toBeUndefined();
    expect(sent.body.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });
  });

  it('replays a full tool round-trip: model functionCall turn, then ONE merged user functionResponse turn', async () => {
    const { geminiChat } = await import('../services/gemini');
    const out = await geminiChat({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      tools: [weatherTool],
      messages: [
        { role: 'user', content: 'Weather in Oslo and Rome?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'a',
              name: 'get_weather',
              arguments: { city: 'Oslo' },
              thoughtSignature: 'sig-1',
            },
            { id: 'b', name: 'get_weather', arguments: { city: 'Rome' } },
          ],
        },
        { role: 'tool', toolCallId: 'a', content: '{"temp":3}' },
        { role: 'tool', toolCallId: 'b', content: '{"temp":24}' },
      ],
    });
    expect(out.text).toBe('ok');
    const contents = requests[0].body.contents;
    expect(contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[1].parts).toEqual([
      {
        functionCall: { name: 'get_weather', args: { city: 'Oslo' }, id: 'a' },
        thoughtSignature: 'sig-1',
      },
      { functionCall: { name: 'get_weather', args: { city: 'Rome' }, id: 'b' } },
    ]);
    expect(contents[2].parts).toEqual([
      { functionResponse: { name: 'get_weather', response: { temp: 3 }, id: 'a' } },
      { functionResponse: { name: 'get_weather', response: { temp: 24 }, id: 'b' } },
    ]);
  });

  it('a tool message with no resolvable function name is rejected before any request', async () => {
    const { geminiChat } = await import('../services/gemini');
    await expect(
      geminiChat({
        apiKey: 'k',
        model: 'm',
        messages: [{ role: 'tool', content: '{}', toolCallId: 'unknown' }],
      })
    ).rejects.toThrow('needs `name`');
    expect(requests).toHaveLength(0);
  });

  it('tools + jsonMode is refused up front (Gemini would 400)', async () => {
    const { geminiChat } = await import('../services/gemini');
    await expect(
      geminiChat({
        apiKey: 'k',
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
        tools: [weatherTool],
        jsonMode: true,
      })
    ).rejects.toThrow('cannot combine tools');
    expect(requests).toHaveLength(0);
  });

  it('plain chat is unchanged: no tools/toolConfig in the request, no toolCalls back', async () => {
    const { geminiChat } = await import('../services/gemini');
    const out = await geminiChat({
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(requests[0].body.tools).toBeUndefined();
    expect(requests[0].body.toolConfig).toBeUndefined();
    expect(out.toolCalls).toBeUndefined();
  });
});

describe('dispatchLlm Gemini branch', () => {
  it("no longer rejects tools[]: returns the model's tool calls", async () => {
    reply = {
      candidates: [
        {
          content: { parts: [{ functionCall: { name: 'get_weather', args: { city: 'Oslo' } } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: usage,
    };
    const { dispatchLlm } = await import('../services/llm-models/dispatch');
    const { getEnabledLlmModels } = await import('../services/llm-models/registry');
    const gemini = getEnabledLlmModels().find(
      (m) => m.provider === 'google' && m.capabilities.includes('tools')
    )!;
    const out = await dispatchLlm({
      modelId: gemini.id,
      messages: [{ role: 'user', content: 'Weather in Oslo?' }],
      tools: [weatherTool],
      userId: 'u1',
    });
    expect(out.toolCalls).toEqual([
      { id: 'call_0', name: 'get_weather', arguments: { city: 'Oslo' } },
    ]);
    expect(requests[0].body.tools).toBeDefined();
  });

  it('tools + responseSchema is a BAD_REQUEST, not an upstream 400', async () => {
    const { dispatchLlm } = await import('../services/llm-models/dispatch');
    const { getEnabledLlmModels } = await import('../services/llm-models/registry');
    const gemini = getEnabledLlmModels().find((m) => m.provider === 'google')!;
    await expect(
      dispatchLlm({
        modelId: gemini.id,
        messages: [{ role: 'user', content: 'x' }],
        tools: [weatherTool],
        responseSchema: { type: 'object' },
        userId: 'u1',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(requests).toHaveLength(0);
  });
});
