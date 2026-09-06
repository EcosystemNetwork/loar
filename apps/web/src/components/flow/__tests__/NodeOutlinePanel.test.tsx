/**
 * Component tests for NodeOutlinePanel — the collapsible left sidebar that
 * renders the timeline DAG as a tree (built from buildParentMap /
 * findRootNodes, both covered in graphHelpers.test.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Edge, Node } from 'reactflow';
import { NodeOutlinePanel } from '../NodeOutlinePanel';
import type { TimelineNodeData } from '../TimelineNodes';
import type { ArcDefinition } from '../types';

const scene = (id: string, d: Partial<TimelineNodeData> = {}): Node<TimelineNodeData> => ({
  id,
  position: { x: 0, y: 0 },
  data: { nodeType: 'scene', label: id, description: '', ...d } as TimelineNodeData,
});
const edge = (s: string, t: string): Edge => ({ id: `${s}-${t}`, source: s, target: t });

// 1 → 2 → {3, 4}
const NODES = [
  scene('1', { label: 'Opening', videoUrl: 'https://1.mp4', isInCanonChain: true }),
  scene('2', { label: 'Rising' }),
  scene('3', { label: 'Climax' }),
  scene('4', { label: 'Coda' }),
];
const EDGES = [edge('1', '2'), edge('2', '3'), edge('2', '4')];

function setup(over: Partial<React.ComponentProps<typeof NodeOutlinePanel>> = {}) {
  const h = { onOpenChange: vi.fn(), onNavigateToNode: vi.fn(), onToggleSelect: vi.fn() };
  const props: React.ComponentProps<typeof NodeOutlinePanel> = {
    open: true,
    nodes: NODES,
    edges: EDGES,
    arcs: [],
    selectedNodeIds: new Set(),
    ...h,
    ...over,
  };
  render(<NodeOutlinePanel {...props} />);
  return h;
}

describe('NodeOutlinePanel — visibility & stats', () => {
  it('renders nothing meaningful when closed', () => {
    setup({ open: false });
    expect(screen.queryByText('Node Outline')).not.toBeInTheDocument();
  });

  it('shows the stat line', () => {
    setup({ selectedNodeIds: new Set(['2']) });
    expect(screen.getByText('4 nodes')).toBeInTheDocument();
    expect(screen.getByText('1 canon')).toBeInTheDocument();
    expect(screen.getByText('1 with video')).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('shows an empty state when there are no scene nodes', () => {
    setup({ nodes: [scene('add', { nodeType: 'add' })], edges: [] });
    expect(screen.getByText('No scene nodes')).toBeInTheDocument();
  });
});

describe('NodeOutlinePanel — tree', () => {
  it('renders every node label in the hierarchy', () => {
    setup();
    for (const label of ['Opening', 'Rising', 'Climax', 'Coda']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('clicking a row navigates to that node', async () => {
    const u = userEvent.setup();
    const h = setup();
    await u.click(screen.getByText('Rising'));
    expect(h.onNavigateToNode).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
  });

  it('the eye toggle selects without also navigating', async () => {
    const u = userEvent.setup();
    const h = setup();
    const row = screen.getByText('Climax').closest('div')!;
    await u.click(within(row).getByTitle(/Select|Deselect/));
    expect(h.onToggleSelect).toHaveBeenCalledWith('3');
    expect(h.onNavigateToNode).not.toHaveBeenCalled();
  });

  it('collapsing a parent hides its children', async () => {
    const u = userEvent.setup();
    setup();
    expect(screen.getByText('Climax')).toBeInTheDocument();
    // the chevron button is the first button inside the "Rising" row
    const risingRow = screen.getByText('Rising').closest('div')!;
    await u.click(within(risingRow).getAllByRole('button')[0]);
    expect(screen.queryByText('Climax')).not.toBeInTheDocument();
    expect(screen.queryByText('Coda')).not.toBeInTheDocument();
  });
});

describe('NodeOutlinePanel — badges', () => {
  it('shows a Canon badge on canon nodes only', () => {
    setup();
    const opening = screen.getByText('Opening').closest('div')!;
    expect(within(opening).getByText('Canon')).toBeInTheDocument();
    const rising = screen.getByText('Rising').closest('div')!;
    expect(within(rising).queryByText('Canon')).not.toBeInTheDocument();
  });

  it('shows an arc badge for a node that belongs to an arc', () => {
    const arcs: ArcDefinition[] = [{ id: 'a1', name: 'Act I', color: '#f00', nodeIds: ['1', '2'] }];
    setup({ arcs });
    const opening = screen.getByText('Opening').closest('div')!;
    expect(within(opening).getByText('Act I')).toBeInTheDocument();
  });
});

describe('NodeOutlinePanel — search', () => {
  it('keeps a matching node and its ancestors, drops the rest', async () => {
    const u = userEvent.setup();
    setup();
    await u.type(screen.getByPlaceholderText('Filter nodes...'), 'climax');
    expect(screen.getByText('Climax')).toBeInTheDocument();
    expect(screen.getByText('Opening')).toBeInTheDocument(); // ancestor kept
    expect(screen.getByText('Rising')).toBeInTheDocument(); // ancestor kept
    expect(screen.queryByText('Coda')).not.toBeInTheDocument(); // sibling dropped
  });

  it('matches on eventId / displayName too', async () => {
    const u = userEvent.setup();
    setup({
      nodes: [scene('1', { label: 'x', displayName: 'HERALD', eventId: '99' })],
      edges: [],
    });
    await u.type(screen.getByPlaceholderText('Filter nodes...'), 'herald');
    expect(screen.getByText('HERALD')).toBeInTheDocument();
  });
});
