/**
 * universes.create authorizes on the mint tx, not a wallet signature — Circle
 * DCW users have no client-side signer, so the old verifyMessage check failed
 * every EVM registration. These pin the tx/event binding that replaced it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { encodeAbiParameters, toEventSelector } from 'viem';
import { UniverseManager } from '@loar/abis/addresses';

const getSuccessfulTx = vi.hoisted(() => vi.fn());
vi.mock('../services/tx-verify', () => ({ getSuccessfulTx }));
vi.mock('../lib/firebase', () => ({ db: {} }));

const { verifyMintTx } = await import('../routers/universes/universes.routes');

const MANAGER = UniverseManager['11155111'].toLowerCase();
const CALLER = '0x116c28e6dcabca363f83217c712d79dce168d90e';
const UNIVERSE = '0x341ffa19c0ec8d2c8ef42a360cf799949844262e';
const HASH = '0x' + 'ab'.repeat(32);
const TOPIC = toEventSelector('UniverseCreated(address,address)');

function createdLog(universe: string, creator: string, address = MANAGER) {
  return {
    address,
    topics: [TOPIC],
    data: encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }],
      [universe as `0x${string}`, creator as `0x${string}`]
    ),
  };
}

function mockTx(from: string, logs: any[]) {
  getSuccessfulTx.mockResolvedValue({ tx: { from }, receipt: { status: 'success', logs } });
}

describe('verifyMintTx', () => {
  beforeEach(() => getSuccessfulTx.mockReset());

  it('accepts the caller’s own mint of this universe', async () => {
    mockTx(CALLER, [createdLog(UNIVERSE, CALLER)]);
    await expect(verifyMintTx(HASH, 11155111, UNIVERSE, CALLER)).resolves.toBeUndefined();
    expect(getSuccessfulTx).toHaveBeenCalledWith(HASH, 11155111);
  });

  it('requires a tx hash', async () => {
    await expect(verifyMintTx(undefined, 11155111, UNIVERSE, CALLER)).rejects.toThrow(
      'Mint transaction hash is required'
    );
  });

  it('rejects a tx sent by another wallet', async () => {
    mockTx('0x' + '22'.repeat(20), [createdLog(UNIVERSE, CALLER)]);
    await expect(verifyMintTx(HASH, 11155111, UNIVERSE, CALLER)).rejects.toThrow(
      'not sent by the authenticated wallet'
    );
  });

  it('rejects registering a universe address the tx did not create', async () => {
    mockTx(CALLER, [createdLog('0x' + '33'.repeat(20), CALLER)]);
    await expect(verifyMintTx(HASH, 11155111, UNIVERSE, CALLER)).rejects.toThrow(
      'did not create this universe'
    );
  });

  it('ignores UniverseCreated emitted by a non-manager contract', async () => {
    mockTx(CALLER, [createdLog(UNIVERSE, CALLER, '0x' + '44'.repeat(20))]);
    await expect(verifyMintTx(HASH, 11155111, UNIVERSE, CALLER)).rejects.toThrow(
      'did not create this universe'
    );
  });

  it('rejects unsupported chains', async () => {
    await expect(verifyMintTx(HASH, 1, UNIVERSE, CALLER)).rejects.toThrow('not supported');
  });
});
