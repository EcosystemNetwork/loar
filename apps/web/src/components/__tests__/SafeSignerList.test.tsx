/**
 * Component tests for SafeSignerList — read-only Safe multi-sig owner list
 * shown in governance / universe settings.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockAccount = vi.fn(() => ({ address: undefined as string | undefined }));
vi.mock('@/hooks/useWalletAccount', () => ({
  useWalletAccount: () => mockAccount(),
}));

import { SafeSignerList } from '../SafeSignerList';

const OWNERS = [
  '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
];
const SAFE = '0xSafe000000000000000000000000000000000000';

function setup(address?: string) {
  mockAccount.mockReturnValue({ address });
  render(<SafeSignerList owners={OWNERS} threshold={2} safeAddress={SAFE} />);
}

describe('SafeSignerList', () => {
  it('shows the threshold-of-N badge and the safe address', () => {
    setup();
    expect(screen.getByText('2-of-3')).toBeInTheDocument();
    expect(screen.getByText(SAFE)).toBeInTheDocument();
  });

  it('renders every owner truncated as 0xXXXXXXXX...XXXXXX', () => {
    setup();
    expect(screen.getByText('0xAAAAAA...AAAAAA')).toBeInTheDocument();
    expect(screen.getByText('0xBBBBBB...BBBBBB')).toBeInTheDocument();
    expect(screen.getByText('0xCCCCCC...CCCCCC')).toBeInTheDocument();
  });

  it('marks no owner as "You" when the wallet is not connected', () => {
    setup(undefined);
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });

  it('marks the connected wallet as "You", case-insensitively, exactly once', () => {
    setup(OWNERS[1].toLowerCase());
    const you = screen.getAllByText('You');
    expect(you).toHaveLength(1);
  });
});
