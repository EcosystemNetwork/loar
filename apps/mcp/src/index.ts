#!/usr/bin/env node
/**
 * LOAR MCP Server
 *
 * Model Context Protocol server that exposes the LOAR platform as tools
 * for AI agents. Any MCP-compatible AI (Claude, OpenClaw, Hermes, Cursor,
 * Copilot, etc.) can discover and use LOAR's capabilities natively through
 * tool-calling.
 *
 * Transports:
 *   - stdio (default) — for Claude Desktop / Cursor / local MCP hosts
 *   - sse            — HTTP + Server-Sent Events for hosted deployments,
 *                      one-click connectors, OpenClaw/Hermes remote
 *                      integrations. Select with LOAR_MCP_TRANSPORT=sse.
 *
 * Configuration via environment variables:
 *   LOAR_SERVER_URL       LOAR tRPC server URL (default: http://localhost:3000)
 *   LOAR_API_KEY          API key for authentication (required, prefix `loar_`)
 *   LOAR_MCP_TRANSPORT    "stdio" | "sse"  (default: "stdio")
 *   LOAR_MCP_PORT         Port for SSE mode (default: 3333)
 *   LOAR_MCP_HOST         Bind host for SSE mode (default: 127.0.0.1)
 *
 * Permission enforcement lives on the server: each API key carries scoped
 * permissions (see apps/server/src/lib/apiKeys.ts). If the key is missing
 * a required scope, the server returns FORBIDDEN and this server relays
 * the structured error code to the agent.
 */
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { LoarApiError, LoarClient } from './loar-client.js';
import { ALL_TOOLS } from './tools.js';

// ── Configuration ──────────────────────────────────────────────────────

const LOAR_SERVER_URL = process.env.LOAR_SERVER_URL || 'http://localhost:3000';
const LOAR_API_KEY = process.env.LOAR_API_KEY;
const LOAR_MCP_TRANSPORT = (process.env.LOAR_MCP_TRANSPORT || 'stdio').toLowerCase();
const LOAR_MCP_PORT = Number(process.env.LOAR_MCP_PORT || 3333);
const LOAR_MCP_HOST = process.env.LOAR_MCP_HOST || '127.0.0.1';

if (!LOAR_API_KEY) {
  console.error('ERROR: LOAR_API_KEY environment variable is required');
  console.error('Generate one at https://loar.fun (Settings → API Keys).');
  console.error('The key must include the scopes for the tools you intend to call.');
  process.exit(1);
}

if (!LOAR_API_KEY.startsWith('loar_')) {
  console.error("ERROR: LOAR_API_KEY does not look valid (expected prefix 'loar_')");
  process.exit(1);
}

if (LOAR_MCP_TRANSPORT !== 'stdio' && LOAR_MCP_TRANSPORT !== 'sse') {
  console.error(
    `ERROR: LOAR_MCP_TRANSPORT must be "stdio" or "sse" (got: "${LOAR_MCP_TRANSPORT}")`
  );
  process.exit(1);
}

if (LOAR_MCP_TRANSPORT === 'sse') {
  if (!Number.isInteger(LOAR_MCP_PORT) || LOAR_MCP_PORT < 1 || LOAR_MCP_PORT > 65535) {
    console.error(`ERROR: LOAR_MCP_PORT must be a valid port (got: ${process.env.LOAR_MCP_PORT})`);
    process.exit(1);
  }
}

// ── Input Size Validation (defense-in-depth) ───────────────────────────

const MAX_STRING_LENGTH = 10_000; // 10 KB per string field
const MAX_TOTAL_INPUT_SIZE = 50_000; // 50 KB total input

function validateInputSize(args: Record<string, unknown>): string | null {
  const serialized = JSON.stringify(args);
  if (serialized.length > MAX_TOTAL_INPUT_SIZE) {
    return `Input too large (${serialized.length} bytes, max ${MAX_TOTAL_INPUT_SIZE})`;
  }
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      return `Field "${key}" too large (${value.length} chars, max ${MAX_STRING_LENGTH})`;
    }
  }
  return null;
}

// ── Structured Error Response Helpers ─────────────────────────────────

type ErrorCode =
  | 'INSUFFICIENT_CREDITS'
  | 'RATE_LIMITED'
  | 'MODERATION_BLOCKED'
  | 'INVALID_INPUT'
  | 'UPSTREAM_TIMEOUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNKNOWN_TOOL'
  | 'INTERNAL_ERROR';

function errorResponse(message: string, errorCode: ErrorCode) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
    _meta: { errorCode },
  };
}

