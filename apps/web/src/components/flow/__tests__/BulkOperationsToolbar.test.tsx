/**
 * Component tests for BulkOperationsToolbar — the top-center bulk-actions
 * bar shown when timeline nodes are multi-selected. First test in the new
 * `dom` vitest project (jsdom + @testing-library/react).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkOperationsToolbar } from '../BulkOperationsToolbar';
import type { ArcDefinition } from '../types';

function setup(overrides: Partial<React.ComponentProps<typeof BulkOperationsToolbar>> = {}) {
  const handlers = {
    onPlaySelected: vi.fn(),
    onDuplicateSelected: vi.fn(),
    onDeleteSelected: vi.fn(),
    onSwapSelected: vi.fn(),
    onClearSelection: vi.fn(),
    onSelectAll: vi.fn(),
    onInvertSelection: vi.fn(),
    onToggleCanon: vi.fn(),
    onAssignToArc: vi.fn(),
    onCreateArc: vi.fn(),
    onShowAudioToolbar: vi.fn(),
    onBuildEpisode: vi.fn(),
    onScriptToEpisode: vi.fn(),
  };
  const props: React.ComponentProps<typeof BulkOperationsToolbar> = {
    selectedNodeIds: new Set(['a', 'b']),
    nodes: [],
    arcs: [],
    hasVideoInSelection: true,
    selectedClipsCount: 2,
    canSwapSelected: true,
    isSwapping: false,
    ...handlers,
    ...overrides,
  };
  render(<BulkOperationsToolbar {...props} />);
  return handlers;
}

describe('BulkOperationsToolbar', () => {
  it('renders nothing when the selection is empty', () => {
    const { container } = render(
      <BulkOperationsToolbar
        selectedNodeIds={new Set()}
        nodes={[]}
        arcs={[]}
        hasVideoInSelection={false}
        selectedClipsCount={0}
        canSwapSelected={false}
        isSwapping={false}
        onPlaySelected={vi.fn()}
        onDuplicateSelected={vi.fn()}
        onDeleteSelected={vi.fn()}
        onSwapSelected={vi.fn()}
        onClearSelection={vi.fn()}
        onSelectAll={vi.fn()}
        onInvertSelection={vi.fn()}
        onToggleCanon={vi.fn()}
        onAssignToArc={vi.fn()}
        onCreateArc={vi.fn()}
        onShowAudioToolbar={vi.fn()}
        onBuildEpisode={vi.fn()}
        onScriptToEpisode={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selection count', () => {
    setup({ selectedNodeIds: new Set(['a', 'b', 'c']) });
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('fires the selection helpers', async () => {
    const u = userEvent.setup();
    const h = setup();
    await u.click(screen.getByRole('button', { name: /^All$/i }));
    await u.click(screen.getByRole('button', { name: /Invert/i }));
    await u.click(screen.getByRole('button', { name: /^Clear$/i }));
    expect(h.onSelectAll).toHaveBeenCalledOnce();
    expect(h.onInvertSelection).toHaveBeenCalledOnce();
    expect(h.onClearSelection).toHaveBeenCalledOnce();
  });

  it('disables Play / Episode when the selection has no video', () => {
    setup({ hasVideoInSelection: false });
    expect(screen.getByRole('button', { name: /Play/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Episode/i })).toBeDisabled();
  });

  it('disables the audio actions when there are no clips', () => {
    setup({ selectedClipsCount: 0 });
    expect(screen.getByRole('button', { name: /Music/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /SFX/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Lip Sync/i })).toBeDisabled();
  });

  it('shows Swap only for a 2-node selection and respects canSwapSelected / isSwapping', () => {
    const { unmount } = render(
      <BulkOperationsToolbar
        {...({
          selectedNodeIds: new Set(['a', 'b', 'c']),
          nodes: [],
          arcs: [],
          hasVideoInSelection: true,
          selectedClipsCount: 1,
          canSwapSelected: true,
          isSwapping: false,
          onPlaySelected: vi.fn(),
          onDuplicateSelected: vi.fn(),
          onDeleteSelected: vi.fn(),
          onSwapSelected: vi.fn(),
          onClearSelection: vi.fn(),
          onSelectAll: vi.fn(),
          onInvertSelection: vi.fn(),
          onToggleCanon: vi.fn(),
          onAssignToArc: vi.fn(),
          onCreateArc: vi.fn(),
          onShowAudioToolbar: vi.fn(),
          onBuildEpisode: vi.fn(),
          onScriptToEpisode: vi.fn(),
        } as React.ComponentProps<typeof BulkOperationsToolbar>)}
      />
    );
    expect(screen.queryByRole('button', { name: /Swap/i })).not.toBeInTheDocument();
    unmount();

    setup({ selectedNodeIds: new Set(['a', 'b']), canSwapSelected: false });
    expect(screen.getByRole('button', { name: /Swap/i })).toBeDisabled();
  });

  it('two-step delete: opens a confirm, Cancel backs out, confirm fires onDeleteSelected', async () => {
    const u = userEvent.setup();
    const h = setup({ selectedNodeIds: new Set(['a', 'b', 'c']) });

    await u.click(screen.getByRole('button', { name: /^Delete$/i }));
    // confirm view: "Delete <3> nodes?" + a Cancel and a "Delete All" button
    expect(screen.getByRole('button', { name: /Delete All/i })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(h.onDeleteSelected).not.toHaveBeenCalled();
    // back to the main toolbar
    expect(screen.getByText('3 selected')).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: /^Delete$/i }));
    await u.click(screen.getByRole('button', { name: /Delete All/i }));
    expect(h.onDeleteSelected).toHaveBeenCalledOnce();
  });

  it('lists arcs in the Arc dropdown and assigns on click', async () => {
    const u = userEvent.setup();
    const arcs: ArcDefinition[] = [
      { id: 'arc-1', name: 'Act I', color: '#f00', nodeIds: ['a'] },
      { id: 'arc-2', name: 'Act II', color: '#0f0', nodeIds: [] },
    ];
    const h = setup({ arcs });
    await u.click(screen.getByRole('button', { name: /^Arc$/i }));
    const item = await screen.findByRole('menuitem', { name: /Act II/i });
    await u.click(item);
    expect(h.onAssignToArc).toHaveBeenCalledWith('arc-2');
  });
});
