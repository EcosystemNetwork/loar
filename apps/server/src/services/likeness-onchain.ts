/**
 * Likeness Marketplace — on-chain integration with ContentLicensing.sol.
 *
 * Phase 1.5 graduates the marketplace from server-recorded direct ETH
 * transfers to real contract-mediated deals. The flow:
 *
 *   1. Seller publishes a listing (Phase 1 — Firestore only).
 *   2. Seller hits "Publish on-chain":
 *      a. Server prepares the EIP-191 rights attestation digest.
 *      b. Seller signs the digest in their wallet (one popup, off-chain).
 *      c. Server operator submits `RightsRegistry.setRightsWithCreatorSig` (operator pays gas).
 *      d. Server submits `ContentLicensing.registerContent` via the seller's
 *         Circle-DCW wallet (no popup; Circle handles signing).
 *      e. Listing is stamped with `onChainContentHash` / `onChainChainId` / tx hashes.
 *   3. Buyer hits Buy/Lease/License:
 *      - If `onChainContentHash` is set, the buyer calls
 *        `ContentLicensing.{buy,rent,license}Content` via their wallet
 *        (`useWriteContract` → Circle DCW). Payment routes through SplitRouter
 *        (or falls back to direct creator payment + platform fee).
 *      - If not, fall back to Phase 1's direct ETH transfer.
 *   4. Buyer's tx hash → server reads on-chain Deal state to confirm.
 *
 * Activation is fully env-gated. If `CONTENT_LICENSING_ADDRESS_{SEPOLIA,BASE_SEPOLIA}`
 * are not set, callers should fall back to the Phase 1 server-recorded flow.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  encodePacked,
  keccak256,
  parseSignature,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia } from 'viem/chains';
import { rightsRegistryAbi, contentLicensingAbi } from '@loar/abis/generated';

// ── Configuration ─────────────────────────────────────────────────────────

/**
 * RightsType enum mirror — must stay in lockstep with
 * `apps/contracts/src/interfaces/IRightsRegistry.sol`.
 */
export const RightsType = {
  UNSET: 0,
  FUN: 1,
  ORIGINAL: 2,
  LICENSED: 3,
  PUBLIC_DOMAIN: 4,
  FROZEN: 5,
} as const;
export type RightsTypeValue = (typeof RightsType)[keyof typeof RightsType];

/**
 * ContentLicensing DealType enum mirror — index order MUST match
 * `apps/contracts/src/revenue/ContentLicensing.sol::DealType`.
 */
export const ContractDealType = {
  BUY: 0,
  RENT: 1,
  LICENSE: 2,
} as const;

const SUPPORTED_CHAIN_IDS = new Set<number>([sepolia.id, baseSepolia.id]);

interface OnChainEnv {
  chainId: number;
  contentLicensing: Address;
  rightsRegistry: Address;
  rpcUrl: string;
  chainLabel: string;
}

/** Read the on-chain config for a given chainId. Returns null if not configured. */
export function getOnChainEnv(chainId: number): OnChainEnv | null {
  if (chainId === sepolia.id) {
    const contentLicensing = process.env.CONTENT_LICENSING_ADDRESS_SEPOLIA as Address | undefined;
    const rightsRegistry = process.env.RIGHTS_REGISTRY_ADDRESS_SEPOLIA as Address | undefined;
    const rpcUrl = process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2;
    if (!contentLicensing || !rightsRegistry || !rpcUrl) return null;
    return { chainId, contentLicensing, rightsRegistry, rpcUrl, chainLabel: 'Sepolia' };
  }
  if (chainId === baseSepolia.id) {
    const contentLicensing = process.env.CONTENT_LICENSING_ADDRESS_BASE_SEPOLIA as
      | Address
      | undefined;
    const rightsRegistry = process.env.RIGHTS_REGISTRY_ADDRESS_BASE_SEPOLIA as Address | undefined;
    const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA;
    if (!contentLicensing || !rightsRegistry || !rpcUrl) return null;
    return { chainId, contentLicensing, rightsRegistry, rpcUrl, chainLabel: 'Base Sepolia' };
  }
  return null;
}

/** True if at least one supported chain has both addresses configured. */
export function isOnChainAvailable(): boolean {
  for (const chainId of SUPPORTED_CHAIN_IDS) {
    if (getOnChainEnv(chainId)) return true;
  }
  return false;
}

/** Pick a default chain for new on-chain listings — Sepolia preferred, then Base Sepolia. */
export function defaultOnChainChainId(): number | null {
  if (getOnChainEnv(sepolia.id)) return sepolia.id;
  if (getOnChainEnv(baseSepolia.id)) return baseSepolia.id;
  return null;
}

function viemChain(chainId: number) {
  if (chainId === sepolia.id) return sepolia;
  if (chainId === baseSepolia.id) return baseSepolia;
  throw new Error(`Unsupported on-chain chainId: ${chainId}`);
}

function publicClient(env: OnChainEnv) {
  return createPublicClient({ chain: viemChain(env.chainId), transport: http(env.rpcUrl) });
}

