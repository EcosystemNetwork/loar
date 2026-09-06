/**
 * Component tests for NodeContextMenu — the timeline node right-click menu.
 * Plain <button>s (no Radix), so straightforward under jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Node } from 'reactflow';
import { NodeContextMenu } from '../NodeContextMenu';
import type { TimelineNodeData } from '../TimelineNodes';
import type { ArcDefinition } from '../types';

function node(over: Partial<TimelineNodeData> & { id?: string } = {}): Node<TimelineNodeData> {
  const { id = 'blockchain-node-5', ...data } = over;
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'scene',
      label: 'Scene 5',
      description: '',
      eventId: '5',
      blockchainNodeId: 5,
      ...data,
    } as TimelineNodeData,
  } as Node<TimelineNodeData>;
}

function setup(over: Partial<React.ComponentProps<typeof NodeContextMenu>> = {}) {
  const h = {
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onBranch: vi.fn(),
    onToggleCanon: vi.fn(),
    onDelete: vi.fn(),
    onAssignToArc: vi.fn(),
    onCreateArc: vi.fn(),
    onPlay: vi.fn(),
    onMarkForSwap: vi.fn(),
    onSwapWithMarked: vi.fn(),
    onClearSwapMark: vi.fn(),
  };
  const props: React.ComponentProps<typeof NodeContextMenu> = {
    state: { visible: true, x: 10, y: 10, nodeId: 'blockchain-node-5' },
    node: node(),
    arcs: [],
    universeId: '0xuni',
    swapMarkNodeId: null,
    swapMarkLabel: null,
    isSwapping: false,
    ...h,
    ...over,
  };
  render(<NodeContextMenu {...props} />);
  return h;
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(() => Promise.resolve()) },
    configurable: true,
  });
  vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('NodeContextMenu — visibility', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(
      <NodeContextMenu
        {...({ ...defaultProps(), state: { visible: false, x: 0, y: 0, nodeId: null } } as any)}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when node is null', () => {
    const { container } = render(
      <NodeContextMenu {...({ ...defaultProps(), node: null } as any)} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

function defaultProps(): React.ComponentProps<typeof NodeContextMenu> {
  return {
    state: { visible: true, x: 10, y: 10, nodeId: 'blockchain-node-5' },
    node: node(),
    arcs: [],
    universeId: '0xuni',
    swapMarkNodeId: null,
    swapMarkLabel: null,
    isSwapping: false,
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onBranch: vi.fn(),
    onToggleCanon: vi.fn(),
    onDelete: vi.fn(),
    onAssignToArc: vi.fn(),
    onCreateArc: vi.fn(),
    onPlay: vi.fn(),
    onMarkForSwap: vi.fn(),
    onSwapWithMarked: vi.fn(),
    onClearSwapMark: vi.fn(),
  };
}

describe('NodeContextMenu — header', () => {
  it('shows displayName over label over "Event <id>"', () => {
    setup({ node: node({ displayName: 'Herald Prime', label: 'x' }) });
    expect(screen.getByText('Herald Prime')).toBeInTheDocument();
  });

  it('shows a Canon badge for a canon node', () => {
    setup({ node: node({ isInCanonChain: true }) });
    expect(screen.getByText('Canon')).toBeInTheDocument();
  });
});

describe('NodeContextMenu — core actions each fire their handler + close', () => {
  it('Edit / Duplicate / Create Branch / Add After', async () => {
    const u = userEvent.setup();
    const h = setup();
    await u.click(screen.getByRole('button', { name: /Edit Scene/i }));
    await u.click(screen.getByRole('button', { name: /Duplicate/i }));
    await u.click(screen.getByRole('button', { name: /Create Branch/i }));
    await u.click(screen.getByRole('button', { name: /Add After/i }));
    expect(h.onEdit).toHaveBeenCalledWith('5');
    expect(h.onDuplicate).toHaveBeenCalledWith('blockchain-node-5');
    expect(h.onBranch).toHaveBeenCalledTimes(2); // Create Branch + Add After
    expect(h.onClose).toHaveBeenCalledTimes(4);
  });

  it('Delete fires onDelete(eventId)', async () => {
    const u = userEvent.setup();
    const h = setup();
    await u.click(screen.getByRole('button', { name: /Delete Node/i }));
    expect(h.onDelete).toHaveBeenCalledWith('5');
  });

  it('Play Video only shows for a node with a video', async () => {
    const u = userEvent.setup();
    const h = setup({ node: node({ videoUrl: 'https://v.mp4' }) });
    await u.click(screen.getByRole('button', { name: /Play Video/i }));
    expect(h.onPlay).toHaveBeenCalledWith('blockchain-node-5');
  });

  it('Play Video is absent without a video', () => {
    setup({ node: node({ videoUrl: undefined }) });
    expect(screen.queryByRole('button', { name: /Play Video/i })).not.toBeInTheDocument();
  });

  it('Escape closes the menu', async () => {
    const u = userEvent.setup();
    const h = setup();
    await u.keyboard('{Escape}');
    expect(h.onClose).toHaveBeenCalled();
  });
});

describe('NodeContextMenu — canon toggle label', () => {
  it('"Set as Canon" for a non-canon node', () => {
    setup();
    expect(screen.getByRole('button', { name: /Set as Canon/i })).toBeInTheDocument();
  });
  it('"Remove from Canon" for a canon node', () => {
    setup({ node: node({ isInCanonChain: true }) });
    expect(screen.getByRole('button', { name: /Remove from Canon/i })).toBeInTheDocument();
  });
});

describe('NodeContextMenu — swap section (on-chain only)', () => {
  it('is absent for a draft node (no blockchainNodeId)', () => {
    setup({ node: node({ id: 'draft-x', blockchainNodeId: undefined }) });
    expect(screen.queryByRole('button', { name: /Swap/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark for Swap/i })).not.toBeInTheDocument();
  });

  it('default state offers "Mark for Swap"', async () => {
    const u = userEvent.setup();
    const h = setup();
    await u.click(screen.getByRole('button', { name: /Mark for Swap/i }));
    expect(h.onMarkForSwap).toHaveBeenCalledWith('blockchain-node-5');
  });

  it('this node is the marked one → "Clear Swap Mark"', async () => {
    const u = userEvent.setup();
    const h = setup({ swapMarkNodeId: 'blockchain-node-5' });
    await u.click(screen.getByRole('button', { name: /Clear Swap Mark/i }));
    expect(h.onClearSwapMark).toHaveBeenCalledOnce();
  });

  it('another node is marked → "Swap with <label>", disabled while swapping', () => {
    const { rerender } = render(
      <NodeContextMenu
        {...({
          ...defaultProps(),
          swapMarkNodeId: 'blockchain-node-9',
          swapMarkLabel: 'Scene 9',
        } as any)}
      />
    );
    expect(screen.getByRole('button', { name: /Swap with Scene 9/i })).toBeEnabled();

    rerender(
      <NodeContextMenu
        {...({
          ...defaultProps(),
          swapMarkNodeId: 'blockchain-node-9',
          swapMarkLabel: 'Scene 9',
          isSwapping: true,
        } as any)}
      />
    );
    expect(screen.getByRole('button', { name: /Swapping/i })).toBeDisabled();
  });
});

describe('NodeContextMenu — arcs', () => {
  const arcs: ArcDefinition[] = [
    { id: 'a1', name: 'Prologue', color: '#f00', nodeIds: [] },
    { id: 'a2', name: 'Finale', color: '#0f0', nodeIds: ['blockchain-node-5'] },
  ];

  it('is absent with no arcs', () => {
    setup({ arcs: [] });
    expect(screen.queryByText(/Assign to Arc/i)).not.toBeInTheDocument();
  });

  it('lists arcs, marks the assigned one, and routes a click', async () => {
    const u = userEvent.setup();
    const h = setup({ arcs });
    expect(screen.getByText('assigned')).toBeInTheDocument(); // on Finale
    await u.click(screen.getByRole('button', { name: /Prologue/i }));
    expect(h.onAssignToArc).toHaveBeenCalledWith('a1', ['blockchain-node-5']);
  });
});

describe('NodeContextMenu — on-chain utilities', () => {
  it('"View On-Chain" only for a blockchain-node-* id; opens a new tab', async () => {
    const u = userEvent.setup();
    setup();
    await u.click(screen.getByRole('button', { name: /View On-Chain/i }));
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining('0xuni'), '_blank');
  });

  it('"View On-Chain" absent for an off-chain id', () => {
    setup({ node: node({ id: 'draft-x', blockchainNodeId: undefined }) });
    expect(screen.queryByRole('button', { name: /View On-Chain/i })).not.toBeInTheDocument();
  });

  it('"Copy Node ID" writes the blockchainNodeId to the clipboard', async () => {
    const u = userEvent.setup();
    // userEvent.setup() installs its own navigator.clipboard stub — override
    // it AFTER setup so the component writes to ours.
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    await u.click(screen.getByRole('button', { name: /Copy Node ID/i }));
    expect(writeText).toHaveBeenCalledWith('5');
  });
});
