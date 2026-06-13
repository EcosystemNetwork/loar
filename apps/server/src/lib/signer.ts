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
import { mainnet, sepolia } from 'viem/chains';

const CHAINS: Record<number, Chain> = {
  11155111: sepolia,
  1: mainnet,
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
    // Production: AWS KMS signing. The specifier is held in a variable so TS
    // doesn't statically pull kms-account.ts (and its optional, prod-only
    // @aws-sdk/client-kms dep) into the type graph of every downstream
    // consumer — notably the web app's tRPC AppRouter inference.
    try {
      const kmsModulePath = './kms-account';
      const { KmsAccount } = await import(kmsModulePath);
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
 * Resolve (and cache) the platform signer account, independent of chain.
 * Used by chains not in viem/chains (e.g. Arc) that build their own clients.
 */
export async function getSignerAccount(): Promise<Account> {
  if (!_cachedAccount) {
    _cachedAccount = await resolveAccount();
  }
  return _cachedAccount;
}

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
    chainId === 1
      ? process.env.RPC_URL_MAINNET || process.env.RPC_URL
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
