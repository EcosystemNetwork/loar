/**
 * Component tests for NodeFilterBar — the timeline editor's search/filter
 * strip. Pairs with the pure nodeMatchesFilter tests in nodeFilter.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeFilterBar } from '../NodeFilterBar';
import { DEFAULT_FILTER, type ArcDefinition, type NodeFilter } from '../types';

function setup(over: Partial<React.ComponentProps<typeof NodeFilterBar>> = {}) {
  const h = {
    onSearchTextChange: vi.fn(),
    onCanonStatusChange: vi.fn(),
    onArcIdChange: vi.fn(),
    onHasVideoChange: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
  };
  const props: React.ComponentProps<typeof NodeFilterBar> = {
    filter: DEFAULT_FILTER,
    isActive: false,
    arcs: [],
    matchCount: 0,
    totalCount: 10,
    ...h,
    ...over,
  };
  render(<NodeFilterBar {...props} />);
  return h;
}

const filter = (o: Partial<NodeFilter>): NodeFilter => ({ ...DEFAULT_FILTER, ...o });

describe('NodeFilterBar — search', () => {
  it('reflects filter.searchText and reports edits', async () => {
    const u = userEvent.setup();
    const h = setup({ filter: filter({ searchText: 'prayer' }) });
    const input = screen.getByPlaceholderText('Search nodes...') as HTMLInputElement;
    expect(input.value).toBe('prayer');
    await u.type(input, 'X');
    expect(h.onSearchTextChange).toHaveBeenCalledWith('prayerX');
  });

  it('Escape in the search box closes the bar', async () => {
    const u = userEvent.setup();
    const h = setup();
    await u.type(screen.getByPlaceholderText('Search nodes...'), '{Escape}');
    expect(h.onClose).toHaveBeenCalledOnce();
  });
});

describe('NodeFilterBar — facet dropdowns', () => {
  it('canon dropdown routes each choice to onCanonStatusChange', async () => {
    const u = userEvent.setup();
    const h = setup();
    await u.click(screen.getByRole('button', { name: /Canon/i }));
    await u.click(await screen.findByRole('menuitem', { name: 'Canon Only' }));
    expect(h.onCanonStatusChange).toHaveBeenCalledWith('canon');
  });

  it('video dropdown routes each choice to onHasVideoChange', async () => {
    const u = userEvent.setup();
    const h = setup();
    await u.click(screen.getByRole('button', { name: /^Video$/i }));
    await u.click(await screen.findByRole('menuitem', { name: 'No Video' }));
    expect(h.onHasVideoChange).toHaveBeenCalledWith('no');
  });

  it('button labels reflect the active facet values', () => {
    setup({ filter: filter({ canonStatus: 'non-canon', hasVideo: 'yes' }) });
    expect(screen.getByRole('button', { name: /Non-Canon/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Has Video/i })).toBeInTheDocument();
  });
});

describe('NodeFilterBar — arcs', () => {
  // Deliberately non-overlapping names so a regex role query can't match two.
  const arcs: ArcDefinition[] = [
    { id: 'a1', name: 'Prologue', color: '#f00', nodeIds: ['x', 'y'] },
    { id: 'a2', name: 'Finale', color: '#0f0', nodeIds: [] },
  ];

  it('hides the Arc control when there are no arcs', () => {
    setup({ arcs: [] });
    expect(screen.queryByRole('button', { name: /^Arc$/i })).not.toBeInTheDocument();
  });

  it('lists arcs and routes selection / clear', async () => {
    const u = userEvent.setup();
    const h = setup({ arcs });
    await u.click(screen.getByRole('button', { name: /^Arc$/i }));
    await u.click(await screen.findByRole('menuitem', { name: /Prologue/ }));
    expect(h.onArcIdChange).toHaveBeenCalledWith('a1');

    await u.click(screen.getByRole('button', { name: /^Arc$/i }));
    await u.click(await screen.findByRole('menuitem', { name: 'All Arcs' }));
    expect(h.onArcIdChange).toHaveBeenCalledWith(null);
  });

  it('shows the selected arc name on the trigger', () => {
    setup({ arcs, filter: filter({ arcId: 'a2' }) });
    expect(screen.getByRole('button', { name: /Finale/i })).toBeInTheDocument();
  });
});

describe('NodeFilterBar — active state', () => {
  it('shows match/total and a clear button only when isActive', async () => {
    const u = userEvent.setup();
    const h = setup({ isActive: true, matchCount: 3, totalCount: 12 });
    expect(screen.getByText('3/12')).toBeInTheDocument();
    await u.click(screen.getByTitle('Clear filters'));
    expect(h.onClear).toHaveBeenCalledOnce();
  });

  it('hides match/total when not active', () => {
    setup({ isActive: false, matchCount: 0, totalCount: 12 });
    expect(screen.queryByText('0/12')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Clear filters')).not.toBeInTheDocument();
  });
});
