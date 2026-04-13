/**
 * Authentication Verification
 *
 * Supports three auth methods (checked in order):
 * 1. API Key (programmatic agents) — X-API-Key: loar_<agentId>_<hex>
 * 2. httpOnly cookie (browser users) — Cookie: siwe-session=<jwt>
 * 3. Bearer token (legacy/mobile) — Authorization: Bearer <jwt>
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
  // 1. Try API key first (X-API-Key header)
  const apiKey = headers.get('X-API-Key');
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

  // 3. Fall back to Authorization: Bearer <token> (mobile, legacy clients)
  const bearerToken = headers.get('Authorization')?.replace('Bearer ', '');
  if (bearerToken) {
    const payload = await verifySessionToken(bearerToken);
    if (payload?.sub) {
      return {
        uid: payload.sub.toLowerCase(),
        address: payload.sub,
      };
    }
  }

  return null;
}
