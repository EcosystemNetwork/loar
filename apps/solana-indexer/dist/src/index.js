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
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { decodeEventsFromTx } from './anchor-events';
const __dirname = dirname(fileURLToPath(import.meta.url));
const log = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});
// ── Firebase ────────────────────────────────────────────────────────────────
/**
 * Mirrors apps/server/src/lib/firebase.ts init logic:
 *   1. JSON inline via FIREBASE_SERVICE_ACCOUNT (preferred)
 *   2. File path via FIREBASE_SERVICE_ACCOUNT_PATH (relative to repo root)
 *   3. Degraded mode (logs only) when neither is valid
 *
 * The `private_key` newline guard handles the common deploy footgun where the
 * env var is set with literal `\n` sequences (e.g. shell-escaped). JSON.parse
 * normally handles \n inside strings, but some platforms double-escape — this
 * replace is idempotent when the value is already properly escaped.
 */
function initFirebase() {
    if (getApps().length > 0)
        return;
    let serviceAccount;
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (inline) {
        try {
            const parsed = JSON.parse(inline);
            if (parsed.project_id &&
                parsed.project_id !== '...' &&
                parsed.private_key &&
                parsed.private_key !== '...') {
                if (typeof parsed.private_key === 'string' && parsed.private_key.includes('\\n')) {
                    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
                }
                serviceAccount = parsed;
            }
            else {
                log.warn('FIREBASE_SERVICE_ACCOUNT contains placeholder values — skipping init');
            }
        }
        catch (err) {
            log.warn({ err }, 'Failed to parse FIREBASE_SERVICE_ACCOUNT');
        }
    }
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        try {
            const absPath = resolve(__dirname, '../../../../', process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
            serviceAccount = JSON.parse(readFileSync(absPath, 'utf-8'));
        }
        catch (err) {
            log.warn({ err }, 'Failed to read FIREBASE_SERVICE_ACCOUNT_PATH');
        }
    }
    if (serviceAccount) {
        initializeApp({ credential: cert(serviceAccount) });
        log.info('Firebase Admin initialized');
    }
    else {
        log.warn('No valid Firebase credentials — running in degraded mode (no Firestore writes)');
        initializeApp();
    }
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
/**
 * Decode Anchor events from a tx and write canonical entity docs.
 * Idempotent — keyed by signature + event index so webhook retries dedupe.
 */
async function handleAnchorEvents(tx) {
    const known = new Set([UNIVERSE_PROGRAM_ID, EPISODE_PROGRAM_ID].filter(Boolean));
    if (known.size === 0)
        return;
    const events = decodeEventsFromTx({
        instructions: (tx.instructions ?? []).map((ix) => ({
            programId: ix.programId,
            data: ix.data,
            innerInstructions: (ix.innerInstructions ?? []),
        })),
        knownProgramIds: known,
    });
    if (events.length === 0)
        return;
    const base = {
        signature: tx.signature,
        slot: tx.slot,
        timestamp: tx.timestamp,
        feePayer: tx.feePayer,
        processedAt: FieldValue.serverTimestamp(),
    };
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const docId = `${tx.signature}_${i}`;
        if (event.kind === 'UniverseCreated') {
            await db.collection('solanaUniverses').doc(event.universe).set({
                ...base,
                universe: event.universe,
                creator: event.creator,
                contentHashHex: event.contentHashHex,
                plotHashHex: event.plotHashHex,
                visibility: event.visibility,
                canonCount: 0,
                createdSig: tx.signature,
            }, { merge: true });
        }
        else if (event.kind === 'UniversePublished') {
            await db
                .collection('solanaUniverses')
                .doc(event.universe)
                .set({ ...base, visibility: 'Public', publishedSig: tx.signature }, { merge: true });
        }
        else if (event.kind === 'EpisodeMinted') {
            await db.collection('solanaEpisodes').doc(event.episode).set({
                ...base,
                episode: event.episode,
                universe: event.universe,
                creator: event.creator,
                contentHashHex: event.contentHashHex,
                title: event.title,
                metadataUri: event.metadataUri,
                isCanon: false,
                mintedSig: tx.signature,
            }, { merge: true });
        }
        else if (event.kind === 'EpisodeCanonized') {
            await db
                .collection('solanaEpisodes')
                .doc(event.episode)
                .set({ ...base, isCanon: true, canonizedSig: tx.signature }, { merge: true });
            await db
                .collection('solanaUniverses')
                .doc(event.universe)
                .set({ canonCount: FieldValue.increment(1) }, { merge: true });
        }
        // Append-only raw event log for ops / debugging / reconciliation.
        await db
            .collection('solanaEvents')
            .doc(docId)
            .set({ ...base, kind: event.kind, payload: event }, { merge: true });
    }
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
    // Anchor program calls — decoded into typed entity docs.
    if ((UNIVERSE_PROGRAM_ID && programs.has(UNIVERSE_PROGRAM_ID)) ||
        (EPISODE_PROGRAM_ID && programs.has(EPISODE_PROGRAM_ID))) {
        tasks.push(handleAnchorEvents(tx));
    }
    // Bubblegum cNFT mints — separate handler so cNFT asset lookups by leaf
    // join later via signature → assetId (Helius DAS API).
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