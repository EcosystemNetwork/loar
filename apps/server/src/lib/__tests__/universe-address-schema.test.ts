/**
 * Unit tests for the shared `universeAddressSchema` (lib/universe-address-schema.ts).
 *
 * Regression guard for the incident where physics, entities, curation, and
 * notebook routers each hand-rolled `/^0x[a-fA-F0-9]{40}$/` and 400'd every
 * request for a Solana universe (base58 PDA) — physics was fixed first
 * (7313fae7), the other three followed in the same incident (82897e88).
 * These tests pin the schema's contract in isolation so a future router
 * can't quietly reintroduce an EVM-only regex here.
 */
import { describe, it, expect } from 'vitest';
import { universeAddressSchema } from '../universe-address-schema';

// The exact PDA from the reported incident (loar.fun/universe/H9E6T6...).
const REPORTED_SOLANA_PDA = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';

function accepts(value: unknown) {
  return universeAddressSchema.safeParse(value).success;
}

describe('universeAddressSchema', () => {
  describe('accepts every real address shape', () => {
    it('accepts a lowercased EVM 0x address', () => {
      expect(accepts('0x89669812f850f34f907ee9e9009f501d1b008420')).toBe(true);
    });

    it('accepts a mixed-case / checksummed EVM address (schema does not enforce checksum)', () => {
      expect(accepts('0x89669812f850f34F907ee9e9009f501d1B008420')).toBe(true);
    });

    it('accepts an uppercase-hex EVM address', () => {
      expect(accepts('0X89669812F850F34F907EE9E9009F501D1B008420')).toBe(true);
    });

    it('accepts the exact reported Solana base58 PDA', () => {
      expect(accepts(REPORTED_SOLANA_PDA)).toBe(true);
    });

    it('accepts a 32-char and a 44-char Solana base58 address', () => {
      expect(accepts('11111111111111111111111111111111')).toBe(true); // 32 chars
      expect(accepts('So11111111111111111111111111111111111111112')).toBe(true); // 44 chars
    });

    it('accepts a single-character string (format-agnostic by design)', () => {
      expect(accepts('x')).toBe(true);
    });
  });

  describe('rejects only genuinely empty/missing input', () => {
    it('rejects an empty string with the required-field message', () => {
      const result = universeAddressSchema.safeParse('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Universe address is required');
      }
    });

    it('rejects undefined', () => {
      expect(accepts(undefined)).toBe(false);
    });

    it('rejects null', () => {
      expect(accepts(null)).toBe(false);
    });

    it('rejects a non-string type (number)', () => {
      expect(accepts(1234)).toBe(false);
    });

    it('rejects a non-string type (object)', () => {
      expect(accepts({ address: REPORTED_SOLANA_PDA })).toBe(false);
    });
  });

  describe('never re-applies the old EVM-only regex', () => {
    it('does NOT reject a value just because it fails /^0x[a-fA-F0-9]{40}$/', () => {
      const OLD_EVM_ONLY_REGEX = /^0x[a-fA-F0-9]{40}$/;
      expect(OLD_EVM_ONLY_REGEX.test(REPORTED_SOLANA_PDA)).toBe(false); // old behavior: would reject
      expect(accepts(REPORTED_SOLANA_PDA)).toBe(true); // fixed behavior: accepts
    });

    it('accepts every base58 Solana address that the old EVM regex would have rejected', () => {
      const solanaExamples = [
        REPORTED_SOLANA_PDA,
        'So11111111111111111111111111111111111111112',
        '11111111111111111111111111111111',
      ];
      const OLD_EVM_ONLY_REGEX = /^0x[a-fA-F0-9]{40}$/;
      for (const addr of solanaExamples) {
        expect(OLD_EVM_ONLY_REGEX.test(addr)).toBe(false);
        expect(accepts(addr)).toBe(true);
      }
    });
  });
});
