/**
 * Component tests for TimelineEventNode — the ReactFlow node rendered for every
 * scene / draft / pending / "add" placeholder on the universe editor canvas.
 *
 * ReactFlow's <Handle> needs a store provider, so it is stubbed to a marker
 * element. The IPFS resolver is mocked so each test controls when (and whether)
 * the video URL resolves. jsdom doesn't implement HTMLMediaElement playback, so
 * play/pause/load are spied on the prototype.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('reactflow', () => ({
  Handle: ({ type }: { type: string }) => <span data-testid={`handle-${type}`} />,
  Position: { Left: 'left', Right: 'right' },
}));

const resolveMock = vi.fn<(url: string) => Promise<string>>();
vi.mock('@/utils/ipfs-url', () => ({
  resolveIpfsUrlAsync: (url: string) => resolveMock(url),
}));

import { TimelineEventNode, type TimelineNodeData } from '../TimelineNodes';

function data(over: Partial<TimelineNodeData> = {}): TimelineNodeData {
  return { label: 'Scene 5', description: '', nodeType: 'scene', eventId: '5', ...over };
}

// The node component reads only `data`, but ReactFlow's NodeProps has more.
function renderNode(over: Partial<TimelineNodeData> = {}) {
  const props = { data: data(over) } as React.ComponentProps<typeof TimelineEventNode>;
  return render(<TimelineEventNode {...props} />);
}

/** Render with a video and wait for the async gateway resolve to land. */
async function renderWithVideo(
  over: Partial<TimelineNodeData> = {},
  resolved = 'https://gw/v.mp4'
) {
  resolveMock.mockResolvedValue(resolved);
  const utils = renderNode({ videoUrl: 'ipfs://cid', ...over });
  await act(async () => {});
  return utils;
}

const card = (c: HTMLElement) => c.querySelector('.w-80') as HTMLElement;
const video = (c: HTMLElement) => c.querySelector('video') as HTMLVideoElement | null;

