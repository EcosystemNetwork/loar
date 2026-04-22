/**
 * Circle Transaction Proxy — Server-side contract execution
 *
 * POST /api/tx/write — Execute a contract call via Circle DCW
 *
 * Since Circle Developer Controlled Wallets are server-managed,
 * all contract writes must be proxied through this endpoint.
 * The server encodes calldata, signs via Circle's KMS, and broadcasts.
 *
 * Authentication: Uses the existing siwe-session JWT cookie.
 * The JWT sub (wallet address) is mapped to the Circle wallet ID.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifySessionToken } from '../lib/siwe';
import { getUserWallet, executeTransaction } from '../lib/circle-wallets';
import { db, firebaseAvailable } from '../lib/firebase';
import { encodeFunctionData, type Abi } from 'viem';
// Note: SPONSORED_ACTIONS is not exported from paymaster.ts on the server.
// For analytics, we just track the function name — sponsorship enforcement is separate.

export const txProxyRoutes = new Hono();

const COOKIE_NAME = 'siwe-session';

/** Resolve the Circle wallet for the authenticated user. */
async function resolveWallet(
  address: string
): Promise<{ walletId: string; address: string } | null> {
  // Look up by wallet address → find the user account
  if (firebaseAvailable) {
    const snapshot = await db
      .collection('userAccounts')
      .where('walletAddress', '==', address)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const data = snapshot.docs[0].data();
      return { walletId: data.walletId, address: data.walletAddress };
    }

    // Also check circleWallets collection
    const walletSnapshot = await db
      .collection('circleWallets')
      .where('address', '==', address)
      .limit(1)
      .get();

    if (!walletSnapshot.empty) {
      const data = walletSnapshot.docs[0].data();
      return { walletId: data.walletId, address: data.address };
    }
  }

  return null;
}

/**
 * POST /api/tx/write
 *
 * Execute a contract call via Circle wallet.
 *
 * Body: {
 *   address: string;      // contract address
 *   abi: Abi;              // contract ABI
 *   functionName: string;  // function to call
 *   args?: any[];          // function arguments
 *   value?: string;        // ETH value in wei
 *   chainId?: number;      // target chain
 * }
 */
txProxyRoutes.post('/write', async (c) => {
  // Auth check
  const token = getCookie(c, COOKIE_NAME);
  if (!token) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const payload = await verifySessionToken(token);
  if (!payload?.sub) {
    return c.json({ error: 'Invalid session' }, 401);
  }

  const walletAddress = payload.sub;

  // Parse request
  const body = await c.req.json<{
    address: string;
    abi: Abi;
    functionName: string;
    args?: any[];
    value?: string;
    chainId?: number;
  }>();

  if (!body.address || !body.abi || !body.functionName) {
    return c.json({ error: 'Missing address, abi, or functionName' }, 400);
  }

  // Resolve Circle wallet
  const wallet = await resolveWallet(walletAddress);
  if (!wallet) {
    return c.json(
      {
        error: 'No Circle wallet found for this account. Please re-login.',
      },
      403
    );
  }

  try {
    // Encode calldata
    const calldata = encodeFunctionData({
      abi: body.abi,
      functionName: body.functionName,
      args: body.args ?? [],
    });

    // Execute via Circle
    const result = await executeTransaction({
      walletId: wallet.walletId,
      contractAddress: body.address,
      calldata,
      chainId: body.chainId ?? 84532, // Default to Base Sepolia
      value: body.value,
    });

    // Track analytics
    void import('../lib/analytics').then(({ captureServerEvent }) =>
      captureServerEvent('tx:circle_write', {
        distinctId: walletAddress,
        functionName: body.functionName,
        txHash: result.txHash,
      })
    );

    return c.json({
      txHash: result.txHash,
      txId: result.txId,
      state: result.state,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transaction failed';
    console.error('[TX] Circle transaction failed:', err);
    return c.json({ error: message }, 500);
  }
});
