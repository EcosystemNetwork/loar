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
import { KNOWN_PROGRAM_IDS, PROGRAMS } from './program-registry';
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
//
// Sourced from program-registry.ts — adding a new Anchor program (rights,
// licensing, marketplace, …) auto-extends routing the moment its IDL is
// registered. PROGRAM_IDS_FOR_HANDLER preserves the per-program lookup used by
// the typed Universe/Episode handler; everything else flows through the
// generic event mirror so new programs index without code changes here.
const ANCHOR_PROGRAM_IDS = KNOWN_PROGRAM_IDS;
const BUBBLEGUM_PROGRAM_ID = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
// ── Handlers ────────────────────────────────────────────────────────────────
/**
 * Decode Anchor events from a tx and write canonical entity docs.
 *
 * Idempotency model:
 *   - `solanaEvents/{signature}_{ix}` is the canonical "did we process this?" gate.
 *     Inserted in a Firestore transaction; if it already exists, we skip the
 *     downstream side-effects entirely. Helius retries webhook deliveries on
 *     any 5xx — without this gate, non-commutative ops like
 *     FieldValue.increment(canonCount) drift on every retry.
 *   - Entity docs (solanaUniverses, solanaEpisodes) use `merge: true`; their
 *     writes are intrinsically idempotent for same-value updates.
 */
