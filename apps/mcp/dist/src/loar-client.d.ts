/**
 * LOAR API Client — HTTP client for calling the LOAR tRPC server
 *
 * Used by MCP tools to make authenticated requests to the LOAR server.
 * Authenticates via API key (X-API-Key header).
 */
export interface LoarClientConfig {
    serverUrl: string;
    apiKey: string;
}
export declare class LoarClient {
    private serverUrl;
    private apiKey;
    constructor(config: LoarClientConfig);
    /**
     * Call a tRPC query endpoint
     */
    query<T = unknown>(path: string, input?: Record<string, unknown>): Promise<T>;
    /**
     * Call a tRPC mutation endpoint
     */
    mutate<T = unknown>(path: string, input: Record<string, unknown>): Promise<T>;
}
