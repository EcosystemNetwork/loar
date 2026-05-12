/**
 * Squads multisig routes — Solana parity with the Gnosis Safe API used for
 * shared Universe ownership on EVM.
 *
 *   POST /api/squads/create   — deploy a new multisig (auth: any user; pays fees)
 *   POST /api/squads/propose  — propose a tx for execution by the vault
 *   POST /api/squads/approve  — approve a pending proposal
 *   POST /api/squads/execute  — execute an approved proposal
 *   GET  /api/squads/vault    — derive vault PDA from multisig address
 *
 * The actual instructions to execute (e.g. Universe `publish_universe`) are
 * constructed by callers and POSTed as base64-encoded TransactionInstructions.
 * For v1 we expose a typed `publish_universe` shortcut to make the demo path
 * trivial; arbitrary instruction proposing arrives in v2 with broader auth.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { verifyAuth } from '../lib/auth';
import {
  approveMultisigTx,
  createUniverseMultisig,
  deriveVaultPda,
  executeMultisigTx,
  proposeMultisigTx,
} from '../lib/squads';

export const squadsRoutes = new Hono();

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type AuthGate =
  | { user: NonNullable<Awaited<ReturnType<typeof verifyAuth>>>; res: null }
  | { user: null; res: Response };

async function authed(c: any): Promise<AuthGate> {
  const token = getCookie(c, 'siwe-session');
  const user = await verifyAuth(c.req.raw.headers, token);
  if (!user) return { user: null, res: c.json({ error: 'Unauthorized' }, 401) };
  return { user, res: null };
}

const createBody = z.object({
  members: z.array(z.string().regex(SOLANA_ADDR_RE)).min(1).max(10),
  threshold: z.number().int().min(1).max(10),
  label: z.string().max(100).optional(),
});

squadsRoutes.post('/create', async (c) => {
  const auth = await authed(c);
  if (!auth.user) return auth.res;

  const parsed = createBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }

  try {
    const result = await createUniverseMultisig({
      userId: auth.user.uid,
      members: parsed.data.members,
      threshold: parsed.data.threshold,
      label: parsed.data.label,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'create failed' }, 500);
  }
});

squadsRoutes.get('/vault', (c) => {
  const multisig = c.req.query('multisig');
  if (!multisig || !SOLANA_ADDR_RE.test(multisig)) {
    return c.json({ error: 'multisig query param required' }, 400);
  }
  const vaultIndex = Number(c.req.query('index') ?? '0');
  try {
    return c.json({ multisig, vault: deriveVaultPda(multisig, vaultIndex) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'derive failed' }, 400);
  }
});

const proposeBody = z.object({
  multisigAddress: z.string().regex(SOLANA_ADDR_RE),
  /** Pre-built instructions, base64-encoded raw TransactionInstruction shape. */
  instructions: z
    .array(
      z.object({
        programId: z.string().regex(SOLANA_ADDR_RE),
        keys: z.array(
          z.object({
            pubkey: z.string().regex(SOLANA_ADDR_RE),
            isSigner: z.boolean(),
            isWritable: z.boolean(),
          })
        ),
        /** Base64-encoded instruction data. */
        dataBase64: z.string(),
      })
    )
    .min(1)
    .max(20),
  memo: z.string().max(200).optional(),
});

squadsRoutes.post('/propose', async (c) => {
  const auth = await authed(c);
  if (!auth.user) return auth.res;

  const parsed = proposeBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }

  const { PublicKey, TransactionInstruction } = await import('@solana/web3.js');
  const innerInstructions = parsed.data.instructions.map(
    (i) =>
      new TransactionInstruction({
        programId: new PublicKey(i.programId),
        keys: i.keys.map((k) => ({
          pubkey: new PublicKey(k.pubkey),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(i.dataBase64, 'base64'),
      })
  );

  try {
    const result = await proposeMultisigTx({
      userId: auth.user.uid,
      multisigAddress: parsed.data.multisigAddress,
      innerInstructions,
      memo: parsed.data.memo,
    });
    return c.json({ txIndex: result.txIndex.toString(), txSignature: result.txSignature });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'propose failed' }, 500);
  }
});

const indexBody = z.object({
  multisigAddress: z.string().regex(SOLANA_ADDR_RE),
  txIndex: z.string().regex(/^\d+$/),
});

squadsRoutes.post('/approve', async (c) => {
  const auth = await authed(c);
  if (!auth.user) return auth.res;

  const parsed = indexBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await approveMultisigTx({
      userId: auth.user.uid,
      multisigAddress: parsed.data.multisigAddress,
      txIndex: BigInt(parsed.data.txIndex),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'approve failed' }, 500);
  }
});

squadsRoutes.post('/execute', async (c) => {
  const auth = await authed(c);
  if (!auth.user) return auth.res;

  const parsed = indexBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await executeMultisigTx({
      userId: auth.user.uid,
      multisigAddress: parsed.data.multisigAddress,
      txIndex: BigInt(parsed.data.txIndex),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'execute failed' }, 500);
  }
});