async function handleAnchorEvents(tx) {
    if (ANCHOR_PROGRAM_IDS.size === 0)
        return;
    const events = decodeEventsFromTx({
        instructions: (tx.instructions ?? []).map((ix) => ({
            programId: ix.programId,
            data: ix.data,
            innerInstructions: (ix.innerInstructions ?? []),
        })),
        knownProgramIds: ANCHOR_PROGRAM_IDS,
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
        // Idempotency gate. Returns true on the FIRST handling of this event;
        // false on retries. Only first-handlings run non-commutative side-effects
        // (e.g. canonCount increment). The doc stores the raw IDL-decoded event
        // unconditionally so new programs added to the registry start indexing
        // immediately, even before dedicated typed handlers exist.
        const eventRef = db.collection('solanaEvents').doc(docId);
        const isFirstHandling = await db.runTransaction(async (t) => {
            const existing = await t.get(eventRef);
            if (existing.exists)
                return false;
            t.set(eventRef, {
                ...base,
                kind: event.kind,
                program: event.raw.program,
                programId: event.raw.programId,
                eventName: event.raw.name,
                payload: event.raw.data,
            });
            return true;
        });
        if (event.kind === 'UniverseCreated') {
            await db
                .collection('solanaUniverses')
                .doc(event.universe)
                .set({
                ...base,
                universe: event.universe,
                creator: event.creator,
                contentHashHex: event.contentHashHex,
                plotHashHex: event.plotHashHex,
                visibility: event.visibility,
                // Only set canonCount=0 on first handling — never overwrite a
                // counter that an EpisodeCanonized event has already incremented.
                ...(isFirstHandling ? { canonCount: 0 } : {}),
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
            await db
                .collection('solanaEpisodes')
                .doc(event.episode)
                .set({
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
            // Counter increment ONLY on first handling — FieldValue.increment is
            // not idempotent, and Helius retries deliveries on 5xx.
            if (isFirstHandling) {
                await db
                    .collection('solanaUniverses')
                    .doc(event.universe)
                    .set({ canonCount: FieldValue.increment(1) }, { merge: true });
            }
        }
    }
}
function extractMintFromCompressed(events) {
    if (!events)
        return null;
    for (const raw of events) {
        const ev = raw;
        if (ev?.type === 'COMPRESSED_NFT_MINT' && ev.assetId)
            return ev;
    }
    // Some Helius payloads send the mint without an explicit `type` — fall back
    // to any entry that has an assetId.
    for (const raw of events) {
        const ev = raw;
        if (ev?.assetId)
            return ev;
    }
    return null;
}
async function handleBubblegumMint(tx) {
    const mint = extractMintFromCompressed(tx.events?.compressed);
    // Always mirror the raw payload — useful for debugging when Helius schema
    // shifts. Keyed by signature so retries dedupe naturally (merge=true).
    await db
        .collection('solanaCnftMints')
        .doc(tx.signature)
        .set({
        signature: tx.signature,
        slot: tx.slot,
        timestamp: tx.timestamp,
        feePayer: tx.feePayer,
        // Extracted typed fields (null if not a mint event):
        assetId: mint?.assetId ?? null,
        tree: mint?.tree ?? null,
        leafIndex: mint?.leafIndex ?? null,
        leafOwner: mint?.newLeafOwner ?? null,
        // Raw payload for forensics — Firestore stores up to 1MB per doc.
        compressed: tx.events?.compressed ?? null,
        processedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    // Side-index keyed by assetId so downstream UIs can look up cNFTs by their
    // canonical Solana asset address without scanning by signature. Only
    // written when we actually extracted an assetId — avoids polluting with
    // null docs from non-mint Bubblegum txs (transfer, burn, decompress).
    if (mint?.assetId) {
        await db
            .collection('solanaCnftAssets')
            .doc(mint.assetId)
            .set({
            assetId: mint.assetId,
            tree: mint.tree ?? null,
            leafIndex: mint.leafIndex ?? null,
            leafOwner: mint.newLeafOwner ?? null,
            mintedSig: tx.signature,
            mintedSlot: tx.slot,
            mintedAt: tx.timestamp,
            // joinedEpisode is populated by a follow-up reconciliation worker
            // that matches (leafOwner, mintedAt) → solanaEpisodes.creator —
            // for now leave null and let downstream consumers do the lookup.
        }, { merge: true });
    }
}
async function routeTx(tx) {
    const programs = new Set(tx.instructions?.map((i) => i.programId) ?? []);
    const tasks = [];
    // Anchor program calls — decoded into typed entity docs (Universe/Episode)
    // and mirrored as generic event docs for every registered LOAR program.
    // Fires when ANY registered program is touched in this tx.
    let hitAnchorProgram = false;
    for (const id of ANCHOR_PROGRAM_IDS) {
        if (programs.has(id)) {
            hitAnchorProgram = true;
            break;
        }
    }
    if (hitAnchorProgram) {
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
// In-memory health metrics — process-local, reset on restart. Good enough for
// the "is anything getting through?" question that prompts most pages.
const health = {
    startedAt: Date.now(),
    webhookDeliveries: 0,
    txsProcessed: 0,
    txsFailed: 0,
    /** Sliding-window of recent failures so /healthz can surface the rate. */
    recentFailures: [],
    lastWebhookAt: 0,
    lastSuccessSig: '',
    lastSuccessAt: 0,
};
function recordFailure() {
    health.txsFailed++;
    const now = Date.now();
    health.recentFailures.push(now);
    // Trim anything older than 1h.
    const cutoff = now - 60 * 60 * 1000;
    while (health.recentFailures.length > 0 && health.recentFailures[0] < cutoff) {
        health.recentFailures.shift();
    }
}
app.get('/healthz', async (c) => {
    // Quick Firestore reachability probe — bounded so a 30s timeout never blocks
    // health response. Cached at the load-balancer level normally.
    let firestoreReachable = null;
    try {
        if (db) {
            await Promise.race([
                db.collection('_health').limit(1).get(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500)),
            ]);
            firestoreReachable = true;
        }
    }
    catch {
        firestoreReachable = false;
    }
    const now = Date.now();
    const recentFailuresLastHour = health.recentFailures.length;
    // Stale signal: no webhook in 30min while service has been up > 1h.
    // Helius docs guarantee continuous delivery while the program is active, so
    // a long gap usually means the webhook registration drifted.
    const upMs = now - health.startedAt;
    const lastWebhookAgeMs = health.lastWebhookAt ? now - health.lastWebhookAt : null;
    const isStale = upMs > 60 * 60 * 1000 && (lastWebhookAgeMs === null || lastWebhookAgeMs > 30 * 60 * 1000);
    const ok = firestoreReachable !== false && !isStale && recentFailuresLastHour < 100;
    return c.json({
        ok,
        stale: isStale,
        firestoreReachable,
        uptimeSeconds: Math.floor(upMs / 1000),
        webhookDeliveries: health.webhookDeliveries,
        txsProcessed: health.txsProcessed,
        txsFailed: health.txsFailed,
        recentFailuresLastHour,
        lastWebhookAgeSeconds: lastWebhookAgeMs === null ? null : Math.floor(lastWebhookAgeMs / 1000),
        lastSuccessSig: health.lastSuccessSig || null,
        lastSuccessAgeSeconds: health.lastSuccessAt
            ? Math.floor((now - health.lastSuccessAt) / 1000)
            : null,
    }, ok ? 200 : 503);
});
app.post('/webhooks/helius', async (c) => {
    if (!verifyHeliusAuth(c.req.header('Authorization'))) {
        log.warn('Rejected Helius webhook with missing/mismatched auth header');
        return c.json({ error: 'unauthorized' }, 401);
    }
    health.webhookDeliveries++;
    health.lastWebhookAt = Date.now();
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
        const batch = parsed.slice(i, i + 10);
        const results = await Promise.allSettled(batch.map(routeTx));
        for (let j = 0; j < results.length; j++) {
            const r = results[j];
            if (r.status === 'fulfilled') {
                health.txsProcessed++;
                health.lastSuccessSig = batch[j].signature;
                health.lastSuccessAt = Date.now();
            }
            else {
                recordFailure();
                log.error({ err: r.reason, sig: batch[j].signature }, 'tx route failed');
            }
        }
    }
    return c.json({ processed: parsed.length });
});
// ── Boot ────────────────────────────────────────────────────────────────────
const port = Number(process.env.SOLANA_INDEXER_PORT ?? 42070);
serve({ fetch: app.fetch, port }, (info) => {
    log.info({ programs: PROGRAMS.map((p) => ({ name: p.name, programId: p.programId })) }, `solana-indexer listening on :${info.port}`);
});
//# sourceMappingURL=index.js.map