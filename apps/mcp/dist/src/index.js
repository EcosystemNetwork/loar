#!/usr/bin/env node
/**
 * LOAR MCP Server
 *
 * Model Context Protocol server that exposes the LOAR platform as tools
 * for AI agents. Any MCP-compatible AI (Claude, OpenClaw, Hermes, Cursor,
 * Copilot, etc.) can discover and use LOAR's capabilities natively through
 * tool-calling.
 *
 * Configuration via environment variables:
 *   LOAR_SERVER_URL  — LOAR server URL (default: http://localhost:3000)
 *   LOAR_API_KEY     — API key for authentication (required, prefix `loar_`)
 *
 * Permission enforcement lives on the server: each API key carries scoped
 * permissions (see apps/server/src/lib/apiKeys.ts). If the key is missing
 * a required scope, the server returns FORBIDDEN and this server relays
 * the structured error code to the agent.
 *
 * Usage (stdio, for Claude Desktop / Cursor / local MCP hosts):
 *   npx @loar/mcp-server
 *
 * Or add to Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "loar": {
 *         "command": "npx",
 *         "args": ["-y", "@loar/mcp-server"],
 *         "env": {
 *           "LOAR_SERVER_URL": "https://api.loar.fun",
 *           "LOAR_API_KEY": "loar_..."
 *         }
 *       }
 *     }
 *   }
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { LoarApiError, LoarClient } from './loar-client.js';
import { ALL_TOOLS } from './tools.js';
// ── Configuration ──────────────────────────────────────────────────────
const LOAR_SERVER_URL = process.env.LOAR_SERVER_URL || 'http://localhost:3000';
const LOAR_API_KEY = process.env.LOAR_API_KEY;
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
// ── Input Size Validation (defense-in-depth) ───────────────────────────
const MAX_STRING_LENGTH = 10_000; // 10 KB per string field
const MAX_TOTAL_INPUT_SIZE = 50_000; // 50 KB total input
function validateInputSize(args) {
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
function errorResponse(message, errorCode) {
    return {
        content: [{ type: 'text', text: message }],
        isError: true,
        _meta: { errorCode },
    };
}
// ── Initialize ─────────────────────────────────────────────────────────
const client = new LoarClient({
    serverUrl: LOAR_SERVER_URL,
    apiKey: LOAR_API_KEY,
});
const server = new Server({
    name: 'loar',
    version: '0.2.0',
}, {
    capabilities: {
        tools: {},
        resources: {},
    },
});
// ── List Tools ─────────────────────────────────────────────────────────
//
// We advertise every tool. Permission enforcement is server-side via the
// API key's scopes. If the key is missing a scope, the server returns
// FORBIDDEN and the agent sees a structured errorCode in the tool result.
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: ALL_TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        })),
    };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
        const result = await client.query('mcp.resources.list', {});
        return {
            resources: (result?.resources ?? []).map((r) => ({
                uri: r.uri,
                name: r.name,
                description: r.description,
                mimeType: r.mimeType,
            })),
            ...(result?.nextCursor ? { nextCursor: result.nextCursor } : {}),
        };
    }
    catch {
        // On failure, return an empty set rather than erroring — agents should
        // fall back to tools-only discovery.
        return { resources: [] };
    }
});
// ── Read Resource ──────────────────────────────────────────────────────
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    try {
        const result = await client.query('mcp.resources.read', { uri });
        return {
            contents: [
                {
                    uri: result.uri,
                    mimeType: result.mimeType,
                    text: result.text,
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read resource ${uri}: ${message}`);
    }
});
// ── Call Tool ──────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = ALL_TOOLS.find((t) => t.name === name);
    if (!tool) {
        return errorResponse(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
    }
    const inputArgs = (args || {});
    // Input size validation
    const sizeError = validateInputSize(inputArgs);
    if (sizeError) {
        return errorResponse(`Input validation failed: ${sizeError}`, 'INVALID_INPUT');
    }
    // Validate Ethereum addresses in input (format-level check only; the server
    // does its own checksum + existence checks)
    const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
    for (const [key, value] of Object.entries(inputArgs)) {
        if ((key === 'universeAddress' || key === 'address' || key === 'walletAddress') &&
            typeof value === 'string' &&
            !ETH_ADDRESS_RE.test(value)) {
            return errorResponse(`Invalid Ethereum address for "${key}": ${value}`, 'INVALID_INPUT');
        }
    }
    try {
        const result = await tool.handler(client, inputArgs);
        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error) {
        if (error instanceof LoarApiError) {
            return errorResponse(error.message, error.errorCode);
        }
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(`Error: ${message}`, 'INTERNAL_ERROR');
    }
});
// ── Start Server ───────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`LOAR MCP Server v0.2.0 started (server: ${LOAR_SERVER_URL})`);
}
main().catch((err) => {
    console.error('Failed to start LOAR MCP server:', err);
    process.exit(1);
});
