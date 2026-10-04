/**
 * Audit R4-5: purchase/mint records must be bound to an actual NFT mint to the
 * caller, not merely "any successful tx from the caller".
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/firebase', () => ({ db: null, firebaseAvailable: false }));

const { receiptHasMintTo } = await import('../services/tx-verify');

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const ZERO = '0x' + '0'.repeat(64);
const pad = (hex: string) => '0x' + hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

const BUYER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const NFT = '0x286F5281114753821A18B36e5a3E532E3d19305C';

const erc721Mint = (to: string, tokenId: number, address = NFT) => ({
  address,
  topics: [TRANSFER, ZERO, pad(to), pad(tokenId.toString(16))],
  data: '0x',
});

describe('receiptHasMintTo', () => {
  it('accepts an ERC-721 mint to the buyer', () => {
    expect(receiptHasMintTo({ logs: [erc721Mint(BUYER, 7)] }, BUYER)).toBe(true);
  });

  it('binds contract and tokenId when given', () => {
    const r = { logs: [erc721Mint(BUYER, 7)] };
    expect(receiptHasMintTo(r, BUYER, { contract: NFT.toLowerCase(), tokenId: 7 })).toBe(true);
    expect(receiptHasMintTo(r, BUYER, { tokenId: 8 })).toBe(false);
    expect(receiptHasMintTo(r, BUYER, { contract: OTHER })).toBe(false);
  });

  it('rejects mints to someone else and non-mint transfers', () => {
    expect(receiptHasMintTo({ logs: [erc721Mint(OTHER, 1)] }, BUYER)).toBe(false);
    const transfer = {
      address: NFT,
      topics: [TRANSFER, pad(OTHER), pad(BUYER), pad('1')],
      data: '0x',
    };
    expect(receiptHasMintTo({ logs: [transfer] }, BUYER)).toBe(false);
  });

  it('accepts an ERC-1155 TransferSingle mint and checks its id', () => {
    const log = {
      address: NFT,
      topics: [TRANSFER_SINGLE, pad(BUYER), ZERO, pad(BUYER)],
      data: '0x' + pad('5').slice(2) + pad('1').slice(2),
    };
    expect(receiptHasMintTo({ logs: [log] }, BUYER, { tokenId: 5 })).toBe(true);
    expect(receiptHasMintTo({ logs: [log] }, BUYER, { tokenId: 6 })).toBe(false);
  });

  it('rejects a receipt with no logs (e.g. a plain value transfer)', () => {
    expect(receiptHasMintTo({ logs: [] }, BUYER)).toBe(false);
    expect(receiptHasMintTo({}, BUYER)).toBe(false);
  });
});
