import { describe, it, expect } from 'vitest';
import { feeAssets } from '@/lib/fee-assets';

const WETH = '0x4200000000000000000000000000000000000006';
const t = (id: string, symbol: string, pairedToken = WETH) => ({ id, symbol, pairedToken });

describe('feeAssets', () => {
  it('lists the shared quote token once, then each launched token', () => {
    const rows = feeAssets([t('0xa', 'AAA'), t('0xb', 'BBB')]);
    expect(rows.map((r) => [r.kind, r.asset])).toEqual([
      ['quote', WETH],
      ['token', '0xa'],
      ['token', '0xb'],
    ]);
  });
  it('keeps distinct quote tokens and de-dupes case-insensitively', () => {
    const rows = feeAssets([
      t('0xa', 'A', WETH),
      t('0xb', 'B', WETH.toUpperCase().replace('0X', '0x')),
      t('0xc', 'C', '0xusdc'),
    ]);
    expect(rows.filter((r) => r.kind === 'quote')).toHaveLength(2);
  });
  it('is empty for no tokens', () => {
    expect(feeAssets([])).toEqual([]);
  });
});