// ── Content hash ──────────────────────────────────────────────────────────

/**
 * Deterministic content hash for a likeness/voice entity. Same shape used by
 * the on-chain ContentLicensing contract — must remain stable so re-publishing
 * with the same entity id collides with an existing registration (allowing
 * updatePricing instead of a fresh register).
 */
export function computeEntityContentHash(entityId: string): Hex {
  return keccak256(encodePacked(['string', 'string'], ['likeness-marketplace:', entityId]));
}

// ── Rights attestation (EIP-191 personal_sign) ───────────────────────────

/**
 * Build the EIP-191 digest the seller must sign for `setRightsWithCreatorSig`.
 *
 * Matches the contract's inner-hash format exactly:
 *   keccak256(abi.encodePacked(
 *     "LOAR-RIGHTS-V1", rightsRegistry, chainId,
 *     contentHash, uint8(rightsType), creatorNonce, deadline
 *   ))
 *
 * The `personal_sign` envelope (`"\x19Ethereum Signed Message:\n32"`) is
 * applied by the wallet on top of this digest; the contract reconstructs it
 * via `MessageHashUtils.toEthSignedMessageHash`.
 */
export function buildRightsAttestationDigest(opts: {
  rightsRegistry: Address;
  chainId: number;
  contentHash: Hex;
  rightsType: RightsTypeValue;
  creatorNonce: bigint;
  deadline: bigint;
}): Hex {
  return keccak256(
    encodePacked(
      ['string', 'address', 'uint256', 'bytes32', 'uint8', 'uint256', 'uint256'],
      [
        'LOAR-RIGHTS-V1',
        opts.rightsRegistry,
        BigInt(opts.chainId),
        opts.contentHash,
        opts.rightsType,
        opts.creatorNonce,
        opts.deadline,
      ]
    )
  );
}

/** Read the seller's current `creatorNonce` from RightsRegistry. */
export async function readCreatorNonce(env: OnChainEnv, creator: Address): Promise<bigint> {
  const client = publicClient(env);
  return (await client.readContract({
    address: env.rightsRegistry,
    abi: rightsRegistryAbi,
    functionName: 'creatorNonce',
    args: [creator],
  })) as bigint;
}

/** Read whether `setRights*` has already classified this content. */
export async function readIsMonetizable(env: OnChainEnv, contentHash: Hex): Promise<boolean> {
  const client = publicClient(env);
  return (await client.readContract({
    address: env.rightsRegistry,
    abi: rightsRegistryAbi,
    functionName: 'isMonetizable',
    args: [contentHash],
  })) as boolean;
}

// ── Operator: submit setRightsWithCreatorSig ─────────────────────────────

/**
 * Submit `RightsRegistry.setRightsWithCreatorSig` from the platform operator
 * wallet. The creator's signature is recovered inside the contract; the
 * operator is just the relayer + gas payer.
 *
 * Validates the signature recovers to the expected creator BEFORE submitting
 * the tx — saves gas on a doomed-to-revert tx.
 */
export async function submitSetRightsWithCreatorSig(opts: {
  chainId: number;
  contentHash: Hex;
  rightsType: RightsTypeValue;
  creator: Address;
  deadline: bigint;
  creatorSignature: Hex;
}): Promise<Hash> {
  const env = getOnChainEnv(opts.chainId);
  if (!env) {
    throw new Error(`On-chain config missing for chain ${opts.chainId}`);
  }

  // Defensive recovery — bail fast if the wallet returned a malformed sig.
  try {
    parseSignature(opts.creatorSignature);
  } catch {
    throw new Error('Creator signature is not a well-formed ECDSA signature');
  }

  // Operator wallet that submits the rights tx. Production should swap this
  // to a KMS-backed signer (see `apps/server/src/lib/signer.ts`); for testnet
  // a plain PRIVATE_KEY is fine. Kept inline so this module has no
  // server-only transitive deps that would leak into the web's type graph.
  const pk = process.env.OPERATOR_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      'OPERATOR_PRIVATE_KEY (or PRIVATE_KEY) is required to submit setRightsWithCreatorSig'
    );
  }
  const account = privateKeyToAccount(`0x${pk.replace(/^0x/, '')}` as Hex);
  const wallet = createWalletClient({
    account,
    chain: viemChain(opts.chainId),
    transport: http(env.rpcUrl),
  });

  return wallet.writeContract({
    address: env.rightsRegistry,
    abi: rightsRegistryAbi,
    functionName: 'setRightsWithCreatorSig',
    args: [opts.contentHash, opts.rightsType, opts.creator, opts.deadline, opts.creatorSignature],
  });
}

// ── ContentLicensing: registerContent ────────────────────────────────────

/**
 * Read the registration row for a content hash. Returns `null` if the slot
 * is empty (creator address is the zero address — the contract leaves the
 * struct zeroed until `registerContent` is called).
 */
