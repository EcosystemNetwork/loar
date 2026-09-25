import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const ponderGql = vi.fn();
const buy = vi.fn();
let actionState: { status: string; error: string | null } = { status: 'idle', error: null };

vi.mock('@/utils/ponder-api', () => ({ ponderGql: (...a: unknown[]) => ponderGql(...a) }));
vi.mock('@/hooks/useBondingCurve', () => ({
  useBondingCurveActions: (curve: string | undefined) => ({
    buy: (...a: unknown[]) => buy(curve, ...a),
    status: actionState.status,
    error: actionState.error,
    retry: vi.fn(),
    canRetry: false,
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

import { DevBuyStep } from '../DevBuyStep';

const TOKEN = '0xAaAa1111111111111111111111111111111111Aa';
const CURVE = '0xc1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1';
const now = Math.floor(Date.now() / 1000);

function renderStep() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DevBuyStep deployer="0xDEAD" symbol="tst" ethAmount="0.05" sinceSec={now} />
    </QueryClientProvider>
  );
}

describe('DevBuyStep', () => {
  beforeEach(() => {
    ponderGql.mockReset();
    buy.mockReset();
    actionState = { status: 'idle', error: null };
  });

  it('waits for the indexer, then offers the buy once the curve is indexed', async () => {
    // First poll: token not indexed yet.
    ponderGql.mockResolvedValueOnce({ tokens: { items: [] } });
    renderStep();
    expect(await screen.findByText(/waiting for the indexer/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /buy 0.05 eth/i })).toBeNull();
  });

  it('buys the configured amount from the found curve on click', async () => {
    ponderGql.mockImplementation(async (q: string) =>
      q.includes('bondingCurves')
        ? { bondingCurves: { items: [{ id: CURVE }] } }
        : { tokens: { items: [{ id: TOKEN, symbol: 'TST', createdAt: now }] } }
    );
    renderStep();
    const btn = await screen.findByRole('button', { name: /buy 0.05 eth of \$tst/i });
    fireEvent.click(btn);
    await waitFor(() => expect(buy).toHaveBeenCalledWith(CURVE, '0.05'));
  });

  it('ignores an older token with the same symbol', async () => {
    ponderGql.mockImplementation(async (q: string) =>
      q.includes('bondingCurves')
        ? { bondingCurves: { items: [{ id: CURVE }] } }
        : { tokens: { items: [{ id: TOKEN, symbol: 'TST', createdAt: now - 86_400 }] } }
    );
    renderStep();
    expect(await screen.findByText(/waiting for the indexer/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /buy 0.05 eth/i })).toBeNull();
  });

  it('shows success once the buy is mined', async () => {
    actionState = { status: 'success', error: null };
    ponderGql.mockImplementation(async (q: string) =>
      q.includes('bondingCurves')
        ? { bondingCurves: { items: [{ id: CURVE }] } }
        : { tokens: { items: [{ id: TOKEN, symbol: 'TST', createdAt: now }] } }
    );
    renderStep();
    expect(await screen.findByText(/bought 0.05 eth of \$tst/i)).toBeTruthy();
  });
});
