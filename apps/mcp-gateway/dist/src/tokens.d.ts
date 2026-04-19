export interface AccessTokenPayload {
    sub: string;
    scope: string;
    aud: string;
}
export declare function issueAccessToken(payload: AccessTokenPayload): Promise<string>;
export declare function verifyAccessToken(token: string): Promise<{
    sub: string;
    scope: string;
} | null>;
