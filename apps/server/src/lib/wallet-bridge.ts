/**
 * Wallet identity bridge — links a user's EVM (lowercase hex) and Solana
 * (base58) addresses so `creatorUid`-keyed queries find their content
 * regardless of which chain the user signed in via.
 *
 * Storage: `walletLinks` Firestore collection. Two docs per linked pair —
 * one keyed by the EVM address, one by the Solana address — so lookup is
 * O(1) in either direction without composite indexes.
 *
 * Data sources that produce links:
 *   - `/auth/solana/link` (siws-auth.ts) — EVM session opt-in linkage
 *   - `createUserSolanaWallet` (circle-solana.ts) — Circle DCW provisioning
 *
 * Older `circleSolanaWallets/<evmUid>__<cluster>` rows are also consulted
 * as a fallback so we don't need to backfill that collection.
 */
import { db, firebaseAvailable } from './firebase';

const COLL = 'walletLinks';

const isHexAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const isBase58Address = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export type WalletLinkSource = 'siws-link' | 'circle-provision' | 'admin-backfill';

interface WalletLinkDoc {
  evmAddress: string; // lowercased hex
  solanaAddress: string; // base58 (case-sensitive)
  source: WalletLinkSource;
  linkedAt: Date;
}

/**
 * Persist a bidirectional link between an EVM and a Solana address. Idempotent
 * — re-running with the same pair just refreshes `linkedAt`. Safe to call
 * fire-and-forget; failures are logged but never bubble up.
 */
export async function recordWalletLink(input: {
  evmAddress: string;
  solanaAddress: string;
  source: WalletLinkSource;
}): Promise<void> {
  if (!firebaseAvailable || !db) return;
  if (!isHexAddress(input.evmAddress) || !isBase58Address(input.solanaAddress)) {
    return; // silently ignore malformed pairs — never crash a session-issue path
  }

  const evm = input.evmAddress.toLowerCase();
  const sol = input.solanaAddress;
  const doc: WalletLinkDoc = {
    evmAddress: evm,
    solanaAddress: sol,
    source: input.source,
    linkedAt: new Date(),
  };
  try {
    const batch = db.batch();
    batch.set(db.collection(COLL).doc(evm), doc, { merge: true });
    batch.set(db.collection(COLL).doc(sol), doc, { merge: true });
    await batch.commit();
  } catch (err) {
    console.warn('[wallet-bridge] recordWalletLink failed:', (err as Error).message);
  }
}

/** Resolve the canonical EVM address for a Solana base58 pubkey, or null. */
export async function lookupEvmForSolana(solanaAddress: string): Promise<string | null> {
  if (!firebaseAvailable || !db) return null;
  if (!isBase58Address(solanaAddress)) return null;
  try {
    const direct = await db.collection(COLL).doc(solanaAddress).get();
    if (direct.exists) {
      const evm = (direct.data() as WalletLinkDoc).evmAddress;
      if (evm && isHexAddress(evm)) return evm.toLowerCase();
    }
    // Fallback: scan circleSolanaWallets for a row whose `address` matches.
    // Single equality lookup — needs an index on (address, cluster) if it
    // grows; for now the index will be auto-suggested on first hit and is
    // cheap to add since the collection is small.
    const fallback = await db
      .collection('circleSolanaWallets')
      .where('address', '==', solanaAddress)
      .limit(1)
      .get();
    if (!fallback.empty) {
      const row = fallback.docs[0].data() as { userId?: string };
      if (row.userId && isHexAddress(row.userId)) {
        // Best-effort: hydrate the bridge so subsequent lookups hit the
        // O(1) path. Fire-and-forget.
        void recordWalletLink({
          evmAddress: row.userId,
          solanaAddress,
          source: 'circle-provision',
        });
        return row.userId.toLowerCase();
      }
    }
  } catch (err) {
    console.warn('[wallet-bridge] lookupEvmForSolana failed:', (err as Error).message);
  }
  return null;
}

/** Resolve the linked Solana base58 pubkey for an EVM address, or null. */
export async function lookupSolanaForEvm(evmAddress: string): Promise<string | null> {
  if (!firebaseAvailable || !db) return null;
  if (!isHexAddress(evmAddress)) return null;
  const evm = evmAddress.toLowerCase();
  try {
    const direct = await db.collection(COLL).doc(evm).get();
    if (direct.exists) {
      const sol = (direct.data() as WalletLinkDoc).solanaAddress;
      if (sol && isBase58Address(sol)) return sol;
    }
    // Fallback: any `circleSolanaWallets/<evm>__<cluster>` row.
    const fallback = await db
      .collection('circleSolanaWallets')
      .where('userId', '==', evm)
      .limit(1)
      .get();
    if (!fallback.empty) {
      const row = fallback.docs[0].data() as { address?: string };
      if (row.address && isBase58Address(row.address)) {
        void recordWalletLink({
          evmAddress: evm,
          solanaAddress: row.address,
          source: 'circle-provision',
        });
        return row.address;
      }
    }
  } catch (err) {
    console.warn('[wallet-bridge] lookupSolanaForEvm failed:', (err as Error).message);
  }
  return null;
}
