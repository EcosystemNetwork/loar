#!/usr/bin/env npx tsx
/**
 * List all drafts, generations, and content items to see what's missing from the gallery.
 */
import { privateKeyToAccount } from 'viem/accounts';

const SERVER = process.env.SERVER_URL?.replace(/\/$/, '') || 'http://localhost:3000';

const WALLET = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
};

async function fetchJSON(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, init);
  return res.json();
}

function buildSiweMessage(nonce: string) {
  const now = new Date();
  const exp = new Date(now.getTime() + 120000);
  return [
    'localhost wants you to sign in with your Ethereum account:',
    WALLET.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${SERVER}`,
    'Version: 1',
    'Chain ID: 84532',
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${exp.toISOString()}`,
  ].join('\n');
}

async function main() {
  // Auth
  const { nonce } = await fetchJSON(`${SERVER}/auth/nonce`);
  const account = privateKeyToAccount(WALLET.privateKey);
  const message = buildSiweMessage(nonce);
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER },
    body: JSON.stringify({ message, signature }),
  });
  const cookies = verifyRes.headers.getSetCookie?.() || [];
  const token =
    cookies
      .find((c) => c.startsWith('siwe-session='))
      ?.split('=')[1]
      ?.split(';')[0] || '';
  const headers = { Authorization: `Bearer ${token}` };

  // 1. Sandbox drafts
  console.log('\n=== SANDBOX DRAFTS ===');
  const draftsInput = encodeURIComponent(JSON.stringify({ '0': null }));
  const draftsData = await fetchJSON(
    `${SERVER}/trpc/sandbox.myDrafts?batch=1&input=${draftsInput}`,
    { headers }
  );
  const drafts = draftsData[0]?.result?.data || [];
  console.log(`Total: ${drafts.length}`);
  for (const d of drafts) {
    const hasVideo = d.videoUrl ? 'video' : d.imageUrl ? 'image' : 'none';
    console.log(
      `  ${d.id.padEnd(24)} status=${(d.status || '?').padEnd(10)} media=${hasVideo.padEnd(6)} promoted=${(d.promotedTo || '—').toString().padEnd(24)} "${d.title || '?'}"`
    );
  }

  // 2. Generation history
  console.log('\n=== GENERATION HISTORY ===');
  const genInput = encodeURIComponent(JSON.stringify({ '0': { limit: 50 } }));
  const genData = await fetchJSON(`${SERVER}/trpc/generation.history?batch=1&input=${genInput}`, {
    headers,
  });
  const gens = genData[0]?.result?.data || [];
  console.log(`Total: ${gens.length}`);
  for (const g of gens) {
    const hasVideo = g.videoUrl ? 'YES' : 'NO';
    console.log(
      `  ${g.id.padEnd(24)} status=${(g.status || '?').padEnd(10)} video=${hasVideo.padEnd(4)} model=${(g.finalModelId || '?').padEnd(20)} "${(g.prompt || '?').slice(0, 50)}"`
    );
  }

  // 3. Gallery content
  console.log('\n=== GALLERY CONTENT (public feed) ===');
  const feedInput = encodeURIComponent(JSON.stringify({ '0': { limit: 50 } }));
  const feedData = await fetchJSON(`${SERVER}/trpc/content.feed?batch=1&input=${feedInput}`);
  const content = feedData[0]?.result?.data?.items || [];
  console.log(`Total: ${content.length}`);
  for (const c of content) {
    console.log(
      `  ${c.id.padEnd(24)} type=${(c.mediaType || '?').padEnd(10)} fmt=${(c.format || 'NONE').padEnd(6)} "${c.title || '?'}"`
    );
  }

  // 4. Summary
  const promotedIds = new Set(
    drafts.filter((d: any) => d.promotedTo).map((d: any) => d.promotedTo)
  );
  const unpromotedWithMedia = drafts.filter(
    (d: any) => d.status !== 'promoted' && (d.videoUrl || d.imageUrl)
  );
  const failedGens = gens.filter((g: any) => g.status === 'failed');

  console.log('\n=== SUMMARY ===');
  console.log(`Drafts with media NOT promoted: ${unpromotedWithMedia.length}`);
  for (const d of unpromotedWithMedia) {
    console.log(`  ${d.id} — "${d.title}" (${d.videoUrl ? 'video' : 'image'})`);
  }
  console.log(`Failed generations: ${failedGens.length}`);
  console.log(`Content in gallery: ${content.length}`);
  console.log(`Drafts promoted: ${promotedIds.size}`);

  // Show draft URLs
  console.log('\n=== DRAFT URLS ===');
  for (const d of drafts) {
    const mediaUrl = d.videoUrl || d.imageUrl || 'NONE';
    console.log(
      `  ${d.id.padEnd(24)} ${(d.status || '?').padEnd(10)} mediaUrl=${mediaUrl.slice(0, 80)}`
    );
  }
}

main().catch(console.error);
