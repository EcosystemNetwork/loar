/**
 * Mobile Sign-In With Solana via Mobile Wallet Adapter (MWA).
 *
 * Pairs with apps/web/src/lib/solana-auth.ts but uses the on-device
 * `transact()` API instead of @solana/wallet-adapter-react. On Android, MWA
 * opens whichever Solana wallet the user has installed (Phantom, Solflare,
 * Backpack) to authorize + sign the SIWS message. iOS path is deeplink-only
 * for now (MWA spec is Android-first) — falls back to web-style universal
 * link to phantom://browse on iOS in a future iteration.
 *
 * Requires an Expo dev client (or bare workflow) — MWA ships a native
 * Android module that the standard Expo Go runtime doesn't include.
 * See: https://docs.solanamobile.com/react-native/expo
 */
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { Platform } from 'react-native';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey } from '@solana/web3.js';

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:3000';
const CLUSTER =
  (process.env.EXPO_PUBLIC_SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' | undefined) ?? 'devnet';

const SOLANA_GENESIS = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc7UMKUbpZF',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
} as const;

const APP_IDENTITY = {
  // MWA shows this to the user when they authorize. The icon MUST be a
  // fetchable URL (spec: data: or http(s)://). A bare 'favicon.ico' would
  // make Phantom/Solflare reject the authorize call or show a placeholder.
  name: 'LOAR',
  uri: 'https://loar.fun',
  icon: 'https://loar.fun/favicon.ico',
};

export interface SolanaAuthResult {
  address: string;
  token: string;
  expiresAt: number;
}

function buildSiwsMessage(args: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  cluster: 'mainnet-beta' | 'devnet' | 'testnet';
}): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  const chainRef = `solana:${SOLANA_GENESIS[args.cluster].slice(0, 32)}`;
  return [
    `${args.domain} wants you to sign in with your Solana account:`,
    args.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${args.uri}`,
    `Version: 1`,
    `Chain ID: ${chainRef}`,
    `Nonce: ${args.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function fetchNonce(): Promise<string> {
  const resp = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!resp.ok) throw new Error('nonce fetch failed');
  const { nonce } = (await resp.json()) as { nonce: string };
  return nonce;
}

/**
 * Open MWA, authorize, sign a fresh SIWS message, post to /auth/solana/verify,
 * return the JWT + address. Caller persists the token in SecureStore.
 *
 * On iOS MWA's native module isn't available — throws a clear error so the UI
 * can fall back to a "Open Phantom on web" deeplink path.
 */
export async function signInWithSolana(): Promise<SolanaAuthResult> {
  if (Platform.OS !== 'android') {
    throw new Error(
      'Solana Mobile Wallet Adapter is Android-only today. iOS users: tap "Pay & Mint" in the web app and scan the QR with Phantom mobile.'
    );
  }

  // MWA wraps everything in a single transact session so user sees one
  // approval prompt for "authorize + sign message" together.
  const { address, token, expiresAt } = await transact(async (wallet) => {
    const authorization = await wallet.authorize({
      cluster: CLUSTER,
      identity: APP_IDENTITY,
    });
    const pubkeyBase64 = authorization.accounts[0]?.address;
    if (!pubkeyBase64) throw new Error('MWA returned no account');

    // Authorization returns the base64 pubkey; convert to base58 for our
    // SIWS message format. PublicKey constructor accepts a 32-byte buffer.
    const pubkeyBytes = Buffer.from(pubkeyBase64, 'base64');
    const addressBase58 = new PublicKey(pubkeyBytes).toBase58();

    const nonce = await fetchNonce();
    const message = buildSiwsMessage({
      domain: 'loar.fun',
      address: addressBase58,
      uri: 'https://loar.fun',
      nonce,
      cluster: CLUSTER,
    });

    const signResult = await wallet.signMessages({
      addresses: [pubkeyBase64],
      payloads: [Buffer.from(message, 'utf8')],
    });
    const sig = signResult[0];
    if (!sig) throw new Error('MWA returned no signature');
    const signatureBase58 = bs58.encode(sig);

    // Verify with the server and get a JWT back.
    const resp = await fetch(`${SERVER_URL}/auth/solana/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mobile-client': '1' },
      body: JSON.stringify({ message, signature: signatureBase58 }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Verify failed' }));
      throw new Error(err.error ?? 'Verify failed');
    }
    const json = (await resp.json()) as { address: string; expiresAt: number; token?: string };

    return {
      address: json.address,
      token: json.token ?? '', // Server returns token in body when x-mobile-client=1.
      expiresAt: json.expiresAt,
    };
  });

  return { address, token, expiresAt };
}
