/**
 * NodeCountChip — the always-visible toolbar readout of node count + source
 * (see the component's own header for the incidents that motivated it).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeCountChip } from '../NodeCountChip';

function renderChip(props: Partial<React.ComponentProps<typeof NodeCountChip>> = {}) {
  return render(
    <NodeCountChip
      liveCount={14}
      graphDataCount={14}
      rawOnChainNodeCount={116}
      graphSource="on-chain"
      isLoadingAny={false}
      {...props}
    />
  );
}

describe('NodeCountChip', () => {
  it('shows the live count on the trigger', () => {
    renderChip({ liveCount: 14 });
    expect(screen.getByTestId('node-count-chip')).toHaveTextContent('14 nodes');
  });

  it('shows "…" instead of a count while loading', () => {
    renderChip({ isLoadingAny: true });
    expect(screen.getByTestId('node-count-chip')).toHaveTextContent('… node');
  });

  it('pluralizes a single node correctly', () => {
    renderChip({ liveCount: 1 });
    expect(screen.getByTestId('node-count-chip')).toHaveTextContent('1 node');
    expect(screen.getByTestId('node-count-chip')).not.toHaveTextContent('1 nodes');
  });

  it('breaks down live vs. source count, source label, and hidden-by-override on expand', async () => {
    const user = userEvent.setup();
    renderChip({
      liveCount: 14,
      graphDataCount: 14,
      rawOnChainNodeCount: 116,
      graphSource: 'on-chain',
    });
    await user.click(screen.getByTestId('node-count-chip'));

    expect(await screen.findByText('on-chain')).toBeInTheDocument();
    // Live on canvas / from data source / raw on-chain total / hidden by
    // override all render as separate dd values — the 14, 14, 116, 102 cells.
    expect(screen.getAllByText('14').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('116')).toBeInTheDocument();
    expect(screen.getByText('102')).toBeInTheDocument(); // 116 - 14 hidden by override
  });

  it('labels an off-chain fallback distinctly from a genuine on-chain graph', async () => {
    const user = userEvent.setup();
    renderChip({
      graphSource: 'off-chain-fallback',
      rawOnChainNodeCount: 0,
      liveCount: 26,
      graphDataCount: 26,
    });
    await user.click(screen.getByTestId('node-count-chip'));
    expect(await screen.findByText('off-chain (fallback)')).toBeInTheDocument();
    // Not on-chain, so the raw-total/hidden-by-override rows don't render.
    expect(screen.queryByText('Raw on-chain total')).not.toBeInTheDocument();
  });

  it('logs a transition when the live count changes across a re-render', async () => {
    const user = userEvent.setup();
    const { rerender } = renderChip({ liveCount: 0, graphDataCount: 0, isLoadingAny: true });
    rerender(
      <NodeCountChip
        liveCount={26}
        graphDataCount={26}
        rawOnChainNodeCount={0}
        graphSource="off-chain-fallback"
        isLoadingAny={false}
      />
    );

    await user.click(screen.getByTestId('node-count-chip'));
    const log = await screen.findByTestId('node-count-history');
    expect(log).toHaveTextContent('26 nodes');
  });

  it('flags a drop (count decreasing with no loading state between) — the exact "pop up and disappear" shape', async () => {
    const user = userEvent.setup();
    const { rerender } = renderChip({ liveCount: 26, graphDataCount: 26, isLoadingAny: false });
    // First transition recorded: loading -> 26 requires an intermediate
    // loading render to seed history; go straight to a same-loading-state
    // drop, which is what the bug actually looks like (no spinner between).
    rerender(
      <NodeCountChip
        liveCount={0}
        graphDataCount={0}
        rawOnChainNodeCount={0}
        graphSource="empty"
        isLoadingAny={false}
      />
    );

    expect(await screen.findByTestId('node-count-chip')).toHaveClass('animate-pulse');
    await user.click(screen.getByTestId('node-count-chip'));
    expect(
      await screen.findByText(/live count just dropped with no loading state/)
    ).toBeInTheDocument();
  });
});
