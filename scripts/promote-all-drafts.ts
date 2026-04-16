#!/usr/bin/env npx tsx
/**
 * Promote all unpromoted sandbox drafts that have media to the gallery.
 */
import { privateKeyToAccount } from 'viem/accounts';

const SERVER = process.env.SERVER_URL?.replace(/\/$/, '') || 'http://localhost:3000';
const WALLET = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
};

async function fetchJSON(url: string, init: RequestInit = {}): Promise<any> {
  return (await fetch(url, init)).json();
}

async function trpcMutate(procedure: string, input: unknown, token: string): Promise<any> {
  const json = await fetchJSON(`${SERVER}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  if (json[0]?.error)
    throw new Error(json[0].error?.json?.message || JSON.stringify(json[0].error));
  return json[0]?.result?.data;
}

async function main() {
  // Auth
  const { nonce } = await fetchJSON(`${SERVER}/auth/nonce`);
  const account = privateKeyToAccount(WALLET.privateKey);
  const now = new Date();
  const exp = new Date(now.getTime() + 120000);
  const msg = [
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
  const sig = await account.signMessage({ message: msg });
  const verifyRes = await fetch(`${SERVER}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER },
    body: JSON.stringify({ message: msg, signature: sig }),
  });
  const cookies = verifyRes.headers.getSetCookie?.() || [];
  const token =
    cookies
      .find((c) => c.startsWith('siwe-session='))
      ?.split('=')[1]
      ?.split(';')[0] || '';

  // Get drafts
  const draftsInput = encodeURIComponent(JSON.stringify({ '0': null }));
  const draftsData = await fetchJSON(
    `${SERVER}/trpc/sandbox.myDrafts?batch=1&input=${draftsInput}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const drafts = draftsData[0]?.result?.data || [];

  const unpromoted = drafts.filter(
    (d: any) => d.status !== 'promoted' && (d.videoUrl || d.imageUrl)
  );
  console.log(`Found ${unpromoted.length} unpromoted drafts with media\n`);

  for (const draft of unpromoted) {
    const hasVideo = draft.videoUrl ? 'video' : 'image';
    console.log(`Promoting: ${draft.id} (${hasVideo}) "${draft.title}"`);
    try {
      const result = await trpcMutate(
        'sandbox.promoteToUniverse',
        {
          draftId: draft.id,
          classification: 'original',
          visibility: 'public',
        },
        token
      );
      console.log(`  -> Content: ${result.contentId}`);
    } catch (err: any) {
      console.log(`  -> FAILED: ${err.message}`);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