// ── Progress notification polling ──────────────────────────────────────
//
// When the client includes `_meta.progressToken` on a tool call, we poll
// the unified `jobs.status` endpoint every 2s and emit
// `notifications/progress` until the job reaches a terminal state. This
// lets long-running async tools (threed.*, studio.createEntityPack) stream
// status to the agent's chat without blocking the tool result.

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const JOB_KINDS = ['video', 'image', 'voice', '3d', 'studio'] as const;
type JobKind = (typeof JOB_KINDS)[number];

interface NormalizedJob {
  jobId: string;
  kind: JobKind;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number | null;
  message: string | null;
  resultUrl: string | null;
  resultUrls: string[] | null;
  errorCode: string | null;
}

function extractJobIdFromResult(result: unknown): { jobId: string; kind?: JobKind } | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  // Tools use different conventions: videoGenerations use `generationId`,
  // studio uses `jobId`.
  const rawId = r.jobId ?? r.generationId;
  if (typeof rawId !== 'string' || !rawId) return null;
  return { jobId: rawId };
}

function isTerminalResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true;
  const status = (result as Record<string, unknown>).status;
  return typeof status === 'string' && TERMINAL_STATUSES.has(status);
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * Poll jobs.status for a jobId, emitting notifications/progress on each
 * cycle. Resolves when the job reaches a terminal state or timeout expires.
 * Never throws — polling errors are swallowed so transient Firestore blips
 * don't abort the stream.
 */
async function pollAndStream(
  server: Server,
  client: LoarClient,
  jobId: string,
  progressToken: string | number,
  signal: AbortSignal
): Promise<NormalizedJob | null> {
  const start = Date.now();
  let lastJob: NormalizedJob | null = null;

  while (Date.now() - start < MAX_POLL_DURATION_MS) {
    if (signal.aborted) return lastJob;
    try {
      const job = await client.query<NormalizedJob>('jobs.status', { jobId });
      lastJob = job;
      await server.notification({
        method: 'notifications/progress',
        params: {
          progressToken,
          progress: job.progress ?? 0,
          total: 100,
          ...(job.message ? { message: job.message } : {}),
        },
      });
      if (TERMINAL_STATUSES.has(job.status)) return job;
    } catch {
      // Transient poll failure — keep going.
    }
    await sleepWithAbort(POLL_INTERVAL_MS, signal);
  }
  return lastJob;
}

// ── Handler Setup ──────────────────────────────────────────────────────
//
// Factored out so both stdio and SSE transports get the same surface.
// Each SSE session creates a fresh Server + handlers pair because the
// MCP SDK's Server binds to a single transport. The shared LoarClient
// is reused across all sessions (single tenant / single API key).
//
// Cancellation model:
//   The MCP SDK's Protocol class registers its own `notifications/cancelled`
//   handler that aborts the in-flight request's AbortSignal. We do NOT
//   register a competing handler. For agent-visible cancellation, use the
//   `loar_cancel_generation` tool — see skills/loar-video/SKILL.md Example 10.

