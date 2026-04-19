#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { LoarClient } from './loar-client.js';
export { LoarClient, LoarApiError } from './loar-client.js';
export { ALL_TOOLS } from './tools.js';
export declare function setupHandlers(server: Server, client: LoarClient): void;
export declare function createServer(): Server;
