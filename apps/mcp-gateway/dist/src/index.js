#!/usr/bin/env node
/**
 * LOAR MCP Gateway — OAuth 2.1 bridge for hosted SSE at mcp.loar.fun.
 *
 * Architecture:
 *
 *   ┌──────────┐   OAuth 2.1      ┌──────────────┐   SSE MCP        ┌──────────────┐
 *   │  agent   │ ───────────────► │  mcp-gateway │ ────(proxy)────► │  LOAR server │
 *   │ (OpenClaw│   authz code +   │   (this app) │    per-session    │  tRPC + ...  │
 *   │  Hermes  │   token exchange │              │    mcp_server key │              │
 *   │ Claude)  │                  │              │                   │              │
 *   └──────────┘                  └──────────────┘                   └──────────────┘
 *                                         │
 *                                         ▼
 *                          ┌────────────────────────────────┐
 *                          │  OAuth session store (Redis)   │
 *                          │   authz codes, access tokens,  │
 *                          │   session → loar_* key mapping │
 *                          └────────────────────────────────┘
 *
 * Endpoints (RFC 8414 + MCP OAuth flow):
 *
 *   GET  /.well-known/oauth-authorization-server   — OAuth discovery metadata
 *   GET  /.well-known/oauth-protected-resource     — MCP resource metadata
 *   GET  /authorize                                — starts login, redirects to LOAR SIWE
 *   GET  /callback                                 — LOAR returns wallet sig here
 *   POST /token                                    — authz code → access token
 *   GET  /sse                                      — opens MCP session (Bearer auth)
 *   POST /messages?sessionId=                      — routes JSON-RPC to session
 *   GET  /health                                   — { ok, sessions }
 *
 * This is SCAFFOLDING — the Redis store, SIWE callback wiring, and actual
 * MCP session plumbing are stubs. Deploy requires:
 *   - DNS: mcp.loar.fun → this app's hosting target
 *   - TLS: Railway/Fly handle this automatically on custom domains
 *   - Env: OAUTH_ISSUER, OAUTH_JWT_SECRET, REDIS_URL, LOAR_SERVER_URL
 *   - LOAR server: `/auth/siwe-oauth-return` callback handler + session-to-key mint endpoint
 *
 * See docs/mcp-hosted-sse-deploy.md for the full runbook.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { sessionStore } from './sessionStore.js';
import { issueAccessToken, verifyAccessToken } from './tokens.js';
import { authorizationServerMetadata, protectedResourceMetadata } from './metadata.js';
// ── Configuration ──────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3334);
const HOST = process.env.HOST || '0.0.0.0';
const ISSUER = process.env.OAUTH_ISSUER || `http://${HOST}:${PORT}`;
const LOAR_SERVER_URL = process.env.LOAR_SERVER_URL || 'http://localhost:3000';
const LOAR_WEB_URL = process.env.LOAR_WEB_URL || 'http://localhost:5173';
if (!process.env.OAUTH_JWT_SECRET) {
    console.error('ERROR: OAUTH_JWT_SECRET is required (openssl rand -hex 32)');
    process.exit(1);
}
// ── HTTP Router ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    let url;
    try {
        url = new URL(req.url ?? '/', ISSUER);
    }
    catch {
        res.writeHead(400).end('Bad Request');
        return;
    }
    try {
        // OAuth 2.1 discovery — RFC 8414
        if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
            res
                .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' })
                .end(JSON.stringify(authorizationServerMetadata(ISSUER)));
            return;
        }
        // MCP OAuth protected resource metadata
        if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
            res
                .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' })
                .end(JSON.stringify(protectedResourceMetadata(ISSUER)));
            return;
        }
        // Authorization endpoint — starts the login dance
        if (req.method === 'GET' && url.pathname === '/authorize') {
            return handleAuthorize(req, res, url);
        }
        // Callback — LOAR web redirects here after SIWE completes
        if (req.method === 'GET' && url.pathname === '/callback') {
            return handleCallback(req, res, url);
        }
        // Token endpoint — authz code / refresh token exchange
        if (req.method === 'POST' && url.pathname === '/token') {
            return handleToken(req, res);
        }
        // MCP SSE endpoint — requires Bearer access token
        if (req.method === 'GET' && url.pathname === '/sse') {
            return handleSse(req, res);
        }
        // MCP message relay
        if (req.method === 'POST' && url.pathname === '/messages') {
            return handleMessages(req, res, url);
        }
        // Health
        if (req.method === 'GET' && url.pathname === '/health') {
            res
                .writeHead(200, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({
                ok: true,
                sessions: sessionStore.activeSessionCount(),
                issuer: ISSUER,
                version: '0.1.0',
            }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not_found', path: url.pathname }));
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[gateway] unhandled error on ${req.method} ${url.pathname}: ${message}`);
        if (!res.headersSent) {
            res
                .writeHead(500, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ error: 'server_error', message }));
        }
    }
});
// ── Authorize ──────────────────────────────────────────────────────────
//
// Per OAuth 2.1 + PKCE, the agent client redirects the user here with:
//   client_id, redirect_uri, response_type=code, scope,
//   code_challenge, code_challenge_method=S256, state
//
// We store the PKCE challenge + redirect_uri keyed by a short-lived authz
// code and then redirect the user to LOAR web's SIWE login page. On return
// (via /callback) we issue the code back to the agent's redirect_uri.
function handleAuthorize(req, res, url) {
    const params = url.searchParams;
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const responseType = params.get('response_type');
    const codeChallenge = params.get('code_challenge');
    const codeChallengeMethod = params.get('code_challenge_method');
    const scope = params.get('scope') ?? '';
    const state = params.get('state') ?? '';
    if (!clientId || !redirectUri || responseType !== 'code') {
        return oauthError(res, 'invalid_request', 'missing client_id, redirect_uri, or response_type');
    }
    if (!codeChallenge || codeChallengeMethod !== 'S256') {
        return oauthError(res, 'invalid_request', 'PKCE S256 code_challenge required');
    }
    // Persist the pending authorization.
    const authzCode = `authz_${crypto.randomBytes(24).toString('hex')}`;
    sessionStore.savePendingAuthorization(authzCode, {
        clientId,
        redirectUri,
        codeChallenge,
        scope,
        state,
        createdAt: Date.now(),
    });
    // Redirect to LOAR web SIWE. The LOAR web app will sign-in and then
    // redirect to /callback?authz=<code>&address=0x...&sig=...  which
    // completes the handshake.
    const siweUrl = new URL(`${LOAR_WEB_URL}/oauth/siwe`);
    siweUrl.searchParams.set('authz', authzCode);
    siweUrl.searchParams.set('return_to', `${ISSUER}/callback`);
    res.writeHead(302, { Location: siweUrl.toString() }).end();
}
// ── Callback ───────────────────────────────────────────────────────────
//
// LOAR web posts the signed SIWE payload back to us via a fragment-free
// GET redirect (params in query string). We verify the signature by
// calling LOAR's server-side /auth/siwe/verify endpoint (already exists),
// extract the wallet address, and redirect the agent client back to its
// original redirect_uri with the authz code.
async function handleCallback(req, res, url) {
    const authzCode = url.searchParams.get('authz');
    const address = url.searchParams.get('address');
    const signature = url.searchParams.get('signature');
    const message = url.searchParams.get('message');
    if (!authzCode || !address || !signature || !message) {
        return oauthError(res, 'invalid_request', 'missing authz/address/signature/message');
    }
    const pending = sessionStore.consumePendingAuthorization(authzCode);
    if (!pending) {
        return oauthError(res, 'invalid_grant', 'authz code expired or unknown');
    }
    // Verify the SIWE signature upstream. (Stub — wire to apps/server SIWE verify.)
    // const verifyRes = await fetch(`${LOAR_SERVER_URL}/auth/siwe/verify`, {...});
    // if (!verifyRes.ok) return oauthError(res, 'access_denied', 'SIWE verification failed');
    //
    // For scaffold purposes we assume the SIWE payload is valid. Production
    // must call the verify endpoint before binding the session to a wallet.
    // Bind the authz code → wallet address so /token can exchange it.
    sessionStore.bindAuthorizationToWallet(authzCode, address, {
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        scope: pending.scope,
    });
    // Return to the agent client's redirect_uri with the authz code + state.
    const target = new URL(pending.redirectUri);
    target.searchParams.set('code', authzCode);
    if (pending.state)
        target.searchParams.set('state', pending.state);
    res.writeHead(302, { Location: target.toString() }).end();
}
// ── Token ──────────────────────────────────────────────────────────────
//
// Exchanges an authz code (+ PKCE code_verifier) for a short-lived access
// token. The access token is an opaque JWT signed by OAUTH_JWT_SECRET
// carrying { sub: walletAddress, scope: 'mcp_server' }. When the agent
// opens /sse with Bearer <token>, we verify, look up (or mint) a
// per-wallet loar_* API key, and open an MCP session on their behalf.
async function handleToken(req, res) {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const grantType = params.get('grant_type');
    const code = params.get('code');
    const codeVerifier = params.get('code_verifier');
    const redirectUri = params.get('redirect_uri');
    const clientId = params.get('client_id');
    if (grantType !== 'authorization_code') {
        return oauthError(res, 'unsupported_grant_type', 'only authorization_code is supported');
    }
    if (!code || !codeVerifier || !redirectUri || !clientId) {
        return oauthError(res, 'invalid_request', 'missing code, code_verifier, redirect_uri, or client_id');
    }
    const bound = sessionStore.consumeBoundAuthorization(code);
    if (!bound) {
        return oauthError(res, 'invalid_grant', 'authz code unknown or already redeemed');
    }
    if (bound.clientId !== clientId || bound.redirectUri !== redirectUri) {
        return oauthError(res, 'invalid_grant', 'client_id/redirect_uri mismatch');
    }
    // PKCE check.
    const computedChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');
    if (computedChallenge !== bound.codeChallenge) {
        return oauthError(res, 'invalid_grant', 'PKCE verifier mismatch');
    }
    // Mint access token.
    const accessToken = await issueAccessToken({
        sub: bound.walletAddress,
        scope: bound.scope || 'mcp_server',
        aud: ISSUER,
    });
    res
        .writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
    })
        .end(JSON.stringify({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 60 * 60, // 1 hour
        scope: bound.scope || 'mcp_server',
    }));
}
// ── SSE ────────────────────────────────────────────────────────────────
//
// Verifies the Bearer access token, then opens an MCP session forwarded
// to the LOAR server. Per-wallet API keys (minted on first use) live in
// the session store so we don't round-trip to LOAR on every session.
async function handleSse(req, res) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="mcp.loar.fun"' }).end();
        return;
    }
    const payload = await verifyAccessToken(token).catch(() => null);
    if (!payload?.sub) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer error="invalid_token"' }).end();
        return;
    }
    // Look up / mint a per-wallet MCP-scoped loar_* key. Stub — production
    // wires to `apps/server` tRPC `apiKeys.create({ permissions: ['mcp_server'] })`
    // as a privileged gateway-service call. The gateway must authenticate to
    // LOAR with a service-level admin key so it can mint user-scoped keys.
    // const apiKey = await mintKeyForWallet(payload.sub);
    const apiKey = process.env.LOAR_API_KEY; // SCAFFOLD — single shared key
    if (!apiKey) {
        res.writeHead(503).end('Gateway not configured (LOAR_API_KEY missing)');
        return;
    }
    // Spawn an MCP session bound to this wallet. Actual MCP Server construction
    // is delegated to `@loar/mcp-server` — the gateway imports and runs it
    // in-process, pointed at the LOAR tRPC server with X-Loar-End-User-Address
    // = payload.sub. Scaffold only.
    sessionStore.openSession({
        walletAddress: payload.sub,
        response: res,
        onClose: () => {
            console.error(`[gateway] SSE session closed for ${payload.sub}`);
        },
    });
}
// ── Messages ───────────────────────────────────────────────────────────
async function handleMessages(req, res, url) {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
        res.writeHead(400).end('sessionId required');
        return;
    }
    const session = sessionStore.getSession(sessionId);
    if (!session) {
        res.writeHead(404).end('unknown sessionId');
        return;
    }
    // Body is JSON-RPC — forward to the session's MCP transport.
    // Scaffold — production: await session.transport.handlePostMessage(req, res);
    res.writeHead(501).end('not implemented — see docs/mcp-hosted-sse-deploy.md');
}
// ── Helpers ────────────────────────────────────────────────────────────
function oauthError(res, code, description) {
    res
        .writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: code, error_description: description }));
}
async function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
// ── Start ──────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
    console.error(`LOAR MCP Gateway v0.1.0 (scaffold) listening on http://${HOST}:${PORT}`);
    console.error(`  Issuer: ${ISSUER}`);
    console.error(`  Upstream LOAR server: ${LOAR_SERVER_URL}`);
    console.error(`  OAuth metadata: ${ISSUER}/.well-known/oauth-authorization-server`);
    console.error(`  Health: ${ISSUER}/health`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
