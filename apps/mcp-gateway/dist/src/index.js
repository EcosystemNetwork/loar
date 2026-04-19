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
 * Env:
 *   PORT, HOST, OAUTH_ISSUER, OAUTH_JWT_SECRET, LOAR_SERVER_URL,
 *   LOAR_WEB_URL, REDIS_URL (optional), MCP_GATEWAY_SERVICE_KEY
 *
 * See docs/mcp-hosted-sse-deploy.md for the full deploy runbook.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer as createMcpServer, setupHandlers, LoarClient } from '@loar/mcp-server';
import { sessionStore } from './sessionStore.js';
import { issueAccessToken, verifyAccessToken } from './tokens.js';
import { authorizationServerMetadata, protectedResourceMetadata } from './metadata.js';
// ── Configuration ──────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3334);
const HOST = process.env.HOST || '0.0.0.0';
const ISSUER = process.env.OAUTH_ISSUER || `http://${HOST}:${PORT}`;
const LOAR_SERVER_URL = process.env.LOAR_SERVER_URL || 'http://localhost:3000';
const LOAR_WEB_URL = process.env.LOAR_WEB_URL || 'http://localhost:5173';
const SERVICE_KEY = process.env.MCP_GATEWAY_SERVICE_KEY;
if (!process.env.OAUTH_JWT_SECRET) {
    console.error('ERROR: OAUTH_JWT_SECRET is required (openssl rand -hex 32)');
    process.exit(1);
}
if (!SERVICE_KEY) {
    console.error('ERROR: MCP_GATEWAY_SERVICE_KEY is required (openssl rand -hex 32)');
    console.error('       Same value must be configured in apps/server so the key-mint');
    console.error('       procedure accepts our inbound requests.');
    process.exit(1);
}
// ── Active MCP transports (in-memory — SSE streams cannot be serialized) ──
const transports = new Map();
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
        if (req.method === 'GET' && url.pathname === '/authorize') {
            return handleAuthorize(req, res, url);
        }
        if (req.method === 'GET' && url.pathname === '/callback') {
            return handleCallback(req, res, url);
        }
        if (req.method === 'POST' && url.pathname === '/token') {
            return handleToken(req, res);
        }
        if (req.method === 'GET' && url.pathname === '/sse') {
            return handleSse(req, res);
        }
        if (req.method === 'POST' && url.pathname === '/messages') {
            return handleMessages(req, res, url);
        }
        if (req.method === 'GET' && url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                ok: true,
                sessions: transports.size,
                issuer: ISSUER,
                version: '0.1.0',
            }));
            return;
        }
        res
            .writeHead(404, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ error: 'not_found', path: url.pathname }));
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
async function handleAuthorize(req, res, url) {
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
    const authzCode = `authz_${crypto.randomBytes(24).toString('hex')}`;
    await sessionStore.savePendingAuthorization(authzCode, {
        clientId,
        redirectUri,
        codeChallenge,
        scope,
        state,
        createdAt: Date.now(),
    });
    const siweUrl = new URL(`${LOAR_WEB_URL}/oauth/siwe`);
    siweUrl.searchParams.set('authz', authzCode);
    siweUrl.searchParams.set('return_to', `${ISSUER}/callback`);
    res.writeHead(302, { Location: siweUrl.toString() }).end();
}
// ── Callback ───────────────────────────────────────────────────────────
async function handleCallback(req, res, url) {
    const authzCode = url.searchParams.get('authz');
    const address = url.searchParams.get('address');
    const signature = url.searchParams.get('signature');
    const message = url.searchParams.get('message');
    if (!authzCode || !address || !signature || !message) {
        return oauthError(res, 'invalid_request', 'missing authz/address/signature/message');
    }
    const pending = await sessionStore.consumePendingAuthorization(authzCode);
    if (!pending) {
        return oauthError(res, 'invalid_grant', 'authz code expired or unknown');
    }
    // Verify the SIWE signature via the upstream LOAR server. LOAR's
    // /auth/verify endpoint returns { address, expiresAt } on success and
    // sets an httpOnly cookie as a side-effect (cookie is harmless — the
    // user may also be signing into LOAR on the browser as a side-effect).
    let verifiedAddress = address.toLowerCase();
    try {
        const verifyRes = await fetch(`${LOAR_SERVER_URL}/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, signature }),
        });
        if (!verifyRes.ok) {
            const body = await verifyRes.text().catch(() => '');
            console.error(`[gateway] SIWE verify failed (${verifyRes.status}): ${body}`);
            return oauthError(res, 'access_denied', 'SIWE verification failed');
        }
        const data = (await verifyRes.json());
        if (data.address && data.address.toLowerCase() !== verifiedAddress) {
            // The signature resolved to a different address than the one the web
            // page claimed. Trust the server's recovered address.
            verifiedAddress = data.address.toLowerCase();
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[gateway] SIWE verify error: ${msg}`);
        return oauthError(res, 'server_error', 'could not reach upstream SIWE verify');
    }
    await sessionStore.bindAuthorizationToWallet(authzCode, verifiedAddress, {
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        scope: pending.scope,
    });
    const target = new URL(pending.redirectUri);
    target.searchParams.set('code', authzCode);
    if (pending.state)
        target.searchParams.set('state', pending.state);
    res.writeHead(302, { Location: target.toString() }).end();
}
// ── Token ──────────────────────────────────────────────────────────────
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
    const bound = await sessionStore.consumeBoundAuthorization(code);
    if (!bound) {
        return oauthError(res, 'invalid_grant', 'authz code unknown or already redeemed');
    }
    if (bound.clientId !== clientId || bound.redirectUri !== redirectUri) {
        return oauthError(res, 'invalid_grant', 'client_id/redirect_uri mismatch');
    }
    const computedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    if (computedChallenge !== bound.codeChallenge) {
        return oauthError(res, 'invalid_grant', 'PKCE verifier mismatch');
    }
    const accessToken = await issueAccessToken({
        sub: bound.walletAddress,
        scope: bound.scope || 'mcp_server',
        aud: ISSUER,
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 60 * 60,
        scope: bound.scope || 'mcp_server',
    }));
}
// ── Key minting (per-wallet MCP-scoped loar_* key) ─────────────────────
/**
 * Call LOAR's privileged key-mint procedure. The gateway authenticates
 * with `MCP_GATEWAY_SERVICE_KEY` (shared secret, validated server-side
 * against an env var of the same name). Result is cached per-wallet.
 */
