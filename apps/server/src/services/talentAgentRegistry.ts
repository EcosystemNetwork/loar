/**
 * TalentAgentRegistry on-chain integration service.
 *
 * Bridges the Firestore agent-contract layer to the TalentAgentRegistry
 * contract:
 *   - registerAgreementOnChain — fired from talentAgents.acceptContract
 *   - routeCommissionOnChain  — fired from recordAgentCommission
 *
 * Both are best-effort: when the registry address isn't configured, or the
 * platform Circle DCW wallet isn't provisioned yet, they no-op and the
 * Firestore ledger remains the source of truth. The on-chain mirror only
 * activates once the deploy has happened and the env vars are set.
 */
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  toBytes,
  type Abi,
  type Hex,
} from 'viem';
import { executeTransaction, getOrCreateWallet } from '../lib/circle-wallets';

// ── Config ───────────────────────────────────────────────────────────────

function registryAddress(): Hex | null {
  const env = process.env.TALENT_AGENT_REGISTRY_ADDRESS;
  if (!env || !isAddress(env)) return null;
  return getAddress(env) as Hex;
}

function platformChainId(): number {
  // Default to Base Sepolia (matches Circle DCW default in circle-wallets.ts).
  return Number(process.env.PLATFORM_CHAIN_ID ?? '84532');
}

/** The Circle DCW wallet uid used as the registry's trusted `platform`
 *  caller. This is a server-controlled identity — different from any user
 *  uid. Defaults to a well-known platform key. */
function platformWalletUid(): string {
  return process.env.PLATFORM_CIRCLE_WALLET_UID ?? 'platform-registry-caller';
}

// ── ABI (inline; safe to switch to generated talentAgentRegistryAbi later)

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerAgreement',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agreementId', type: 'bytes32' },
      { name: 'agent', type: 'address' },
      { name: 'creator', type: 'address' },
      { name: 'commissionBps', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deactivateAgreement',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agreementId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'routeCommissionETH',
    stateMutability: 'payable',
    inputs: [
      { name: 'agreementId', type: 'bytes32' },
      { name: 'grossAmount', type: 'uint256' },
      { name: 'sourceType', type: 'string' },
      { name: 'sourceId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'routeCommissionERC20',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agreementId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'grossAmount', type: 'uint256' },
      { name: 'sourceType', type: 'string' },
      { name: 'sourceId', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const satisfies Abi;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Deterministic agreementId mirror of the off-chain `${agentUid}-${creatorUid}`
 *  Firestore doc id. Hashing the colon-separated tuple keeps it
 *  collision-free even when uids contain dashes. */
export function agreementIdFor(agentUid: string, creatorUid: string): Hex {
  return keccak256(toBytes(`${agentUid.toLowerCase()}:${creatorUid.toLowerCase()}`));
}

function isAddressLike(value: string | undefined | null): value is string {
  return !!value && isAddress(value);
}

// ── Public API ───────────────────────────────────────────────────────────

export async function registerAgreementOnChain(input: {
  agentUid: string;
  creatorUid: string;
  commissionBps: number;
}): Promise<{ txHash: string; agreementId: Hex } | null> {
  const addr = registryAddress();
  if (!addr) return null;
  if (!isAddressLike(input.agentUid) || !isAddressLike(input.creatorUid)) {
    // Both party uids must be wallet addresses (which they are under SIWE).
    return null;
  }

  const agreementId = agreementIdFor(input.agentUid, input.creatorUid);
  const chainId = platformChainId();
  const wallet = await getOrCreateWallet(platformWalletUid(), chainId);

  const calldata = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: 'registerAgreement',
    args: [
      agreementId,
      getAddress(input.agentUid) as Hex,
      getAddress(input.creatorUid) as Hex,
      input.commissionBps,
    ],
  }) as Hex;

  const result = await executeTransaction({
    walletId: wallet.walletId,
    contractAddress: addr,
    calldata,
    chainId,
  });

  if (!result.txHash) {
    throw new Error(`registerAgreement returned no tx hash (state: ${result.state})`);
  }
  return { txHash: result.txHash, agreementId };
}

export async function deactivateAgreementOnChain(
  agentUid: string,
  creatorUid: string
): Promise<{ txHash: string } | null> {
  const addr = registryAddress();
  if (!addr) return null;
  if (!isAddressLike(agentUid) || !isAddressLike(creatorUid)) return null;

  const chainId = platformChainId();
  const wallet = await getOrCreateWallet(platformWalletUid(), chainId);
  const agreementId = agreementIdFor(agentUid, creatorUid);

  const calldata = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: 'deactivateAgreement',
    args: [agreementId],
  }) as Hex;

  const result = await executeTransaction({
    walletId: wallet.walletId,
    contractAddress: addr,
    calldata,
    chainId,
  });

  if (!result.txHash) {
    throw new Error(`deactivateAgreement returned no tx hash (state: ${result.state})`);
  }
  return { txHash: result.txHash };
}

export async function routeCommissionOnChain(input: {
  agentUid: string;
  creatorUid: string;
  grossAmountWei: string;
  sourceType: string;
  sourceId: string;
  /** ERC20 token address ($LOAR) — pass undefined for native ETH path. */
  tokenAddress?: string;
}): Promise<{ txHash: string } | null> {
  const addr = registryAddress();
  if (!addr) return null;
  if (!isAddressLike(input.agentUid) || !isAddressLike(input.creatorUid)) return null;

  const chainId = platformChainId();
  const wallet = await getOrCreateWallet(platformWalletUid(), chainId);
  const agreementId = agreementIdFor(input.agentUid, input.creatorUid);
  const sourceIdBytes = keccak256(toBytes(input.sourceId));

  if (input.tokenAddress && isAddress(input.tokenAddress)) {
    // ERC20 path — the platform wallet must already have approved
    // `grossAmountWei` of `tokenAddress` to the registry. The deploy
    // playbook handles that approval as a one-time op.
    const calldata = encodeFunctionData({
      abi: REGISTRY_ABI,
      functionName: 'routeCommissionERC20',
      args: [
        agreementId,
        getAddress(input.tokenAddress) as Hex,
        BigInt(input.grossAmountWei),
        input.sourceType,
        sourceIdBytes,
      ],
    }) as Hex;

    const result = await executeTransaction({
      walletId: wallet.walletId,
      contractAddress: addr,
      calldata,
      chainId,
    });

    if (!result.txHash) {
      throw new Error(`routeCommissionERC20 returned no tx hash (state: ${result.state})`);
    }
    return { txHash: result.txHash };
  }

  // Native ETH path
  const calldata = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: 'routeCommissionETH',
    args: [agreementId, BigInt(input.grossAmountWei), input.sourceType, sourceIdBytes],
  }) as Hex;

  const result = await executeTransaction({
    walletId: wallet.walletId,
    contractAddress: addr,
    calldata,
    chainId,
    value: input.grossAmountWei,
  });

  if (!result.txHash) {
    throw new Error(`routeCommissionETH returned no tx hash (state: ${result.state})`);
  }
  return { txHash: result.txHash };
}
