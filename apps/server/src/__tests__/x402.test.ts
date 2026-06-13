/**
 * Unit tests for the x402 payment-handshake encoding (pure logic — no network).
 */
import { describe, it, expect } from 'vitest';
import { paymentRequiredBody, parsePaymentHeader, X402_VERSION, X402_NETWORK } from '../lib/x402';
import { ARC_USDC } from '../lib/arc';

const PAY_TO = '0x80baf7fffc430cdaced4f1d673f4138d6d493077';

describe('paymentRequiredBody', () => {
  it('builds a valid x402 402 body with USDC raw amount', () => {
    const body = paymentRequiredBody({
      amountUsdc: '0.01',
      payTo: PAY_TO,
      resource: '/api/x402/echo',
    });
    expect(body.x402Version).toBe(X402_VERSION);
    expect(body.accepts).toHaveLength(1);
    const req = body.accepts[0];
    expect(req.scheme).toBe('exact');
    expect(req.network).toBe(X402_NETWORK);
    expect(req.maxAmountRequired).toBe('10000'); // 0.01 * 1e6
    expect(req.payTo).toBe(PAY_TO);
    expect(req.asset.toLowerCase()).toBe(ARC_USDC.toLowerCase());
    expect(req.extra.decimals).toBe(6);
  });
});

describe('parsePaymentHeader', () => {
  it('decodes a base64 JSON payment payload', () => {
    const header = Buffer.from(JSON.stringify({ txHash: '0xabc' })).toString('base64');
    expect(parsePaymentHeader(header)).toEqual({ txHash: '0xabc' });
  });
  it('returns null for missing or malformed headers', () => {
    expect(parsePaymentHeader(null)).toBeNull();
    expect(parsePaymentHeader(undefined)).toBeNull();
    expect(parsePaymentHeader('not-base64-json!!!')).toBeNull();
  });
});