async function mintKeyForWallet(walletAddress) {
    const cached = await sessionStore.getCachedApiKey(walletAddress);
    if (cached)
        return cached;
    const res = await fetch(`${LOAR_SERVER_URL}/api/internal/mint-mcp-key`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Service-Key': SERVICE_KEY,
        },
        body: JSON.stringify({ walletAddress }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`key-mint failed (${res.status}): ${body}`);
    }
    const json = (await res.json());
    const rawKey = json.result?.data?.rawKey;
    if (!rawKey)
        throw new Error('key-mint returned no rawKey');
    // Cache for 30 days (matching the server-side TTL).
    await sessionStore.cacheApiKey(walletAddress, rawKey, 30 * 24 * 60 * 60 * 1000);
    return rawKey;
}
// ── SSE ────────────────────────────────────────────────────────────────
async function handleSse(req, res) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) {
        res
            .writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer realm="${ISSUER}", error="invalid_token"`,
        })
            .end(JSON.stringify({ error: 'invalid_token', error_description: 'Bearer token required' }));
        return;
    }
    const payload = await verifyAccessToken(token).catch(() => null);
    if (!payload?.sub) {
        res
            .writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer realm="${ISSUER}", error="invalid_token"`,
        })
            .end(JSON.stringify({ error: 'invalid_token' }));
        return;
    }
    const walletAddress = payload.sub.toLowerCase();
    let apiKey;
    try {
        apiKey = await mintKeyForWallet(walletAddress);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[gateway] key-mint failed for ${walletAddress}: ${msg}`);
        res
            .writeHead(503, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ error: 'gateway_dependency_failed', message: msg }));
        return;
    }
    // Spin up a dedicated MCP server instance for this session, pointed at
    // the upstream LOAR server with the per-wallet key + end-user passthrough.
    const client = new LoarClient({
        serverUrl: LOAR_SERVER_URL,
        apiKey,
        endUserAddress: walletAddress,
    });
    const mcpServer = createMcpServer();
    setupHandlers(mcpServer, client);
    const transport = new SSEServerTransport('/messages', res);
    try {
        await mcpServer.connect(transport);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[gateway] mcp connect failed for ${walletAddress}: ${msg}`);
        if (!res.headersSent)
            res.writeHead(500).end('mcp connect failed');
        return;
    }
    const close = async () => {
        if (!transports.delete(transport.sessionId))
            return;
        try {
            await transport.close();
        }
        catch {
            /* best effort */
        }
        try {
            await mcpServer.close();
        }
        catch {
            /* best effort */
        }
        console.error(`[gateway] session closed: ${transport.sessionId} wallet=${walletAddress} active=${transports.size}`);
    };
    transports.set(transport.sessionId, { transport, walletAddress, close });
    console.error(`[gateway] session opened: ${transport.sessionId} wallet=${walletAddress} active=${transports.size}`);
    req.on('close', close);
    transport.onclose = close;
}
// ── Messages ───────────────────────────────────────────────────────────
async function handleMessages(req, res, url) {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
        res
            .writeHead(400, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ error: 'missing sessionId' }));
        return;
    }
    const entry = transports.get(sessionId);
    if (!entry) {
        res
            .writeHead(404, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ error: 'unknown sessionId' }));
        return;
    }
    try {
        await entry.transport.handlePostMessage(req, res);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[gateway] handlePostMessage failed (${sessionId}): ${msg}`);
        if (!res.headersSent)
            res.writeHead(500).end(msg);
    }
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
    console.error(`LOAR MCP Gateway v0.1.0 listening on http://${HOST}:${PORT}`);
    console.error(`  Issuer: ${ISSUER}`);
    console.error(`  Upstream LOAR server: ${LOAR_SERVER_URL}`);
    console.error(`  OAuth metadata: ${ISSUER}/.well-known/oauth-authorization-server`);
    console.error(`  Health: ${ISSUER}/health`);
});
async function shutdown(signal) {
    console.error(`[gateway] ${signal} — draining ${transports.size} session(s)…`);
    await Promise.allSettled([...transports.values()].map((e) => e.close()));
    server.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
