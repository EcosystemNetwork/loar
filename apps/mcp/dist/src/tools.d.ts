/**
 * LOAR MCP Tools — Exposes LOAR platform capabilities as MCP tools
 *
 * Each tool wraps a tRPC endpoint, providing AI agents with typed
 * access to entity creation, content generation, marketplace operations,
 * universe management, and more.
 */
import type { LoarClient } from './loar-client';
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required?: string[];
    };
    handler: (client: LoarClient, args: Record<string, unknown>) => Promise<unknown>;
}
export declare const ALL_TOOLS: ToolDefinition[];
