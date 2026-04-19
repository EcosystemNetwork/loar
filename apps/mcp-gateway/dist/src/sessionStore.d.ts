/**
 * OAuth + MCP session state.
 *
 * In-memory for scaffolding. Production must move this to Redis so the
 * gateway can scale horizontally and survive restarts:
 *   - pending authorizations: Redis with 10-minute TTL
 *   - bound authorizations:   Redis with 2-minute TTL (code exchange window)
 *   - active MCP sessions:    Redis pub/sub + per-instance in-memory map
 *     for the actual SSE response stream (streams can't be serialized).
 *
 * See docs/mcp-hosted-sse-deploy.md — "Scaling beyond one instance".
 */
import http from 'node:http';
export interface PendingAuthorization {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    state: string;
    createdAt: number;
}
export interface BoundAuthorization {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    walletAddress: string;
}
export interface OAuthSession {
    sessionId: string;
    walletAddress: string;
    apiKey?: string;
    createdAt: number;
    response: http.ServerResponse;
    onClose?: () => void;
}
export declare const sessionStore: {
    savePendingAuthorization(code: string, authz: PendingAuthorization): void;
    consumePendingAuthorization(code: string): PendingAuthorization | null;
    bindAuthorizationToWallet(code: string, walletAddress: string, pending: Omit<BoundAuthorization, "walletAddress">): void;
    consumeBoundAuthorization(code: string): BoundAuthorization | null;
    openSession(params: {
        walletAddress: string;
        response: http.ServerResponse;
        onClose?: () => void;
    }): string;
    getSession(sessionId: string): OAuthSession | null;
    activeSessionCount(): number;
};
