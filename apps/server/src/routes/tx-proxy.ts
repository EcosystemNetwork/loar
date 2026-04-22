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
import { executeTransaction, getTransactionStatus } from '../lib/circle-wallets';
import { isContractAllowed } from '../lib/contract-allowlist';
import { consumeRateLimit } from '../middleware/rate-limit';
import { db, firebaseAvailable } from '../lib/firebase';
import { encodeFunctionData, type Abi } from 'viem';

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
 * Body: either
 *   { address, abi, functionName, args?, value?, chainId? }   // ABI-encoded call
 * or
 *   { address, data: "0x…", value?, chainId? }                // pre-encoded calldata
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

  // Per-user cap — the global /tx rate limit is keyed on IP, but a compromised
  // session can reach us from anywhere. Cap each authenticated identity at
  // 20/min and 200/day independently so one hot wallet can't drain Circle's
  // quota or your gas budget.
  const perMinute = await consumeRateLimit(
    `txproxy:min:${walletAddress.toLowerCase()}`,
    60_000,
    20
  );
  if (perMinute.blocked) {
    return c.json({ error: 'Too many transactions — try again in a minute' }, 429);
  }
  const perDay = await consumeRateLimit(
    `txproxy:day:${walletAddress.toLowerCase()}`,
    24 * 60 * 60_000,
    200
  );
  if (perDay.blocked) {
    return c.json({ error: 'Daily transaction limit reached' }, 429);
  }

  // Parse request
  const body = await c.req.json<{
    address: string;
    abi?: Abi;
    functionName?: string;
    args?: any[];
    data?: `0x${string}`;
    value?: string;
    chainId?: number;
    /** If true, return as soon as Circle accepts the tx. Caller polls
     *  GET /api/tx/status/:txId until state is terminal. */
    async?: boolean;
  }>();

  if (!body.address) {
    return c.json({ error: 'Missing address' }, 400);
  }
  const hasAbiCall = !!(body.abi && body.functionName);
  const hasRawCall = !!body.data;
  if (!hasAbiCall && !hasRawCall) {
    return c.json({ error: 'Provide either {abi,functionName} or {data}' }, 400);
  }

  // Allowlist enforcement — the server is a signing oracle, so callers can
  // only ask us to sign calls to contracts we know about. Anything else would
  // let a compromised session drain funds (e.g. approve to attacker-spender).
  const chainId = body.chainId ?? 84532;
  const allowed = await isContractAllowed(chainId, body.address);
  if (!allowed) {
    return c.json(
      {
        error: `Contract ${body.address} on chain ${chainId} is not in the allowlist`,
      },
      403
    );
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
    // Build calldata — either encode the ABI call or pass raw bytes through.
    let calldata: `0x${string}`;
    if (hasRawCall) {
      const raw = body.data!;
      // Calldata must be even-length hex; Circle's SDK rejects odd-length
      // upstream but only after a 60s poll, so fail fast here.
      if (!/^0x[0-9a-fA-F]*$/.test(raw) || raw.length % 2 !== 0) {
        return c.json({ error: 'data must be 0x-prefixed even-length hex' }, 400);
      }
      calldata = raw;
    } else {
      calldata = encodeFunctionData({
        abi: body.abi!,
        functionName: body.functionName!,
        args: body.args ?? [],
      });
    }

    // Execute via Circle
    const result = await executeTransaction({
      walletId: wallet.walletId,
      contractAddress: body.address,
      calldata,
      chainId,
      value: body.value,
      async: body.async === true,
    });

    // Record ownership for async status polls. Required for async mode
    // (otherwise the caller can never poll); best-effort for sync mode since
    // the txHash is already in the response.
    if (firebaseAvailable && result.txId) {
      try {
        await db
          .collection('circleTxs')
          .doc(result.txId)
          .set({
            walletAddress: walletAddress.toLowerCase(),
            contractAddress: body.address,
            chainId,
            functionName: body.functionName ?? null,
            createdAt: new Date(),
          });
      } catch (err) {
        if (body.async === true) {
          return c.json({ error: 'Could not record transaction ownership — please retry' }, 500);
        }
        console.warn('[TX] ownership record failed (sync tx already sent):', err);
      }
    }

    // Track analytics
    void import('../lib/analytics').then(({ captureServerEvent }) =>
      captureServerEvent('tx:circle_write', {
        distinctId: walletAddress,
        functionName: body.functionName ?? 'raw',
        txHash: result.txHash,
        async: body.async === true,
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

/**
 * GET /api/tx/status/:txId
 *
 * Poll the current state of a Circle transaction. Only the wallet that
 * submitted the tx can read its status — otherwise a session could enumerate
 * other users' tx ids.
 */
txProxyRoutes.get('/status/:txId', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) {
    return c.json({ error: 'Not authenticated' }, 401);
  }
  const payload = await verifySessionToken(token);
  if (!payload?.sub) {
    return c.json({ error: 'Invalid session' }, 401);
  }
  const walletAddress = payload.sub.toLowerCase();

  const txId = c.req.param('txId');
  if (!txId) {
    return c.json({ error: 'Missing txId' }, 400);
  }

  // Ownership check — if we have a Firestore record, the session's address
  // must match. Unknown txIds (no record) are rejected; this avoids leaking
  // Circle state to anyone who can guess a UUID.
  if (firebaseAvailable) {
    const doc = await db.collection('circleTxs').doc(txId).get();
    if (!doc.exists) {
      return c.json({ error: 'Transaction not found' }, 404);
    }
    const owner = doc.data()?.walletAddress;
    if (owner !== walletAddress) {
      return c.json({ error: 'Not authorized for this transaction' }, 403);
    }
  }

  try {
    const result = await getTransactionStatus(txId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Status lookup failed';
    return c.json({ error: message }, 500);
  }
});
