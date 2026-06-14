/**
 * Unit tests for the x402 payment-handshake encoding (pure logic — no network).
 */
import { describe, it, expect } from 'vitest';
import {
  paymentRequiredBody,
  parsePaymentHeader,
  X402_VERSION,
  X402_NETWORK,
  X402_SCHEME,
} from '../lib/x402';
import { ARC_USDC } from '../lib/arc';

const PAY_TO = '0x80baf7fffc430cdaced4f1d673f4138d6d493077';

describe('paymentRequiredBody', () => {
  it('builds a valid x402 402 body with USDC raw amount', () => {
    const body = paymentRequiredBody({
      amountUsdc: '0.01',
      payTo: PAY_TO,
      resource: '/api/x402/echo',
      extra: { name: 'USDC', version: '1' },
    });
    expect(body.x402Version).toBe(X402_VERSION);
    expect(body.accepts).toHaveLength(1);
    const req = body.accepts[0];
    expect(req.scheme).toBe(X402_SCHEME);
    expect(req.network).toBe(X402_NETWORK);
    expect(req.maxAmountRequired).toBe('10000'); // 0.01 * 1e6
    expect(req.payTo).toBe(PAY_TO);
    expect(req.asset.toLowerCase()).toBe(ARC_USDC.toLowerCase());
    expect(req.extra).toEqual({ name: 'USDC', version: '1' });
  });
});

describe('parsePaymentHeader', () => {
  it('decodes a canonical EIP-3009 payment payload', () => {
    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network: X402_NETWORK,
      payload: {
        signature: '0xabc',
        authorization: {
          from: '0x1111111111111111111111111111111111111111',
          to: PAY_TO,
          value: '10000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: '0x' + '33'.repeat(32),
        },
      },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString('base64');
    expect(parsePaymentHeader(header)).toEqual(payload);
  });
  it('returns null for missing, malformed, or non-EIP-3009 headers', () => {
    expect(parsePaymentHeader(null)).toBeNull();
    expect(parsePaymentHeader(undefined)).toBeNull();
    expect(parsePaymentHeader('not-base64-json!!!')).toBeNull();
    // Legacy {txHash} shape is no longer accepted.
    expect(
      parsePaymentHeader(Buffer.from(JSON.stringify({ txHash: '0xabc' })).toString('base64'))
    ).toBeNull();
  });
});
