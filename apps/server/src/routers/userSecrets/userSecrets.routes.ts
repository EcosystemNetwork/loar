/**
 * User Secrets — Bring-Your-Own-Key (BYOK) router.
 *
 * Lets each authenticated user store their own external-provider API keys
 * (currently: ByteDance ModelArk). When a key is set, the server uses it for
 * that user's generation calls instead of the platform's shared keys, so
 * judges/teammates/users can plug in their own credits without sharing them.
 *
 * Security:
 *   - Plaintext keys are NEVER returned to the client. There is no `getKey`
 *     endpoint by design.
 *   - The summary endpoint returns only the last 4 chars + updatedAt so the
 *     UI can render "•••• abcd" without decrypting.
 *   - Encryption uses AES-256-GCM with the server-held USER_SECRETS_MASTER_KEY.
 */
import { z } from 'zod';
import { protectedProcedure, router } from '../../lib/trpc';
import {
  setUserSecret,
  clearUserSecret,
  listUserSecretSummary,
  type SecretProvider,
} from '../../services/userSecrets';
import { bytedanceService } from '../../services/bytedance';
import { zaiService } from '../../services/zai';

const PROVIDERS = ['bytedance', 'zai', 'openai', 'google', 'fal', 'elevenlabs', 'meshy'] as const;
const providerSchema = z.enum(PROVIDERS);

export const userSecretsRouter = router({
  /**
   * List all providers the current user has a key for, plus last4 metadata.
   * Returns one entry per known provider — null if not set.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return listUserSecretSummary(ctx.user.uid);
  }),

  /**
   * Store (or replace) a user's API key for the given provider.
   * The value is validated to be reasonably long; further format checks
   * happen at the provider layer when the key is first used.
   */
  setKey: protectedProcedure
    .input(
      z.object({
        provider: providerSchema,
        value: z
          .string()
          .min(8, 'API key looks too short')
          .max(2048, 'API key is implausibly long'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await setUserSecret(ctx.user.uid, input.provider as SecretProvider, input.value);
      return { ok: true };
    }),

  /**
   * Validates a candidate ByteDance key WITHOUT persisting it. Useful so the
   * settings UI can confirm credentials before storing — the small chat call
   * uses ~1 token round-trip on the user's own quota.
   */
  testBytedance: protectedProcedure
    .input(z.object({ value: z.string().min(8).max(2048) }))
    .mutation(async ({ input }) => {
      try {
        const reply = await bytedanceService.chat({
          apiKey: input.value,
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 4,
        });
        return { ok: true as const, sample: reply.content.slice(0, 40) };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }),

  /**
   * Validate a candidate Z.AI key (https://z.ai) without persisting it.
   * Round-trip a single ~1-token chat call against GLM-4.5-Air on the user's
   * own quota, so a bad paste surfaces an auth error before encryption.
   */
  testZai: protectedProcedure
    .input(z.object({ value: z.string().min(8).max(2048) }))
    .mutation(async ({ input }) => {
      try {
        const reply = await zaiService.chat({
          apiKey: input.value,
          model: 'glm-4.5-air',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 4,
        });
        return { ok: true as const, sample: reply.content.slice(0, 40) };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }),

  /**
   * Remove the user's stored key for the provider. Falls back to the
   * platform's shared key on subsequent generation calls.
   */
  clearKey: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(async ({ ctx, input }) => {
      await clearUserSecret(ctx.user.uid, input.provider as SecretProvider);
      return { ok: true };
    }),
});

export type UserSecretsRouter = typeof userSecretsRouter;
