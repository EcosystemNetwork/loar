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
import { randomUUID } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────

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
  apiKey?: string; // per-wallet minted loar_* key
  createdAt: number;
  response: http.ServerResponse;
  onClose?: () => void;
}

// ── In-memory stores ────────────────────────────────────────────────────

const PENDING_TTL_MS = 10 * 60 * 1000;
const BOUND_TTL_MS = 2 * 60 * 1000;

const pendingAuthz = new Map<string, PendingAuthorization>();
const boundAuthz = new Map<string, BoundAuthorization & { createdAt: number }>();
const sessions = new Map<string, OAuthSession>();

function prunePending() {
  const now = Date.now();
  for (const [code, authz] of pendingAuthz) {
    if (now - authz.createdAt > PENDING_TTL_MS) pendingAuthz.delete(code);
  }
  for (const [code, authz] of boundAuthz) {
    if (now - authz.createdAt > BOUND_TTL_MS) boundAuthz.delete(code);
  }
}
setInterval(prunePending, 30_000).unref();

// ── API ────────────────────────────────────────────────────────────────

export const sessionStore = {
  savePendingAuthorization(code: string, authz: PendingAuthorization) {
    pendingAuthz.set(code, authz);
  },

  consumePendingAuthorization(code: string): PendingAuthorization | null {
    const authz = pendingAuthz.get(code);
    if (!authz) return null;
    pendingAuthz.delete(code);
    if (Date.now() - authz.createdAt > PENDING_TTL_MS) return null;
    return authz;
  },

  bindAuthorizationToWallet(
    code: string,
    walletAddress: string,
    pending: Omit<BoundAuthorization, 'walletAddress'>
  ) {
    boundAuthz.set(code, {
      ...pending,
      walletAddress,
      createdAt: Date.now(),
    });
  },

  consumeBoundAuthorization(code: string): BoundAuthorization | null {
    const authz = boundAuthz.get(code);
    if (!authz) return null;
    boundAuthz.delete(code);
    if (Date.now() - authz.createdAt > BOUND_TTL_MS) return null;
    return authz;
  },

  openSession(params: {
    walletAddress: string;
    response: http.ServerResponse;
    onClose?: () => void;
  }): string {
    const sessionId = randomUUID();
    const session: OAuthSession = {
      sessionId,
      walletAddress: params.walletAddress,
      createdAt: Date.now(),
      response: params.response,
      onClose: params.onClose,
    };
    sessions.set(sessionId, session);
    params.response.on('close', () => {
      sessions.delete(sessionId);
      params.onClose?.();
    });
    return sessionId;
  },

  getSession(sessionId: string): OAuthSession | null {
    return sessions.get(sessionId) ?? null;
  },

  activeSessionCount(): number {
    return sessions.size;
  },
};
