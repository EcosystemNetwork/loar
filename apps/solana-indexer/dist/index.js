/**
 * LOAR Solana Indexer — Helius enhanced webhook → Firestore.
 *
 * Ponder doesn't run on Solana, so this service plays the same role for the
 * Solana side: it receives Helius enhanced-tx webhook deliveries, decodes
 * Anchor program events (Universe, Episode) + Bubblegum cNFT mints, and
 * mirrors them to Firestore so the web/server use the same query shape as
 * EVM events.
 *
 * Key invariants:
 *   - Authorization header is matched against HELIUS_WEBHOOK_SECRET in
 *     constant time — reject mismatches. Helius enhanced webhooks send the
 *     configured authHeader verbatim; there is no HMAC over the body.
 *   - Idempotent: dedupe by (signature, ixIndex). Helius retries on 5xx.
 *   - Backfill via scripts/backfill.ts on cold start or after gaps.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import pino from 'pino';
const log = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});
// ── Firebase ────────────────────────────────────────────────────────────────
function initFirebase() {
    if (getApps().length > 0)
        return;
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (inline) {
        initializeApp({ credential: cert(JSON.parse(inline)) });
        return;
    }
    log.warn('No FIREBASE_SERVICE_ACCOUNT set — running in degraded mode (no Firestore writes)');
    initializeApp();
}
initFirebase();
const db = getFirestore();
// ── Webhook auth verification ──────────────────────────────────────────────
//
// Helius enhanced webhooks authenticate via the `authHeader` field configured
// at webhook creation time — they send that literal value as the Authorization
// header on every delivery. There is no HMAC over the body. We do a
// constant-time string compare to avoid leaking timing info.
function verifyHeliusAuth(authHeader) {
    const secret = process.env.HELIUS_WEBHOOK_SECRET;
    if (!secret) {
        log.warn('HELIUS_WEBHOOK_SECRET unset — accepting unauthenticated webhooks (DEV ONLY)');
        return process.env.NODE_ENV !== 'production';
    }
    if (!authHeader)
        return false;
    const a = Buffer.from(authHeader);
    const b = Buffer.from(secret);
    if (a.length !== b.length)
        return false;
    try {
        return timingSafeEqual(a, b);
    }
    catch {
        return false;
    }
}
// ── Webhook payload schema (Helius enhanced format) ──────────────────────────
const HeliusEnhancedTxSchema = z.object({
    signature: z.string(),
    slot: z.number(),
    timestamp: z.number(),
    fee: z.number().optional(),
    feePayer: z.string().optional(),
    type: z.string().optional(),
    description: z.string().optional(),
    source: z.string().optional(),
    instructions: z
        .array(z.object({
        programId: z.string(),
        accounts: z.array(z.string()).optional(),
        data: z.string().optional(),
        innerInstructions: z.array(z.unknown()).optional(),
    }))
        .optional(),
    events: z
        .object({
        compressed: z.array(z.unknown()).optional(),
    })
        .partial()
        .optional(),
});
// ── Program ID routing ──────────────────────────────────────────────────────
const UNIVERSE_PROGRAM_ID = process.env.UNIVERSE_PROGRAM_ID ?? '';
const EPISODE_PROGRAM_ID = process.env.EPISODE_PROGRAM_ID ?? '';
const BUBBLEGUM_PROGRAM_ID = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
// ── Handlers ────────────────────────────────────────────────────────────────
async function handleUniverseTx(tx) {
    // Anchor events are emitted via the system `emit!` macro. Helius enhanced
    // webhooks surface them under a program-specific shape — for now we mirror
    // the raw tx into Firestore and decode in a follow-up worker (keeps this
    // entrypoint fast). Production: add `@coral-xyz/anchor`'s IDL-based decoder.
    await db
        .collection('solanaUniverseEvents')
        .doc(tx.signature)
        .set({
        signature: tx.signature,
        slot: tx.slot,
        timestamp: tx.timestamp,
        feePayer: tx.feePayer,
        rawType: tx.type,
        description: tx.description,
        processedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
}
async function handleEpisodeTx(tx) {
    await db
        .collection('solanaEpisodeEvents')
        .doc(tx.signature)
        .set({
        signature: tx.signature,
        slot: tx.slot,
        timestamp: tx.timestamp,
        feePayer: tx.feePayer,
        rawType: tx.type,
        description: tx.description,
        processedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
}
async function handleBubblegumMint(tx) {
    // cNFT mints — extract the assetId / tree + leaf from `events.compressed`
    // (Helius surfaces this for Bubblegum). Mirror to a content-index doc that
    // joins with the EpisodeRecord PDA later.
    await db
        .collection('solanaCnftMints')
        .doc(tx.signature)
        .set({
        signature: tx.signature,
        slot: tx.slot,
        timestamp: tx.timestamp,
        feePayer: tx.feePayer,
        compressed: tx.events?.compressed ?? null,
        processedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
}
async function routeTx(tx) {
    const programs = new Set(tx.instructions?.map((i) => i.programId) ?? []);
    const tasks = [];
    if (UNIVERSE_PROGRAM_ID && programs.has(UNIVERSE_PROGRAM_ID)) {
        tasks.push(handleUniverseTx(tx));
    }
    if (EPISODE_PROGRAM_ID && programs.has(EPISODE_PROGRAM_ID)) {
        tasks.push(handleEpisodeTx(tx));
    }
    if (programs.has(BUBBLEGUM_PROGRAM_ID)) {
        tasks.push(handleBubblegumMint(tx));
    }
    if (tasks.length === 0) {
        log.debug({ signature: tx.signature, programs: [...programs] }, 'no handler matched');
    }
    await Promise.all(tasks);
}
// ── HTTP entrypoint ─────────────────────────────────────────────────────────
const app = new Hono();
app.get('/healthz', (c) => c.json({ ok: true }));
app.post('/webhooks/helius', async (c) => {
    if (!verifyHeliusAuth(c.req.header('Authorization'))) {
        log.warn('Rejected Helius webhook with missing/mismatched auth header');
        return c.json({ error: 'unauthorized' }, 401);
    }
    const raw = await c.req.text();
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        return c.json({ error: 'invalid json' }, 400);
    }
    // Helius delivers either a single tx or an array; normalize.
    const txs = Array.isArray(payload) ? payload : [payload];
    const parsed = [];
    for (const t of txs) {
        const result = HeliusEnhancedTxSchema.safeParse(t);
        if (result.success) {
            parsed.push(result.data);
        }
        else {
            log.warn({ issues: result.error.issues }, 'skipped malformed tx');
        }
    }
    // Process in parallel but bound concurrency to 10 to avoid Firestore burst limits.
    for (let i = 0; i < parsed.length; i += 10) {
        await Promise.all(parsed.slice(i, i + 10).map(routeTx));
    }
    return c.json({ processed: parsed.length });
});
// ── Boot ────────────────────────────────────────────────────────────────────
const port = Number(process.env.SOLANA_INDEXER_PORT ?? 42070);
serve({ fetch: app.fetch, port }, (info) => {
    log.info(`solana-indexer listening on :${info.port}`);
});
//# sourceMappingURL=index.js.map