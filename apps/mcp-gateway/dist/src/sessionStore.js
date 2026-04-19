import { randomUUID } from 'node:crypto';
// ── In-memory stores ────────────────────────────────────────────────────
const PENDING_TTL_MS = 10 * 60 * 1000;
const BOUND_TTL_MS = 2 * 60 * 1000;
const pendingAuthz = new Map();
const boundAuthz = new Map();
const sessions = new Map();
function prunePending() {
    const now = Date.now();
    for (const [code, authz] of pendingAuthz) {
        if (now - authz.createdAt > PENDING_TTL_MS)
            pendingAuthz.delete(code);
    }
    for (const [code, authz] of boundAuthz) {
        if (now - authz.createdAt > BOUND_TTL_MS)
            boundAuthz.delete(code);
    }
}
setInterval(prunePending, 30_000).unref();
// ── API ────────────────────────────────────────────────────────────────
export const sessionStore = {
    savePendingAuthorization(code, authz) {
        pendingAuthz.set(code, authz);
    },
    consumePendingAuthorization(code) {
        const authz = pendingAuthz.get(code);
        if (!authz)
            return null;
        pendingAuthz.delete(code);
        if (Date.now() - authz.createdAt > PENDING_TTL_MS)
            return null;
        return authz;
    },
    bindAuthorizationToWallet(code, walletAddress, pending) {
        boundAuthz.set(code, {
            ...pending,
            walletAddress,
            createdAt: Date.now(),
        });
    },
    consumeBoundAuthorization(code) {
        const authz = boundAuthz.get(code);
        if (!authz)
            return null;
        boundAuthz.delete(code);
        if (Date.now() - authz.createdAt > BOUND_TTL_MS)
            return null;
        return authz;
    },
    openSession(params) {
        const sessionId = randomUUID();
        const session = {
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
    getSession(sessionId) {
        return sessions.get(sessionId) ?? null;
    },
    activeSessionCount() {
        return sessions.size;
    },
};
