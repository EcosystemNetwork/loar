/**
 * Contract writes for mobile — the same server-proxied path the web uses.
 *
 * The signed-in account's wallet is a Circle Developer-Controlled Wallet, so
 * the server encodes the call, signs it via Circle and broadcasts it. Mobile
 * needs no EVM stack: it sends the ABI fragment + args (bigints as decimal
 * strings) and gets back the tx hash once the tx is mined.
 */
import { getToken } from './storage';

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:3000';

export interface WriteContractParams {
  address: string;
  abi: readonly unknown[];
  functionName: string;
  /** uint values must already be decimal strings. */
  args: readonly (string | number | boolean)[];
  /** Wei, as a decimal string. */
  value?: string;
  chainId: number;
}

export async function writeContract(params: WriteContractParams): Promise<string> {
  const token = await getToken();
  if (!token) throw new Error('Sign in to trade');

  const res = await fetch(`${SERVER_URL}/api/tx/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      value: params.value,
      chainId: params.chainId,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { txHash?: string; error?: string };
  if (!res.ok) throw new Error(body.error || `Transaction failed (${res.status})`);
  if (!body.txHash) throw new Error('Transaction submitted but no hash was returned');
  return body.txHash;
}

export const BONDING_CURVE_WRITE_ABI = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const explorerTxUrl = (chainId: number, hash: string) =>
  `https://${chainId === 1 ? '' : 'sepolia.'}etherscan.io/tx/${hash}`;
