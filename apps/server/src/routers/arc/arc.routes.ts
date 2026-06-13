/**
 * Arc tRPC router — USDC agent-to-agent settlement on Circle's Arc L1.
 *
 *   status   — config + chain/asset info
 *   balance  — USDC balance of an address on Arc
 *   pay      — send USDC to another agent (records a nanopayment)
 *   history  — the caller's Arc payment ledger
 *   x402Quote — payment requirements for a paid resource (for agents)
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../../lib/trpc';
import {
  payUsdc,
  getUsdcBalance,
  isArcConfigured,
  arcTxUrl,
  ARC_TESTNET_ID,
  ARC_USDC,
} from '../../lib/arc';
import { paymentRequiredBody } from '../../lib/x402';
import { consumeRateLimit } from '../../middleware/rate-limit';
import { captureServerEvent } from '../../lib/analytics';
import { db, firebaseAvailable } from '../../lib/firebase';

const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x address');
const USDC_AMT = z.string().regex(/^\d+(\.\d{1,6})?$/, 'USDC amount, up to 6 decimals');

export const arcRouter = router({
  status: publicProcedure.query(() => ({
    configured: isArcConfigured(),
    chainId: ARC_TESTNET_ID,
    usdc: ARC_USDC,
    network: 'arc-testnet',
  })),

  balance: publicProcedure
    .input(z.object({ address: ADDR }))
    .query(async ({ input }) => ({ usdc: await getUsdcBalance(input.address) })),

  /** Pay another agent (or address) in USDC on Arc. */
  pay: protectedProcedure
    .input(
      z.object({
        to: ADDR,
        amountUsdc: USDC_AMT,
        memo: z.string().max(280).optional(),
        /** Optional id of the agent initiating the payment. */
        fromAgentId: z.string().optional(),
        toAgentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isArcConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Arc is not configured on this server (PRIVATE_KEY / KMS_KEY_ID missing).',
        });
      }
      const rl = await consumeRateLimit(`arc:pay:${ctx.user.uid}`, 60_000, 30);
      if (rl.blocked) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many payments — slow down.',
        });
      }

      let result;
      try {
        result = await payUsdc({ to: input.to, amountUsdc: input.amountUsdc });
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Arc payment failed',
        });
      }

      if (firebaseAvailable) {
        await db
          .collection('arcPayments')
          .doc(result.txHash)
          .set({
            txHash: result.txHash,
            fromUid: ctx.user.uid,
            to: input.to.toLowerCase(),
            amountUsdc: input.amountUsdc,
            amountRaw: result.amountRaw,
            memo: input.memo ?? null,
            fromAgentId: input.fromAgentId ?? null,
            toAgentId: input.toAgentId ?? null,
            createdAt: new Date(),
          });
      }
      void captureServerEvent('arc:payment', {
        distinctId: ctx.user.uid,
        amountUsdc: input.amountUsdc,
        txHash: result.txHash,
      });

      return { ...result, explorerUrl: arcTxUrl(result.txHash) };
    }),

  /** The caller's Arc payment history. */
  history: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(25) }).optional())
    .query(async ({ ctx, input }) => {
      if (!firebaseAvailable) return [];
      const snap = await db
        .collection('arcPayments')
        .where('fromUid', '==', ctx.user.uid)
        .limit(input?.limit ?? 25)
        .get();
      return snap.docs
        .map((d) => d.data())
        .sort(
          (a, b) => Number(b.createdAt?.toMillis?.() ?? 0) - Number(a.createdAt?.toMillis?.() ?? 0)
        );
    }),

  /** Payment requirements an agent must satisfy to call a paid resource. */
  x402Quote: publicProcedure
    .input(z.object({ resource: z.string(), amountUsdc: USDC_AMT, payTo: ADDR }))
    .query(({ input }) =>
      paymentRequiredBody({
        amountUsdc: input.amountUsdc,
        payTo: input.payTo,
        resource: input.resource,
      })
    ),
});