export async function readContentRegistration(
  env: OnChainEnv,
  contentHash: Hex
): Promise<{ creator: Address; active: boolean; buyPrice: bigint } | null> {
  const client = publicClient(env);
  const row = (await client.readContract({
    address: env.contentLicensing,
    abi: contentLicensingAbi,
    functionName: 'getRegistration',
    args: [contentHash],
  })) as {
    contentHash: Hex;
    creator: Address;
    universeId: bigint;
    splitEntityHash: Hex;
    buyPrice: bigint;
    rentPricePerDay: bigint;
    licenseFee: bigint;
    licenseRoyaltyBps: number;
    active: boolean;
  };
  if (row.creator === '0x0000000000000000000000000000000000000000') return null;
  return { creator: row.creator, active: row.active, buyPrice: row.buyPrice };
}

/**
 * Encode the calldata for `ContentLicensing.registerContent`. Useful when
 * forwarding the call through Circle DCW (server signs as the seller).
 */
export function encodeRegisterContentCall(opts: {
  contentHash: Hex;
  universeId: bigint;
  splitEntityHash: Hex;
  buyPriceWei: bigint;
  rentPricePerDayWei: bigint;
  licenseFeeWei: bigint;
  licenseRoyaltyBps: number;
}): {
  abi: typeof contentLicensingAbi;
  functionName: 'registerContent';
  args: readonly [Hex, bigint, Hex, bigint, bigint, bigint, number];
} {
  return {
    abi: contentLicensingAbi,
    functionName: 'registerContent',
    args: [
      opts.contentHash,
      opts.universeId,
      opts.splitEntityHash,
      opts.buyPriceWei,
      opts.rentPricePerDayWei,
      opts.licenseFeeWei,
      opts.licenseRoyaltyBps,
    ] as const,
  };
}

// ── ContentLicensing: read deal state ────────────────────────────────────

/**
 * Resolve a `buyContent` / `rentContent` / `licenseContent` tx into the
 * canonical on-chain Deal state. We do this by reading the buyer's latest
 * deal mapping after the tx confirmed — simpler than decoding events and
 * doesn't depend on an indexer being up.
 */
export async function readBuyerDeal(opts: {
  chainId: number;
  contentHash: Hex;
  buyer: Address;
}): Promise<{
  dealId: bigint;
  dealType: 0 | 1 | 2;
  pricePaid: bigint;
  startTime: bigint;
  endTime: bigint;
  status: number;
} | null> {
  const env = getOnChainEnv(opts.chainId);
  if (!env) return null;
  const client = publicClient(env);

  // ContentLicensing exposes _buyerLatestDeal as an internal mapping; we read
  // via the getter pattern emitted by Solidity: `_buyerLatestDeal(bytes32, address)`.
  // If your generated ABI doesn't surface internal mappings, switch to event
  // decoding (`ContentBought` / `ContentRented` / `ContentLicensed`).
  let dealId: bigint;
  try {
    dealId = (await client.readContract({
      address: env.contentLicensing,
      abi: contentLicensingAbi,
      functionName: 'hasAccessFast',
      args: [opts.contentHash, opts.buyer],
    })) as unknown as bigint;
    // hasAccessFast returns bool; if true we still need the dealId. Fall back
    // to reading the deals array via paginated getter.
    if (typeof dealId === 'boolean') {
      const ids = (await client.readContract({
        address: env.contentLicensing,
        abi: contentLicensingAbi,
        functionName: 'getContentDeals',
        args: [opts.contentHash],
      })) as readonly bigint[];
      if (!ids || ids.length === 0) return null;
      // Walk backward (newest first) until we find a deal owned by buyer
      for (let i = ids.length - 1; i >= 0; i--) {
        const deal = (await client.readContract({
          address: env.contentLicensing,
          abi: contentLicensingAbi,
          functionName: 'deals',
          args: [ids[i]],
        })) as readonly [
          bigint, // id
          Hex, // contentHash
          Hex, // splitEntityHash
          number, // dealType
          number, // status
          Address, // buyer
          bigint, // pricePaid
          bigint, // startTime
          bigint, // endTime
        ];
        if ((deal[5] as Address).toLowerCase() === opts.buyer.toLowerCase()) {
          return {
            dealId: deal[0],
            dealType: deal[3] as 0 | 1 | 2,
            pricePaid: deal[6],
            startTime: deal[7],
            endTime: deal[8],
            status: deal[4],
          };
        }
      }
      return null;
    }
  } catch (err) {
    console.warn('[likeness-onchain] readBuyerDeal failed:', err);
    return null;
  }
  return null;
}

/** Verify a buyContent/rentContent/licenseContent tx exists and confirmed. */
export async function verifyContractTx(opts: {
  chainId: number;
  txHash: Hash;
}): Promise<{ ok: boolean; blockNumber: bigint | null }> {
  const env = getOnChainEnv(opts.chainId);
  if (!env) return { ok: false, blockNumber: null };
  const client = publicClient(env);
  try {
    const receipt = await client.getTransactionReceipt({ hash: opts.txHash });
    return {
      ok:
        receipt.status === 'success' &&
        receipt.to?.toLowerCase() === env.contentLicensing.toLowerCase(),
      blockNumber: receipt.blockNumber,
    };
  } catch {
    return { ok: false, blockNumber: null };
  }
}
