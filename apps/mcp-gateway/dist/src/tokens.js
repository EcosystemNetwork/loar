/**
 * Access token issuance + verification.
 *
 * Uses HS256 JWTs signed with OAUTH_JWT_SECRET. Short TTL (1h). The
 * `sub` claim carries the authenticated wallet address — the /sse handler
 * uses it as the MCP session's end-user identity.
 *
 * For production we'll likely migrate to RS256 + JWKS so downstream
 * services can verify without sharing the secret. For v0.1 HS256 is
 * fine since only this gateway + the LOAR server verify tokens, and
 * the secret is deployed to both via the same channel.
 */
import { SignJWT, jwtVerify } from 'jose';
const SECRET = new TextEncoder().encode(process.env.OAUTH_JWT_SECRET ??
    (() => {
        throw new Error('OAUTH_JWT_SECRET is required');
    })());
const ACCESS_TOKEN_TTL = '1h';
export async function issueAccessToken(payload) {
    return new SignJWT({ scope: payload.scope })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(payload.sub)
        .setAudience(payload.aud)
        .setIssuedAt()
        .setExpirationTime(ACCESS_TOKEN_TTL)
        .sign(SECRET);
}
export async function verifyAccessToken(token) {
    try {
        const { payload } = await jwtVerify(token, SECRET);
        if (typeof payload.sub !== 'string')
            return null;
        return {
            sub: payload.sub,
            scope: typeof payload.scope === 'string' ? payload.scope : '',
        };
    }
    catch {
        return null;
    }
}
