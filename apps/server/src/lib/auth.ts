/**
 * Authentication Verification
 *
 * Supports two auth methods:
 * 1. SIWE JWT (wallet users) — Authorization: Bearer <jwt>
 * 2. API Key (programmatic agents) — X-API-Key: loar_<agentId>_<hex>
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

export async function verifyAuth(headers: Headers): Promise<AuthUser | null> {
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

  // 2. Try SIWE JWT (Authorization: Bearer <token>)
  const token = headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (payload?.sub) {
    const uid = payload.sub.toLowerCase();
    return {
      uid,
      address: payload.sub,
    };
  }

  return null;
}
