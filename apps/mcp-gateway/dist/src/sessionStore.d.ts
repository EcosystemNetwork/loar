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
export declare const sessionStore: {
    savePendingAuthorization(code: string, authz: PendingAuthorization): Promise<void>;
    consumePendingAuthorization(code: string): Promise<PendingAuthorization | null>;
    bindAuthorizationToWallet(code: string, walletAddress: string, pending: Omit<BoundAuthorization, "walletAddress">): Promise<void>;
    consumeBoundAuthorization(code: string): Promise<BoundAuthorization | null>;
    cacheApiKey(walletAddress: string, rawKey: string, ttlMs: number): Promise<void>;
    getCachedApiKey(walletAddress: string): Promise<string | null>;
};
