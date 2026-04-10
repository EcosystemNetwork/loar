#!/usr/bin/env node
/**
 * LOAR MCP Server
 *
 * Model Context Protocol server that exposes the LOAR platform as tools
 * for AI agents. Any MCP-compatible AI (Claude, etc.) can discover and
 * use LOAR's capabilities natively through tool-calling.
 *
 * Configuration via environment variables:
 *   LOAR_SERVER_URL  — LOAR server URL (default: http://localhost:3000)
 *   LOAR_API_KEY     — API key for authentication (required)
 *
 * Usage:
 *   npx tsx apps/mcp/src/index.ts
 *
 * Or add to Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "loar": {
 *         "command": "npx",
 *         "args": ["tsx", "apps/mcp/src/index.ts"],
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
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LoarClient } from './loar-client.js';
import { ALL_TOOLS } from './tools.js';

// ── Configuration ──────────────────────────────────────────────────────

const LOAR_SERVER_URL = process.env.LOAR_SERVER_URL || 'http://localhost:3000';
const LOAR_API_KEY = process.env.LOAR_API_KEY;

if (!LOAR_API_KEY) {
  console.error('ERROR: LOAR_API_KEY environment variable is required');
  console.error('Generate one at https://loar.fun or via the API:');
  console.error('  trpc.apiKeys.create({ name: "my-mcp", permissions: [...] })');
  process.exit(1);
}

// ── Initialize ─────────────────────────────────────────────────────────

const client = new LoarClient({
  serverUrl: LOAR_SERVER_URL,
  apiKey: LOAR_API_KEY,
});

const server = new Server(
  {
    name: 'loar',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── List Tools ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ALL_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// ── Call Tool ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = ALL_TOOLS.find((t) => t.name === name);

  if (!tool) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Unknown tool: ${name}`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(client, args || {});

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

// ── Start Server ───────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`LOAR MCP Server started (server: ${LOAR_SERVER_URL})`);
}

main().catch((err) => {
  console.error('Failed to start LOAR MCP server:', err);
  process.exit(1);
});