function setupHandlers(server: Server, client: LoarClient) {
  // ── List Tools ──────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // ── List Resources ──────────────────────────────────────────────────
  interface ServerResourceEntry {
    uri: string;
    name: string;
    description?: string;
    mimeType: string;
  }

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      const result = await client.query<{
        resources: ServerResourceEntry[];
        nextCursor?: string;
      }>('mcp.resources.list', {});
      return {
        resources: (result?.resources ?? []).map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        })),
        ...(result?.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    } catch {
      return { resources: [] };
    }
  });

  // ── Read Resource ───────────────────────────────────────────────────
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    try {
      const result = await client.query<{
        uri: string;
        mimeType: string;
        text: string;
      }>('mcp.resources.read', { uri });
      return {
        contents: [
          {
            uri: result.uri,
            mimeType: result.mimeType,
            text: result.text,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read resource ${uri}: ${message}`);
    }
  });

  // ── Call Tool ───────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const tool = ALL_TOOLS.find((t) => t.name === name);

    if (!tool) {
      return errorResponse(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
    }

    const inputArgs = (args || {}) as Record<string, unknown>;

    // Input size validation
    const sizeError = validateInputSize(inputArgs);
    if (sizeError) {
      return errorResponse(`Input validation failed: ${sizeError}`, 'INVALID_INPUT');
    }

    // Validate Ethereum addresses in input (format-level check only; the server
    // does its own checksum + existence checks)
    const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
    for (const [key, value] of Object.entries(inputArgs)) {
      if (
        (key === 'universeAddress' || key === 'address' || key === 'walletAddress') &&
        typeof value === 'string' &&
        !ETH_ADDRESS_RE.test(value)
      ) {
        return errorResponse(`Invalid Ethereum address for "${key}": ${value}`, 'INVALID_INPUT');
      }
    }

    try {
      const result = await tool.handler(client, inputArgs);

      // Optional progress streaming — if the client asked for progress AND
      // the tool returned an async non-terminal job, poll and emit
      // notifications/progress until the job finishes (or the budget expires).
      const progressToken = request.params._meta?.progressToken as string | number | undefined;
      const jobRef = extractJobIdFromResult(result);
      if (progressToken !== undefined && jobRef && !isTerminalResult(result)) {
        const finalJob = await pollAndStream(
          server,
          client,
          jobRef.jobId,
          progressToken,
          extra.signal
        );
        const combined = { initial: result, final: finalJob };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(combined, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      if (error instanceof LoarApiError) {
        return errorResponse(error.message, error.errorCode as ErrorCode);
      }
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(`Error: ${message}`, 'INTERNAL_ERROR');
    }
  });
}

function createServer(): Server {
  return new Server(
    {
      name: 'loar',
      version: '0.2.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );
}

// ── Transports ─────────────────────────────────────────────────────────

async function startStdio(client: LoarClient) {
  const server = createServer();
  setupHandlers(server, client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`LOAR MCP Server v0.2.0 started (stdio, upstream: ${LOAR_SERVER_URL})`);
}

/**
 * SSE transport — one MCP session per `GET /sse` request, dispatched by
 * sessionId on subsequent `POST /messages?sessionId=<id>` calls.
 *
 * Endpoints:
 *   GET  /sse                          — open a new session; response is an SSE stream
 *   POST /messages?sessionId=<id>      — send a JSON-RPC message to an open session
 *   GET  /health                       — { ok, sessions, version }
 */
async function startSse(client: LoarClient) {
  const sessions = new Map<string, { server: Server; transport: SSEServerTransport }>();

  const httpServer = http.createServer(async (req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      res.writeHead(400).end('Bad Request');
      return;
    }

    // ── GET /sse: open a session ─────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      const server = createServer();
      setupHandlers(server, client);
      try {
        await server.connect(transport);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[sse] connect failed: ${msg}`);
        try {
          res.writeHead(500).end();
        } catch {
          /* res may already be committed by SSE transport */
        }
        return;
      }
      sessions.set(transport.sessionId, { server, transport });
      console.error(`[sse] session opened: ${transport.sessionId} (active=${sessions.size})`);
      const cleanup = () => {
        if (sessions.delete(transport.sessionId)) {
          console.error(`[sse] session closed: ${transport.sessionId} (active=${sessions.size})`);
          void transport.close().catch(() => {});
          void server.close().catch(() => {});
        }
      };
      req.on('close', cleanup);
      transport.onclose = cleanup;
      return;
    }

    // ── POST /messages: route to an existing session ─────────────────
    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        res
          .writeHead(400, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: 'sessionId query param required' }));
        return;
      }
      const entry = sessions.get(sessionId);
      if (!entry) {
        res
          .writeHead(404, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: `Unknown sessionId: ${sessionId}` }));
        return;
      }
      try {
        await entry.transport.handlePostMessage(req, res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[sse] handlePostMessage failed (${sessionId}): ${msg}`);
        if (!res.headersSent) {
          res.writeHead(500).end(msg);
        }
      }
      return;
    }

    // ── GET /health: liveness check ──────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/health') {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, sessions: sessions.size, version: '0.2.0' }));
      return;
    }

    res.writeHead(404).end();
  });

  httpServer.listen(LOAR_MCP_PORT, LOAR_MCP_HOST, () => {
    console.error(
      `LOAR MCP Server v0.2.0 (SSE) listening on http://${LOAR_MCP_HOST}:${LOAR_MCP_PORT}`
    );
    console.error(`  Upstream: ${LOAR_SERVER_URL}`);
    console.error(`  Agents connect to: http://${LOAR_MCP_HOST}:${LOAR_MCP_PORT}/sse`);
    console.error(`  Health:            http://${LOAR_MCP_HOST}:${LOAR_MCP_PORT}/health`);
  });

  const shutdown = () => {
    console.error(`[sse] shutting down, closing ${sessions.size} session(s)…`);
    for (const { server, transport } of sessions.values()) {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    }
    sessions.clear();
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ── Start ──────────────────────────────────────────────────────────────

const client = new LoarClient({
  serverUrl: LOAR_SERVER_URL,
  apiKey: LOAR_API_KEY,
});

async function main() {
  if (LOAR_MCP_TRANSPORT === 'sse') {
    await startSse(client);
  } else {
    await startStdio(client);
  }
}

main().catch((err) => {
  console.error('Failed to start LOAR MCP server:', err);
  process.exit(1);
});
