/**
 * Authentication Verification
 *
 * Supports three auth methods (checked in order):
 * 1. API Key — X-API-Key: loar_<agentId>_<hex>  OR  Authorization: Bearer loar_<...>
 * 2. httpOnly cookie (browser users) — Cookie: siwe-session=<jwt>
 * 3. Bearer JWT (mobile/legacy) — Authorization: Bearer <jwt>
 *
 * Returns a normalized AuthUser for use in tRPC context.
 */
import { verifySessionToken } from './siwe';
import { verifyApiKey, type ApiKeyDoc } from './apiKeys';

export interface AuthUser {
  uid: string;
  address?: string;
  email?: string;
  /** Set when authenticated via API key */
  apiKeyId?: string;
  /** Set when the API key is linked to an AI agent */
  aiAgentId?: string;
  /** Permissions scoped to this API key (empty = full access via JWT) */
  apiKeyPermissions?: string[];
}

/**
 * Verify auth from request headers and optional cookie token.
 * @param headers — raw request headers
 * @param cookieToken — JWT from httpOnly `siwe-session` cookie (extracted by caller)
 */
export async function verifyAuth(headers: Headers, cookieToken?: string): Promise<AuthUser | null> {
  // 1. Try API key — accept either X-API-Key or Authorization: Bearer loar_<...>
  const bearerRaw = headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const bearerIsApiKey = bearerRaw?.startsWith('loar_') ?? false;
  const apiKey = headers.get('X-API-Key') ?? (bearerIsApiKey ? bearerRaw : null);
  if (apiKey) {
    const result = await verifyApiKey(apiKey);
    if (result) {
      return {
        ...result.user,
        apiKeyId: result.keyDoc.id,
        aiAgentId: result.keyDoc.aiAgentId || undefined,
        apiKeyPermissions: result.keyDoc.permissions,
      };
    }
    return null; // Invalid API key — don't fall through to JWT
  }

  // 2. Try httpOnly cookie token (preferred for browser sessions)
  if (cookieToken) {
    const payload = await verifySessionToken(cookieToken);
    if (payload?.sub) {
      return {
        uid: payload.sub.toLowerCase(),
        address: payload.sub,
      };
    }
  }

  // 3. Fall back to Authorization: Bearer <jwt> (mobile, legacy clients).
  //    Skipped above when the Bearer value is a loar_ API key.
  if (bearerRaw && !bearerIsApiKey) {
    const payload = await verifySessionToken(bearerRaw);
    if (payload?.sub) {
      return {
        uid: payload.sub.toLowerCase(),
        address: payload.sub,
      };
    }
  }

  return null;
}
