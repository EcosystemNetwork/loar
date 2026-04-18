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
const LOAR_MCP_PERMISSION_LEVEL = process.env.LOAR_MCP_PERMISSION_LEVEL || 'read'; // read | write | admin

if (!LOAR_API_KEY) {
  console.error('ERROR: LOAR_API_KEY environment variable is required');
  console.error('Generate one at https://loar.fun or via the API:');
  console.error('  trpc.apiKeys.create({ name: "my-mcp", permissions: [...] })');
  process.exit(1);
}

// ── Permission Scoping ────────────────────────────────────────────────

type PermissionLevel = 'read' | 'write' | 'admin';

const TOOL_PERMISSIONS: Record<string, PermissionLevel> = {
  // Read-only tools
  loar_list_entities: 'read',
  loar_get_entity: 'read',
  loar_list_universes: 'read',
  loar_get_universe: 'read',
  loar_get_canon: 'read',
  loar_list_ai_agents: 'read',
  loar_get_pipeline_run: 'read',
  loar_get_profile: 'read',
  loar_discover_profiles: 'read',
  loar_discover_talent_agents: 'read',
  loar_get_credits: 'read',

  // Write tools (create content, generate media)
  loar_create_entity: 'write',
  loar_generate_video: 'write',
  loar_generate_image: 'write',
  loar_create_asset_pack: 'write',
  loar_generate_voice: 'write',
  loar_generate_3d: 'write',
  loar_generate_sound_effect: 'write',
  loar_create_content: 'write',
  loar_propose_collab: 'write',
  loar_record_collab_episode: 'write',
  loar_run_pipeline: 'write',

  // Admin tools (mint, list on marketplace, submit to canon)
  loar_submit_to_canon: 'admin',
  loar_mint_content_nft: 'admin',
  loar_create_listing: 'admin',
};

const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  read: 0,
  write: 1,
  admin: 2,
};

function hasPermission(required: PermissionLevel, actual: PermissionLevel): boolean {
  return PERMISSION_HIERARCHY[actual] >= PERMISSION_HIERARCHY[required];
}

// ── Rate Limiting (per-tool, sliding window) ──────────────────────────

const WRITE_RATE_LIMIT = 10; // max write operations per minute
const RATE_WINDOW_MS = 60_000;
const writeCallTimestamps: number[] = [];

function checkRateLimit(toolName: string): boolean {
  const requiredLevel = TOOL_PERMISSIONS[toolName] || 'write';
  if (requiredLevel === 'read') return true; // no rate limit on reads

  const now = Date.now();
  // Prune old entries
  while (writeCallTimestamps.length > 0 && writeCallTimestamps[0]! < now - RATE_WINDOW_MS) {
    writeCallTimestamps.shift();
  }
  if (writeCallTimestamps.length >= WRITE_RATE_LIMIT) {
    return false;
  }
  writeCallTimestamps.push(now);
  return true;
}

// ── Input Size Validation ─────────────────────────────────────────────

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
  const permissionLevel = LOAR_MCP_PERMISSION_LEVEL as PermissionLevel;
  const allowedTools = ALL_TOOLS.filter((tool) => {
    const required = TOOL_PERMISSIONS[tool.name] || 'write';
    return hasPermission(required, permissionLevel);
  });

  return {
    tools: allowedTools.map((tool) => ({
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
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  // Permission check
  const requiredLevel = TOOL_PERMISSIONS[name] || 'write';
  const permissionLevel = LOAR_MCP_PERMISSION_LEVEL as PermissionLevel;
  if (!hasPermission(requiredLevel as PermissionLevel, permissionLevel)) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Permission denied: "${name}" requires "${requiredLevel}" level, but API key has "${permissionLevel}"`,
        },
      ],
      isError: true,
    };
  }

  // Rate limit check
  if (!checkRateLimit(name)) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Rate limit exceeded: max ${WRITE_RATE_LIMIT} write operations per minute. Please wait and retry.`,
        },
      ],
      isError: true,
    };
  }

  // Input size validation
  const inputArgs = (args || {}) as Record<string, unknown>;
  const sizeError = validateInputSize(inputArgs);
  if (sizeError) {
    return {
      content: [{ type: 'text' as const, text: `Input validation failed: ${sizeError}` }],
      isError: true,
    };
  }

  // Validate Ethereum addresses in input
  const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
  for (const [key, value] of Object.entries(inputArgs)) {
    if (
      (key === 'universeAddress' || key === 'address' || key === 'walletAddress') &&
      typeof value === 'string' &&
      !ETH_ADDRESS_RE.test(value)
    ) {
      return {
        content: [
          { type: 'text' as const, text: `Invalid Ethereum address for "${key}": ${value}` },
        ],
        isError: true,
      };
    }
  }

  try {
    const result = await tool.handler(client, inputArgs);

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
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
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
