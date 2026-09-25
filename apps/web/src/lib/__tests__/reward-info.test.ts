import { describe, it, expect } from 'vitest';
import { parseTokenRewardInfo } from '../reward-info';

const TOKEN = '0xaaaa1111111111111111111111111111111111aa';
const ADMIN = '0x1111111111111111111111111111111111111111';
const RCPT = '0x2222222222222222222222222222222222222222';
const ZERO = '0x0000000000000000000000000000000000000000';
const pk = { currency0: ZERO, currency1: ZERO, fee: 0, tickSpacing: 0, hooks: ZERO };

describe('parseTokenRewardInfo', () => {
  it("reads viem's named-object struct (the real shape)", () => {
    expect(
      parseTokenRewardInfo({
        token: TOKEN,
        poolKey: pk,
        positionId: 1n,
        numPositions: 1n,
        rewardBps: [10000],
        rewardAdmins: [ADMIN],
        rewardRecipients: [RCPT],
      })
    ).toEqual({ rewardBps: [10000], rewardAdmins: [ADMIN], rewardRecipients: [RCPT] });
  });
  it('coerces bigint-ish bps and reads tuple-shaped results by struct order', () => {
    const tuple = [TOKEN, pk, 1n, 1n, [6000n, 4000n], [ADMIN, ADMIN], [RCPT, RCPT]];
    expect(parseTokenRewardInfo(tuple)).toEqual({
      rewardBps: [6000, 4000],
      rewardAdmins: [ADMIN, ADMIN],
      rewardRecipients: [RCPT, RCPT],
    });
  });
  it('is null for an unregistered token, empty config, or junk — and never throws', () => {
    expect(
      parseTokenRewardInfo({ token: ZERO, rewardBps: [], rewardAdmins: [], rewardRecipients: [] })
    ).toBeNull();
    expect(
      parseTokenRewardInfo({ token: TOKEN, rewardBps: [], rewardAdmins: [], rewardRecipients: [] })
    ).toBeNull();
    expect(parseTokenRewardInfo(undefined)).toBeNull();
    expect(parseTokenRewardInfo('x')).toBeNull();
    expect(parseTokenRewardInfo({})).toBeNull();
    expect(
      parseTokenRewardInfo({
        token: TOKEN,
        rewardBps: 'nope',
        rewardAdmins: null,
        rewardRecipients: [RCPT],
      })
    ).toEqual({ rewardBps: [], rewardAdmins: [], rewardRecipients: [RCPT] });
  });
});