let playSpy: ReturnType<typeof vi.spyOn>;
let pauseSpy: ReturnType<typeof vi.spyOn>;
let loadSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resolveMock.mockReset();
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TimelineEventNode — "add" placeholder', () => {
  it('renders only a + button and both handles, no event card', () => {
    const { container } = renderNode({ nodeType: 'add' });
    expect(screen.getByTitle('Add new event')).toBeInTheDocument();
    expect(screen.getByTestId('handle-target')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source')).toBeInTheDocument();
    expect(card(container)).toBeNull();
    expect(screen.queryByText('Add Video')).toBeNull();
  });

  it('click calls onAddScene("after", eventId) and does not bubble to ReactFlow', async () => {
    const onAddScene = vi.fn();
    const bubbled = vi.fn();
    render(
      <div onClick={bubbled}>
        <TimelineEventNode
          {...({
            data: data({ nodeType: 'add', eventId: '9', onAddScene }),
          } as React.ComponentProps<typeof TimelineEventNode>)}
        />
      </div>
    );
    await userEvent.click(screen.getByTitle('Add new event'));
    expect(onAddScene).toHaveBeenCalledExactlyOnceWith('after', '9');
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('does not throw when onAddScene is missing', async () => {
    renderNode({ nodeType: 'add', onAddScene: undefined });
    await userEvent.click(screen.getByTitle('Add new event'));
  });

  it('never renders a <video>, even if a videoUrl leaked into its data', async () => {
    resolveMock.mockResolvedValue('https://gw/v.mp4');
    const { container } = renderNode({ nodeType: 'add', videoUrl: 'ipfs://x' });
    await act(async () => {});
    expect(video(container)).toBeNull();
  });
});

describe('TimelineEventNode — labels', () => {
  it('shows displayName when provided', () => {
    renderNode({ displayName: 'The Heist' });
    expect(screen.getByText('The Heist')).toBeInTheDocument();
    expect(screen.queryByText('Event 5')).toBeNull();
  });

  it('falls back to "Event <eventId>"', () => {
    renderNode();
    expect(screen.getByText('Event 5')).toBeInTheDocument();
  });

  it('falls back to "Event ?" when there is no eventId', () => {
    renderNode({ eventId: undefined });
    expect(screen.getByText('Event ?')).toBeInTheDocument();
  });

  it('shows the label both in the video overlay and the footer when a video is loaded', async () => {
    await renderWithVideo({ displayName: 'The Heist' });
    expect(screen.getAllByText('The Heist')).toHaveLength(2);
  });
});

describe('TimelineEventNode — empty ("Add Video") state', () => {
  it('shows the Add Video prompt and no <video> when there is no videoUrl', () => {
    const { container } = renderNode();
    expect(screen.getByText('Add Video')).toBeInTheDocument();
    expect(video(container)).toBeNull();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('clicking the prompt opens the editor for that event without bubbling', async () => {
    const onEditScene = vi.fn();
    const bubbled = vi.fn();
    render(
      <div onClick={bubbled}>
        <TimelineEventNode
          {...({ data: data({ onEditScene }) } as React.ComponentProps<typeof TimelineEventNode>)}
        />
      </div>
    );
    await userEvent.click(screen.getByText('Add Video'));
    expect(onEditScene).toHaveBeenCalledExactlyOnceWith('5');
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('passes "" when the node has no eventId', async () => {
    const onEditScene = vi.fn();
    renderNode({ eventId: undefined, onEditScene });
    await userEvent.click(screen.getByText('Add Video'));
    expect(onEditScene).toHaveBeenCalledWith('');
  });
});

describe('TimelineEventNode — pending generation placeholder', () => {
  it('shows "Generating…" with the prompt instead of Add Video', () => {
    renderNode({ isPending: true, pendingPrompt: 'a rainy alley' });
    expect(screen.getByText('Generating…')).toBeInTheDocument();
    expect(screen.getByText('a rainy alley')).toBeInTheDocument();
    expect(screen.queryByText('Add Video')).toBeNull();
  });

  it('omits the prompt line when none was captured', () => {
    renderNode({ isPending: true });
    expect(screen.getByText('Generating…')).toBeInTheDocument();
    expect(screen.queryByText('a rainy alley')).toBeNull();
  });

  it('hides every action button (nothing to edit / branch / delete yet)', () => {
    renderNode({
      isPending: true,
      onDeleteNode: vi.fn(),
      onAddScene: vi.fn(),
      onEditScene: vi.fn(),
    });
    expect(screen.queryByTitle('Delete node')).toBeNull();
    expect(screen.queryByTitle('Create branch event')).toBeNull();
    expect(screen.queryByTitle('Change video')).toBeNull();
  });
});

describe('TimelineEventNode — video resolution', () => {
  it('shows a loading overlay until the URL resolves, then mounts <video> with the resolved source', async () => {
    let resolve!: (u: string) => void;
    resolveMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = renderNode({ videoUrl: 'ipfs://cid' });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(video(container)).toBeNull();
    expect(resolveMock).toHaveBeenCalledWith('ipfs://cid');

    await act(async () => resolve('https://media.loar.fun/cid.mp4'));
    expect(screen.queryByText('Loading…')).toBeNull();
    const sources = [...video(container)!.querySelectorAll('source')];
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.getAttribute('src') === 'https://media.loar.fun/cid.mp4')).toBe(
      true
    );
  });

  it('nudges the <video> to reload once the resolved URL lands', async () => {
    await renderWithVideo();
    expect(loadSpy).toHaveBeenCalled();
  });

  it('renders the video muted, looping, unmuted-controls off, metadata preload', async () => {
    const { container } = await renderWithVideo();
    const v = video(container)!;
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(true);
    expect(v.controls).toBe(false);
    expect(v.getAttribute('preload')).toBe('metadata');
  });

  it('falls back to the raw videoUrl when the resolver resolves empty', async () => {
    const { container } = await renderWithVideo({ videoUrl: 'https://fb/x.mp4' }, '');
    expect(video(container)!.querySelector('source')!.getAttribute('src')).toBe('https://fb/x.mp4');
  });

  it('falls back to the raw videoUrl when the resolver rejects', async () => {
    resolveMock.mockRejectedValue(new Error('boom'));
    const { container } = renderNode({ videoUrl: 'https://fb/x.mp4' });
    await act(async () => {});
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(video(container)!.querySelector('source')!.getAttribute('src')).toBe('https://fb/x.mp4');
  });

  it('ignores a resolve that lands after the node unmounted', async () => {
    let resolve!: (u: string) => void;
    resolveMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = renderNode({ videoUrl: 'ipfs://cid' });
    unmount();
    // Would throw / warn on a set-state after unmount if the cancel flag failed.
    await act(async () => resolve('https://gw/late.mp4'));
  });

  it('drops the stale resolve when videoUrl changes mid-flight', async () => {
    const resolvers: Array<(u: string) => void> = [];
    resolveMock.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    const props = (url: string) =>
      ({ data: data({ videoUrl: url }) }) as React.ComponentProps<typeof TimelineEventNode>;
    const { container, rerender } = render(<TimelineEventNode {...props('ipfs://old')} />);
    rerender(<TimelineEventNode {...props('ipfs://new')} />);
    expect(resolvers).toHaveLength(2);

    await act(async () => resolvers[0]('https://gw/old.mp4')); // stale — must be ignored
    expect(video(container)).toBeNull();

    await act(async () => resolvers[1]('https://gw/new.mp4'));
    expect(video(container)!.querySelector('source')!.getAttribute('src')).toBe(
      'https://gw/new.mp4'
    );
  });

  it('clearing videoUrl drops the <video> and returns to the Add Video state', async () => {
    resolveMock.mockResolvedValue('https://gw/v.mp4');
    const props = (url?: string) =>
      ({ data: data({ videoUrl: url }) }) as React.ComponentProps<typeof TimelineEventNode>;
    const { container, rerender } = render(<TimelineEventNode {...props('ipfs://cid')} />);
    await act(async () => {});
    expect(video(container)).not.toBeNull();

    rerender(<TimelineEventNode {...props(undefined)} />);
    expect(video(container)).toBeNull();
    expect(screen.getByText('Add Video')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('a <video> load error swaps to the Add Video state so the node is never a black box', async () => {
    const { container } = await renderWithVideo();
    fireEvent.error(video(container)!);
    expect(video(container)).toBeNull();
    expect(screen.getByText('Add Video')).toBeInTheDocument();
  });

  it('a new videoUrl clears a previous load error', async () => {
    resolveMock.mockResolvedValue('https://gw/v.mp4');
    const props = (url: string) =>
      ({ data: data({ videoUrl: url }) }) as React.ComponentProps<typeof TimelineEventNode>;
    const { container, rerender } = render(<TimelineEventNode {...props('ipfs://a')} />);
    await act(async () => {});
    fireEvent.error(video(container)!);
    expect(video(container)).toBeNull();

    rerender(<TimelineEventNode {...props('ipfs://b')} />);
    await act(async () => {});
    expect(video(container)).not.toBeNull();
  });

  it('clicking the <video> itself does not bubble', async () => {
    const bubbled = vi.fn();
    resolveMock.mockResolvedValue('https://gw/v.mp4');
    const { container } = render(
      <div onClick={bubbled}>
        <TimelineEventNode
          {...({ data: data({ videoUrl: 'ipfs://cid' }) } as React.ComponentProps<
            typeof TimelineEventNode
          >)}
        />
      </div>
    );
    await act(async () => {});
    await userEvent.click(video(container)!);
    expect(bubbled).not.toHaveBeenCalled();
  });
});

describe('TimelineEventNode — hover preview', () => {
  it('plays on mouse enter from the start and pauses + rewinds on leave', async () => {
    const { container } = await renderWithVideo();
    const v = video(container)!;
    playSpy.mockClear();
    pauseSpy.mockClear();

    fireEvent.mouseEnter(card(container));
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(v.currentTime).toBe(0);

    v.currentTime = 3;
    fireEvent.mouseLeave(card(container));
    expect(pauseSpy).toHaveBeenCalled();
    expect(v.currentTime).toBe(0);
  });

  it('starts the preview at the trim in-point', async () => {
    const { container } = await renderWithVideo({ trimStart: 2500 });
    fireEvent.mouseEnter(card(container));
    expect(video(container)!.currentTime).toBe(2.5);
    expect(playSpy).toHaveBeenCalled();
  });

  it('swallows a rejected play() (browser autoplay policy)', async () => {
    const { container } = await renderWithVideo();
    playSpy.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    fireEvent.mouseEnter(card(container));
    await act(async () => {}); // an unhandled rejection would fail the run
  });

  it('does not throw when hovering a node that has no video', () => {
    const { container } = renderNode();
    fireEvent.mouseEnter(card(container));
    fireEvent.mouseLeave(card(container));
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('loops back to the trim in-point once playback passes the out-point', async () => {
    const { container } = await renderWithVideo({ trimStart: 1000, trimEnd: 4000 });
    const v = video(container)!;

    v.currentTime = 2;
    fireEvent(v, new Event('timeupdate'));
    expect(v.currentTime).toBe(2); // still inside the trimmed range

    v.currentTime = 4;
    fireEvent(v, new Event('timeupdate'));
    expect(v.currentTime).toBe(1); // wrapped to trimStart
  });

  it('defaults the loop-back point to 0 when only trimEnd is set', async () => {
    const { container } = await renderWithVideo({ trimEnd: 3000 });
    const v = video(container)!;
    v.currentTime = 3.5;
    fireEvent(v, new Event('timeupdate'));
    expect(v.currentTime).toBe(0);
  });

  it('does not clamp playback when there is no trimEnd', async () => {
    const { container } = await renderWithVideo({ trimStart: 1000 });
    const v = video(container)!;
    v.currentTime = 99;
    fireEvent(v, new Event('timeupdate'));
    expect(v.currentTime).toBe(99);
  });

  it('removes its timeupdate listener on unmount', async () => {
    const { container, unmount } = await renderWithVideo({ trimEnd: 3000 });
    const v = video(container)!;
    const removeSpy = vi.spyOn(v, 'removeEventListener');
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('timeupdate', expect.any(Function));
  });
});

describe('TimelineEventNode — hover overlay actions', () => {
  it('clicking the overlay opens the editor', async () => {
    const onEditScene = vi.fn();
    await renderWithVideo({ onEditScene });
    await userEvent.click(screen.getByText('Edit'));
    expect(onEditScene).toHaveBeenCalledExactlyOnceWith('5');
  });

  it('shows Regenerate only when onRegenerateScene is provided', async () => {
    const { unmount } = await renderWithVideo();
    expect(screen.queryByText('Regenerate')).toBeNull();
    unmount();

    await renderWithVideo({ onRegenerateScene: vi.fn() });
    expect(screen.getByText('Regenerate')).toBeInTheDocument();
  });

  it('Regenerate fires onRegenerateScene only — it must not also open the editor', async () => {
    const onEditScene = vi.fn();
    const onRegenerateScene = vi.fn();
    await renderWithVideo({ onEditScene, onRegenerateScene });
    await userEvent.click(screen.getByText('Regenerate'));
    expect(onRegenerateScene).toHaveBeenCalledExactlyOnceWith('5');
    expect(onEditScene).not.toHaveBeenCalled();
  });

  it('relabels to "Generating..." and spins while a regeneration is running', async () => {
    const { container } = await renderWithVideo({
      onRegenerateScene: vi.fn(),
      isRegenerating: true,
    });
    expect(screen.getByText('Generating...')).toBeInTheDocument();
    expect(screen.queryByText('Regenerate')).toBeNull();
    expect(container.querySelector('.animate-spin.bg-white\\/90')).not.toBeNull();
  });
});

describe('TimelineEventNode — footer + bottom actions', () => {
  it('"Change video" opens the editor without bubbling', async () => {
    const onEditScene = vi.fn();
    const bubbled = vi.fn();
    render(
      <div onClick={bubbled}>
        <TimelineEventNode
          {...({ data: data({ onEditScene }) } as React.ComponentProps<typeof TimelineEventNode>)}
        />
      </div>
    );
    await userEvent.click(screen.getByTitle('Change video'));
    expect(onEditScene).toHaveBeenCalledExactlyOnceWith('5');
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('"Create branch event" branches off this node', async () => {
    const onAddScene = vi.fn();
    renderNode({ onAddScene });
    await userEvent.click(screen.getByTitle('Create branch event'));
    expect(onAddScene).toHaveBeenCalledExactlyOnceWith('branch', '5');
  });

  it('shows Delete only when onDeleteNode is provided, and calls it with the eventId', async () => {
    const { unmount } = renderNode();
    expect(screen.queryByTitle('Delete node')).toBeNull();
    unmount();

    const onDeleteNode = vi.fn();
    const bubbled = vi.fn();
    render(
      <div onClick={bubbled}>
        <TimelineEventNode
          {...({ data: data({ onDeleteNode }) } as React.ComponentProps<typeof TimelineEventNode>)}
        />
      </div>
    );
    await userEvent.click(screen.getByTitle('Delete node'));
    expect(onDeleteNode).toHaveBeenCalledExactlyOnceWith('5');
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('branch / delete / change-video all tolerate missing callbacks', async () => {
    renderNode();
    await userEvent.click(screen.getByTitle('Create branch event'));
    await userEvent.click(screen.getByTitle('Change video'));
  });

  it('renders both handles on a regular node', () => {
    renderNode();
    expect(screen.getByTestId('handle-target')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source')).toBeInTheDocument();
  });
});

describe('TimelineEventNode — status badges', () => {
  it('root nodes get a Start badge and highlight ring', () => {
    const { container } = renderNode({ isRoot: true });
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(card(container)).toHaveClass('ring-primary/50');
  });

  it('non-root nodes have neither', () => {
    const { container } = renderNode();
    expect(screen.queryByText('Start')).toBeNull();
    expect(card(container)).not.toHaveClass('ring-primary/50');
  });

  it('shows "N branches" only above one child', () => {
    const { unmount } = renderNode({ childCount: 1 });
    expect(screen.queryByText(/branches/)).toBeNull();
    unmount();
    renderNode({ childCount: 3 });
    expect(screen.getByText('3 branches')).toBeInTheDocument();
  });

  it('Canon / Unsaved / clips badges render over the video', async () => {
    await renderWithVideo({ isInCanonChain: true, isDraft: true, segmentCount: 4 });
    expect(screen.getByText('Canon')).toBeInTheDocument();
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    expect(screen.getByText('4 clips')).toBeInTheDocument();
  });

  it('a single segment is not worth a "clips" badge', async () => {
    await renderWithVideo({ segmentCount: 1 });
    expect(screen.queryByText(/clips/)).toBeNull();
  });

  it('no badges by default', async () => {
    await renderWithVideo();
    for (const t of ['Canon', 'Unsaved']) expect(screen.queryByText(t)).toBeNull();
    expect(screen.queryByTitle('Clip is trimmed')).toBeNull();
  });

  it('badges live on the video overlay — hidden until a video loads', () => {
    renderNode({ isInCanonChain: true, isDraft: true });
    expect(screen.queryByText('Canon')).toBeNull();
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  describe('trim indicator', () => {
    it.each([
      ['trimStart > 0', { trimStart: 500 }],
      ['trimEnd set', { trimEnd: 4000 }],
      ['trimEnd of 0', { trimEnd: 0 }],
    ])('shows for %s', async (_n, over) => {
      await renderWithVideo(over);
      expect(screen.getByTitle('Clip is trimmed')).toBeInTheDocument();
    });

    it('hidden for trimStart 0 with no trimEnd', async () => {
      await renderWithVideo({ trimStart: 0 });
      expect(screen.queryByTitle('Clip is trimmed')).toBeNull();
    });
  });

  describe('scene control indicators', () => {
    it('camera preset', async () => {
      await renderWithVideo({ sceneControls: { cameraPreset: 'dolly_in_slow' } });
      expect(screen.getByTitle('Camera: dolly_in_slow')).toBeInTheDocument();
    });

    it('cast members show a count, and none when empty', async () => {
      const { unmount } = await renderWithVideo({
        sceneControls: { castMemberIds: ['a', 'b'] },
      });
      expect(screen.getByTitle('2 cast')).toBeInTheDocument();
      unmount();
      await renderWithVideo({ sceneControls: { castMemberIds: [] } });
      expect(screen.queryByTitle(/cast/)).toBeNull();
    });

    it('vfx presets show a count, and none when empty', async () => {
      const { unmount } = await renderWithVideo({
        sceneControls: { vfxPresets: ['glitch', 'vignette', 'film_grain'] },
      });
      expect(screen.getByTitle('3 VFX')).toBeInTheDocument();
      unmount();
      await renderWithVideo({ sceneControls: { vfxPresets: [] } });
      expect(screen.queryByTitle(/VFX/)).toBeNull();
    });

    it('keyframe link', async () => {
      await renderWithVideo({ sceneControls: { startFrameFrom: 'node-3' } });
      expect(screen.getByTitle('Keyframe linked')).toBeInTheDocument();
    });

    it('a null camera preset shows nothing', async () => {
      await renderWithVideo({ sceneControls: { cameraPreset: null } });
      expect(screen.queryByTitle(/^Camera:/)).toBeNull();
    });
  });

  describe('style bar', () => {
    const bar = (c: HTMLElement) => c.querySelector('[title^="Style:"]') as HTMLElement | null;

    it('uses the preset colour', async () => {
      const { container } = await renderWithVideo({ sceneControls: { stylePreset: 'noir' } });
      expect(bar(container)).toHaveStyle({ backgroundColor: '#1a1a2e' });
      expect(bar(container)).toHaveAttribute('title', 'Style: noir');
    });

    it('falls back to the inherited preset and names its source node', async () => {
      const { container } = await renderWithVideo({
        sceneControls: { inheritedStylePreset: 'anime', inheritedStyleSource: '2' },
      });
      expect(bar(container)).toHaveStyle({ backgroundColor: '#c44dff' });
      expect(bar(container)).toHaveAttribute('title', 'Style: anime (inherited from node 2)');
    });

    it("the node's own preset wins over an inherited one", async () => {
      const { container } = await renderWithVideo({
        sceneControls: { stylePreset: 'horror', inheritedStylePreset: 'anime' },
      });
      expect(bar(container)).toHaveStyle({ backgroundColor: '#2d0a0a' });
    });

    it('unknown presets get the neutral grey', async () => {
      const { container } = await renderWithVideo({
        sceneControls: { stylePreset: 'not_a_preset' as never },
      });
      expect(bar(container)).toHaveStyle({ backgroundColor: '#666' });
    });

    it('is absent with no style at all', async () => {
      const { container } = await renderWithVideo({ sceneControls: {} });
      expect(bar(container)).toBeNull();
    });
  });
});

describe('TimelineEventNode — version picker', () => {
  const versions = [
    { videoUrl: 'a', versionNumber: 1, generatedAt: 1 },
    { videoUrl: 'b', versionNumber: 2, generatedAt: 2 },
  ]; // + the live one → 3 total

  async function picker(over: Partial<TimelineNodeData>) {
    const onSwitchVersion = vi.fn();
    const utils = await renderWithVideo({ videoVersions: versions, onSwitchVersion, ...over });
    // The picker is the only element containing the "/ N" total.
    const root = screen.getByText(/^\/ \d+$/).parentElement as HTMLElement;
    const [prev, next] = within(root).getAllByRole('button');
    return { ...utils, onSwitchVersion, root, prev, next };
  }

  it('is hidden when there are no historical versions', async () => {
    await renderWithVideo({ videoVersions: [] });
    expect(screen.queryByText(/^\/ \d+$/)).toBeNull();
  });

  it('defaults to the latest version: "v3 / 3", next disabled', async () => {
    const { root, next, prev } = await picker({});
    expect(root).toHaveTextContent('v3');
    expect(root).toHaveTextContent('/ 3');
    expect(next).toBeDisabled();
    expect(prev).toBeEnabled();
  });

  it('treats an explicit -1 as latest', async () => {
    const { root } = await picker({ currentVersionIndex: -1 });
    expect(root).toHaveTextContent('v3');
  });

  it('prev from latest steps to the newest historical version (index 1)', async () => {
    const { prev, onSwitchVersion } = await picker({});
    await userEvent.click(prev);
    expect(onSwitchVersion).toHaveBeenCalledExactlyOnceWith('5', 1);
  });

  it('prev from index 1 steps to 0', async () => {
    const { prev, onSwitchVersion } = await picker({ currentVersionIndex: 1 });
    await userEvent.click(prev);
    expect(onSwitchVersion).toHaveBeenCalledExactlyOnceWith('5', 0);
  });

  it('shows the 1-based label for a historical index', async () => {
    const { root } = await picker({ currentVersionIndex: 1 });
    expect(root).toHaveTextContent('v2');
  });

  it('prev is disabled at the oldest version', async () => {
    const { prev, next } = await picker({ currentVersionIndex: 0 });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();
  });

  it('next from the oldest steps to index 1', async () => {
    const { next, onSwitchVersion } = await picker({ currentVersionIndex: 0 });
    await userEvent.click(next);
    expect(onSwitchVersion).toHaveBeenCalledExactlyOnceWith('5', 1);
  });

  it('next onto the newest historical index resolves to -1 ("latest")', async () => {
    const { next, onSwitchVersion } = await picker({ currentVersionIndex: 1 });
    await userEvent.click(next);
    expect(onSwitchVersion).toHaveBeenCalledExactlyOnceWith('5', -1);
  });

  it('clicks inside the picker never bubble to the node', async () => {
    const bubbled = vi.fn();
    resolveMock.mockResolvedValue('https://gw/v.mp4');
    render(
      <div onClick={bubbled}>
        <TimelineEventNode
          {...({
            data: data({ videoUrl: 'ipfs://cid', videoVersions: versions }),
          } as React.ComponentProps<typeof TimelineEventNode>)}
        />
      </div>
    );
    await act(async () => {});
    const root = screen.getByText(/^\/ \d+$/).parentElement as HTMLElement;
    await userEvent.click(within(root).getAllByRole('button')[0]);
    await userEvent.click(root);
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('tolerates a missing onSwitchVersion', async () => {
    await renderWithVideo({ videoVersions: versions });
    const root = screen.getByText(/^\/ \d+$/).parentElement as HTMLElement;
    await userEvent.click(within(root).getAllByRole('button')[0]);
  });
});

describe('TimelineEventNode — selection + dimming', () => {
  it('no checkbox / ring when isSelected is undefined (selection mode off)', () => {
    const { container } = renderNode();
    expect(container.querySelector('.-top-2.-left-2')).toBeNull();
    expect(container.querySelector('.border-blue-500')).toBeNull();
  });

  it('unselected in selection mode: hover-only empty checkbox, no ring', () => {
    const { container } = renderNode({ isSelected: false });
    const box = container.querySelector('.-top-2.-left-2') as HTMLElement;
    expect(box).toHaveClass('opacity-0');
    expect(box.querySelector('svg')).toBeNull();
    expect(container.querySelector('.-inset-1')).toBeNull();
  });

  it('selected: ring, blue border, always-visible checked checkbox', () => {
    const { container } = renderNode({ isSelected: true, timelineColor: '#ff0000' });
    const box = container.querySelector('.-top-2.-left-2') as HTMLElement;
    expect(box).toHaveClass('opacity-100');
    expect(box.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.-inset-1')).not.toBeNull();
    expect(card(container)).toHaveStyle({ borderColor: '#3b82f6' });
  });

  it('border uses the timeline colour when unselected, emerald by default', () => {
    const { container, unmount } = renderNode({ timelineColor: '#ff0000' });
    expect(card(container)).toHaveStyle({ borderColor: '#ff0000' });
    unmount();
    const second = renderNode();
    expect(card(second.container)).toHaveStyle({ borderColor: '#10b981' });
  });

  it('the footer dot uses the timeline colour', () => {
    const { container } = renderNode({ timelineColor: '#123456' });
    const dot = container.querySelector('.rounded-full.w-3.h-3') as HTMLElement;
    expect(dot).toHaveStyle({ backgroundColor: '#123456' });
  });

  it('dimmed nodes fade out and stop taking pointer events', () => {
    const { container } = renderNode({ dimmed: true });
    const wrapper = container.querySelector('.group') as HTMLElement;
    expect(wrapper).toHaveClass('opacity-30', 'pointer-events-none');
  });

  it('non-dimmed nodes do not', () => {
    const { container } = renderNode({ dimmed: false });
    const wrapper = container.querySelector('.group') as HTMLElement;
    expect(wrapper).not.toHaveClass('opacity-30');
  });
});
