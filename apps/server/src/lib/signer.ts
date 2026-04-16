/**
 * Chain signer abstraction — supports raw PRIVATE_KEY for development
 * and AWS KMS for production.
 *
 * Usage:
 *   import { getSigner } from '@/lib/signer';
 *   const { account, client } = await getSigner(chainId);
 *
 * Environment:
 *   Development: PRIVATE_KEY (64 hex chars, no 0x prefix)
 *   Production:  KMS_KEY_ID  (AWS KMS key ARN or alias)
 *                KMS_REGION  (defaults to us-east-1)
 */
import { createWalletClient, http, type Account, type WalletClient, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia, base } from 'viem/chains';

const CHAINS: Record<number, Chain> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

export interface Signer {
  account: Account;
  client: WalletClient;
  address: `0x${string}`;
}

/**
 * Resolve an Account from environment.
 *
 * In production (KMS_KEY_ID set), uses AWS KMS via @aws-sdk/client-kms
 * to sign transactions without the private key ever leaving the HSM.
 *
 * In development, falls back to raw PRIVATE_KEY.
 */
async function resolveAccount(): Promise<Account> {
  const kmsKeyId = process.env.KMS_KEY_ID;

  if (kmsKeyId) {
    // Production: AWS KMS signing
    try {
      const { KmsAccount } = await import('./kms-account');
      return await KmsAccount.create(kmsKeyId, process.env.KMS_REGION || 'us-east-1');
    } catch (err) {
      throw new Error(
        `KMS_KEY_ID is set but KMS account creation failed. ` +
          `Ensure @aws-sdk/client-kms is installed and IAM permissions are configured. ` +
          `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Development: raw private key
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      'No signing key configured. Set KMS_KEY_ID (production) or PRIVATE_KEY (development).'
    );
  }

  return privateKeyToAccount(`0x${pk}`);
}

let _cachedAccount: Account | null = null;

/**
 * Get a wallet client + account for the given chain.
 * Account is resolved once and cached for the process lifetime.
 */
export async function getSigner(chainId: number = 11155111): Promise<Signer> {
  if (!_cachedAccount) {
    _cachedAccount = await resolveAccount();
  }

  const chain = CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `Unsupported chain ID: ${chainId}. Supported: ${Object.keys(CHAINS).join(', ')}`
    );
  }

  const rpcUrl =
    chainId === 8453
      ? process.env.RPC_URL_BASE
      : chainId === 84532
        ? process.env.RPC_URL_BASE_SEPOLIA
        : process.env.RPC_URL || process.env.PONDER_RPC_URL_2;

  const client = createWalletClient({
    account: _cachedAccount,
    chain,
    transport: http(rpcUrl),
  });

  return {
    account: _cachedAccount,
    client,
    address: _cachedAccount.address,
  };
}
