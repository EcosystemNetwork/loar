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
import { verifyApiKey, isMcpServerKey, type ApiKeyDoc } from './apiKeys';

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

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
  /**
   * End-user wallet address passed through by an MCP relay. Only populated
   * when the API key has the `mcp_server` scope AND the request includes
   * a valid `X-Loar-End-User-Address` header. See docs/prd-mcp-integration.md §1.
   */
  endUserAddress?: string;
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
      // Honour X-Loar-End-User-Address ONLY when the key is an MCP relay.
      // Direct API keys cannot impersonate a different end-user.
      let endUserAddress: string | undefined;
      if (isMcpServerKey(result.keyDoc.permissions)) {
        const raw = headers.get('X-Loar-End-User-Address')?.trim();
        if (raw && ETH_ADDRESS_RE.test(raw)) {
          endUserAddress = raw.toLowerCase();
        }
      }
      return {
        ...result.user,
        apiKeyId: result.keyDoc.id,
        aiAgentId: result.keyDoc.aiAgentId || undefined,
        apiKeyPermissions: result.keyDoc.permissions,
        endUserAddress,
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
