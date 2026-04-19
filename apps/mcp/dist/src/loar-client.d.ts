/**
 * LOAR API Client — HTTP client for calling the LOAR tRPC server
 *
 * Used by MCP tools to make authenticated requests to the LOAR server.
 * Authenticates via API key using `Authorization: Bearer loar_<...>`.
 * (Server also accepts the legacy `X-API-Key` header for the same key.)
 */
export declare class LoarApiError extends Error {
    readonly status: number;
    readonly body: string;
    readonly errorCode: string;
    constructor(status: number, body: string, errorCode: string);
}
export interface LoarClientConfig {
    serverUrl: string;
    apiKey: string;
    /**
     * Optional end-user wallet address. Sent as `X-Loar-End-User-Address` on
     * every request. LOAR server only honors this header when the API key
     * carries the `mcp_server` scope (SSRF/impersonation guard — see
     * apps/server/src/lib/auth.ts). Used by the hosted MCP gateway to
     * attribute calls back to the authenticated OAuth session subject.
     */
    endUserAddress?: string;
}
export declare class LoarClient {
    private serverUrl;
    private apiKey;
    private endUserAddress?;
    constructor(config: LoarClientConfig);
    private authHeaders;
    /**
     * Call a tRPC query endpoint
     */
    query<T = unknown>(path: string, input?: Record<string, unknown>): Promise<T>;
    /**
     * Call a tRPC mutation endpoint
     */
    mutate<T = unknown>(path: string, input: Record<string, unknown>): Promise<T>;
}
