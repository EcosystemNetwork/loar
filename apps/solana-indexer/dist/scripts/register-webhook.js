/**
 * Register the LOAR indexer as a Helius enhanced webhook — idempotent.
 *
 * Pre-flight checks before contacting Helius:
 *   1. SOLANA_INDEXER_PUBLIC_URL must respond 200 on /healthz.
 *   2. The endpoint must accept POST with our HELIUS_WEBHOOK_SECRET as
 *      Authorization header and 200 back on a synthetic payload.
 *
 * Then:
 *   - List Helius webhooks, find any whose `webhookURL` matches ours.
 *   - If found → PUT (update) so we don't accumulate duplicates on re-runs.
 *   - If not  → POST (create).
 *
 * Usage:
 *   HELIUS_API_KEY=... \
 *   SOLANA_INDEXER_PUBLIC_URL=https://idx-solana.loar.fun \
 *   HELIUS_WEBHOOK_SECRET=... \
 *   UNIVERSE_PROGRAM_ID=... EPISODE_PROGRAM_ID=... \
 *   pnpm -F @loar/solana-indexer register
 *
 * Helius docs: https://docs.helius.dev/webhooks-and-websockets/api-reference
 */
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PUBLIC_URL = process.env.SOLANA_INDEXER_PUBLIC_URL;
const SECRET = process.env.HELIUS_WEBHOOK_SECRET;
const CLUSTER = process.env.SOLANA_CLUSTER ?? 'devnet';
if (!HELIUS_API_KEY || !PUBLIC_URL || !SECRET) {
    console.error('Required: HELIUS_API_KEY, SOLANA_INDEXER_PUBLIC_URL, HELIUS_WEBHOOK_SECRET');
    process.exit(1);
}
const addresses = [
    process.env.UNIVERSE_PROGRAM_ID,
    process.env.EPISODE_PROGRAM_ID,
    process.env.PAYMENT_PROGRAM_ID,
    'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY', // Bubblegum
].filter((a) => !!a);
if (addresses.length === 0) {
    console.error('No program IDs set — at least UNIVERSE_PROGRAM_ID is required');
    process.exit(1);
}
const webhookURL = `${PUBLIC_URL.replace(/\/$/, '')}/webhooks/helius`;
const HELIUS_BASE = `https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`;
// ── Pre-flight ─────────────────────────────────────────────────────────────
async function preflight() {
    console.log(`▸ Checking indexer health at ${PUBLIC_URL}/healthz …`);
    const health = await fetch(`${PUBLIC_URL.replace(/\/$/, '')}/healthz`);
    if (!health.ok)
        throw new Error(`/healthz returned ${health.status}`);
    const body = await health.json().catch(() => null);
    if (!body || body.ok !== true) {
        throw new Error(`/healthz did not return { ok: true }`);
    }
    console.log('  ✓ /healthz ok');
    // Synthetic delivery: a minimal Helius-shaped payload signed with our auth
    // header. If the indexer rejects it as malformed we still get a 200/400 —
    // anything other than 401 proves the auth header check works. A 401 means
    // the indexer's HELIUS_WEBHOOK_SECRET disagrees with ours.
    console.log(`▸ Probing /webhooks/helius auth round-trip …`);
    const probe = await fetch(webhookURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: SECRET },
        body: JSON.stringify([{ signature: 'preflight', slot: 0, timestamp: 0 }]),
    });
    if (probe.status === 401) {
        throw new Error(`indexer rejected auth header (401) — HELIUS_WEBHOOK_SECRET mismatch between local + deployed`);
    }
    if (probe.status >= 500) {
        throw new Error(`indexer returned ${probe.status} on probe — check logs`);
    }
    console.log(`  ✓ auth round-trip ok (status ${probe.status})`);
}
async function listExisting() {
    const resp = await fetch(HELIUS_BASE);
    if (!resp.ok)
        throw new Error(`Helius list failed: ${resp.status} ${await resp.text()}`);
    return (await resp.json());
}
async function upsert() {
    await preflight();
    const existing = await listExisting();
    const match = existing.find((w) => w.webhookURL === webhookURL);
    const payload = {
        webhookURL,
        transactionTypes: ['ANY'],
        accountAddresses: addresses,
        webhookType: CLUSTER === 'devnet' ? 'enhancedDevnet' : 'enhanced',
        authHeader: SECRET,
    };
    if (match) {
        console.log(`▸ Updating existing webhook ${match.webhookID} …`);
        const resp = await fetch(`https://api.helius.xyz/v0/webhooks/${match.webhookID}?api-key=${HELIUS_API_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            throw new Error(`update failed: ${resp.status}\n${await resp.text()}`);
        }
        console.log(`  ✓ updated (${addresses.length} addresses)`);
    }
    else {
        console.log(`▸ Creating new webhook …`);
        const resp = await fetch(HELIUS_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            throw new Error(`create failed: ${resp.status}\n${await resp.text()}`);
        }
        const created = (await resp.json());
        console.log(`  ✓ created webhookID=${created.webhookID}`);
    }
    console.log('');
    console.log('Subscribed addresses:');
    addresses.forEach((a) => console.log(`  • ${a}`));
}
upsert().catch((err) => {
    console.error('register-webhook failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
export {};
//# sourceMappingURL=register-webhook.js.map