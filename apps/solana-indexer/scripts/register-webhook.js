'use strict';
/**
 * Register the LOAR indexer as a Helius enhanced webhook.
 *
 * Usage:
 *   HELIUS_API_KEY=... \
 *   SOLANA_INDEXER_PUBLIC_URL=https://idx-solana.loar.fun \
 *   UNIVERSE_PROGRAM_ID=... EPISODE_PROGRAM_ID=... \
 *   pnpm -F @loar/solana-indexer register
 *
 * Helius docs: https://docs.helius.dev/webhooks-and-websockets/api-reference/create-webhook
 */
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WEBHOOK_URL = process.env.SOLANA_INDEXER_PUBLIC_URL;
const SECRET = process.env.HELIUS_WEBHOOK_SECRET;
if (!HELIUS_API_KEY || !WEBHOOK_URL || !SECRET) {
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
const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
const resp = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    webhookURL: `${WEBHOOK_URL.replace(/\/$/, '')}/webhooks/helius`,
    transactionTypes: ['ANY'],
    accountAddresses: addresses,
    webhookType: cluster === 'devnet' ? 'enhancedDevnet' : 'enhanced',
    authHeader: SECRET,
  }),
});
const text = await resp.text();
if (!resp.ok) {
  console.error(`Helius webhook registration failed: ${resp.status}\n${text}`);
  process.exit(1);
}
console.log(`✓ Registered webhook:\n${text}`);
//# sourceMappingURL=register-webhook.js.map
