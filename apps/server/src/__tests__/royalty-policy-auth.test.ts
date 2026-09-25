/**
 * royaltySplits.setPolicy authorization — real router against the real
 * Firestore emulator. The policy decides who gets paid on derivative works, so
 * the interesting cases are the fail-CLOSED ones.
 *
 * Prereq: firebase emulators:start --only firestore --project loar-db
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import './_real-firebase';

// setup.ts stubs lib/safe-admin (every check -> false); this suite needs the REAL ownership logic.
vi.unmock('../lib/safe-admin');
// setup.ts already configures the platform admin before any module loads.
const ADMIN = '0xad0000000000000000000000000000000000dead';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const SOL_OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

const POLICY = {
  byRightsClass: { fan: 'decay_7030', original: 'current_only', licensed: 'equal_share' },
  maxDepth: 4,
  minShareBps: 500,
} as const;

type Who = { uid: string; address?: string | null; apiKeyId?: string };
async function caller(user: Who | null) {
  const { router } = await import('../lib/trpc');
  const { royaltySplitsRouter } = await import('../routers/royaltySplits/royaltySplits.routes');
  return router({ splits: royaltySplitsRouter }).createCaller({
    user: user ? { email: 't@example.com', ...user } : null,
    clientIp: '127.0.0.1',
  } as never).splits;
}
const as = (address: string | null, extra: Partial<Who> = {}) =>
  caller({ uid: `uid-${address?.slice(2, 8) ?? 'none'}`, address, ...extra });

async function seedUniverse(id: string, data: Record<string, unknown>) {
  const { db } = await import('../lib/firebase');
  await db!.collection('cinematicUniverses').doc(id).set(data);
}
async function storedPolicy(id: string) {
  const { db } = await import('../lib/firebase');
  const snap = await db!.collection('universeRoyaltyPolicies').doc(id.toLowerCase()).get();
  return snap.exists ? snap.data() : null;
}

let evmId: string;
beforeEach(() => {
  evmId = `0x${randomUUID().replace(/-/g, '').padEnd(40, '0').slice(0, 40)}`;
});

describe('royaltySplits.setPolicy', () => {
  it('lets the universe creator set the policy, and records who did it', async () => {
    await seedUniverse(evmId, { creator: ALICE.toUpperCase().replace('0X', '0x') });
    const t = await as(ALICE);
    await expect(t.setPolicy({ universeId: evmId, config: POLICY })).resolves.toEqual({ ok: true });
    expect(await storedPolicy(evmId)).toMatchObject({
      maxDepth: 4,
      minShareBps: 500,
      updatedBy: 'uid-111111',
      updatedByAddress: ALICE,
    });
    // ...and it's what getPolicy now serves.
    const pub = await caller(null);
    expect((await pub.getPolicy({ universeId: evmId })).config).toMatchObject({
      maxDepth: 4,
      minShareBps: 500,
    });
  });

  it("refuses someone who isn't the owner, and writes nothing", async () => {
    await seedUniverse(evmId, { creator: ALICE });
    const t = await as(BOB);
    await expect(t.setPolicy({ universeId: evmId, config: POLICY })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await storedPolicy(evmId)).toBeNull();
  });

  it('FAILS CLOSED when the universe has no document (no "no owner on file, so anyone may")', async () => {
    const t = await as(BOB);
    await expect(t.setPolicy({ universeId: evmId, config: POLICY })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await storedPolicy(evmId)).toBeNull();
  });

  it('platform admins can still set any policy, even for a universe with no document', async () => {
    const t = await as(ADMIN);
    await expect(t.setPolicy({ universeId: evmId, config: POLICY })).resolves.toEqual({ ok: true });
    expect(await storedPolicy(evmId)).toMatchObject({ updatedByAddress: ADMIN });
  });

  it("an API key can't rewrite splits, even the owner's own key", async () => {
    await seedUniverse(evmId, { creator: ALICE });
    const t = await as(ALICE, { apiKeyId: 'key-1' });
    await expect(t.setPolicy({ universeId: evmId, config: POLICY })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await storedPolicy(evmId)).toBeNull();
  });

  it('needs a wallet address and a signed-in user', async () => {
    await seedUniverse(evmId, { creator: ALICE });
    await expect(
      (await as(null)).setPolicy({ universeId: evmId, config: POLICY })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      (await caller(null)).setPolicy({ universeId: evmId, config: POLICY })
    ).rejects.toThrow();
  });

  it('Solana universe ids/addresses are case-SENSITIVE: exact owner passes, a re-cased address does not', async () => {
    const pda = `Sol${randomUUID().replace(/-/g, '').slice(0, 30)}`;
    await seedUniverse(pda, { creator: SOL_OWNER });
    await expect(
      (await as(SOL_OWNER.toLowerCase())).setPolicy({ universeId: pda, config: POLICY })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      (await as(SOL_OWNER)).setPolicy({ universeId: pda, config: POLICY })
    ).resolves.toEqual({ ok: true });
  });

  it("denies the creator when the universe has a contract whose on-chain owner can't be confirmed", async () => {
    // Strict check: viem's readContract is stubbed to reject in this suite, i.e. the
    // chain can't confirm owner() — the creator on file alone is NOT enough.
    await seedUniverse(evmId, {
      creator: ALICE,
      contractAddress: '0x3333333333333333333333333333333333333333',
    });
    await expect(
      (await as(ALICE)).setPolicy({ universeId: evmId, config: POLICY })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await storedPolicy(evmId)).toBeNull();
  });

  it('still validates the policy shape', async () => {
    await seedUniverse(evmId, { creator: ALICE });
    const t = await as(ALICE);
    await expect(
      t.setPolicy({ universeId: evmId, config: { ...POLICY, minShareBps: 5000 } as never })
    ).rejects.toThrow();
  });
});
