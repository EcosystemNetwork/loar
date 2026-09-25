import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VideoTimeline } from '../VideoTimeline';
import type { VideoSegment } from '@/types/segments';

// jsdom does no layout: give every element a 400px width so the px->ms scale is known.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 40,
    top: 0,
    left: 0,
    right: 400,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  // jsdom lacks pointer capture
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const seg = (over: Partial<VideoSegment> = {}): VideoSegment => ({
  id: 's1',
  videoUrl: 'https://cdn.example.com/a.mp4',
  description: 'Opening',
  prompt: 'p',
  duration: 8,
  order: 0,
  model: 'fal-veo3',
  generatedAt: 0,
  aspectRatio: '16:9',
  generationMode: 'text-to-video',
  ...over,
});

function setup(segments = [seg()], onSegmentTrim: any = vi.fn()) {
  render(
    <VideoTimeline
      segments={segments}
      onSegmentsReorder={() => {}}
      onSegmentTrim={onSegmentTrim}
      onSegmentDelete={() => {}}
      onAddSegment={() => {}}
      onPlaySegments={() => {}}
    />
  );
  return onSegmentTrim as ReturnType<typeof vi.fn>;
}

const drag = (handle: HTMLElement, fromX: number, toX: number) => {
  fireEvent.pointerDown(handle, { clientX: fromX, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: toX, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: toX, pointerId: 1 });
};

describe('VideoTimeline edge-handle trimming', () => {
  it('dragging the start handle right commits a trimmed start on release', () => {
    const onTrim = setup();
    drag(screen.getByRole('slider', { name: 'Trim start' }), 100, 150); // +50px @ 20ms/px
    expect(onTrim).toHaveBeenCalledTimes(1);
    expect(onTrim).toHaveBeenCalledWith('s1', 1000, 8000);
  });

  it('dragging the end handle left commits a trimmed end', () => {
    const onTrim = setup();
    drag(screen.getByRole('slider', { name: 'Trim end' }), 300, 200); // -100px
    expect(onTrim).toHaveBeenCalledWith('s1', 0, 6000);
  });

  it('respects an existing trim (starts from the stored values)', () => {
    const onTrim = setup([seg({ startTrim: 2000, endTrim: 6000 })]);
    // 4s visible in a 400px block => 10 ms/px; pull the end handle right 100px = +1000ms
    drag(screen.getByRole('slider', { name: 'Trim end' }), 300, 400);
    expect(onTrim).toHaveBeenCalledWith('s1', 2000, 7000);
  });

  it('shows the live trimmed length while dragging, and clears it after', () => {
    setup();
    const handle = screen.getByRole('slider', { name: 'Trim end' });
    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    expect(screen.getByText('6.00s')).toBeTruthy();
    fireEvent.pointerUp(handle, { clientX: 200, pointerId: 1 });
    expect(screen.queryByText('6.00s')).toBeNull();
  });

  it('a click without movement commits nothing', () => {
    const onTrim = setup();
    drag(screen.getByRole('slider', { name: 'Trim start' }), 100, 100);
    expect(onTrim).not.toHaveBeenCalled();
  });

  it('a cancelled drag (e.g. pointercancel) commits nothing', () => {
    const onTrim = setup();
    const h = screen.getByRole('slider', { name: 'Trim start' });
    fireEvent.pointerDown(h, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 200, pointerId: 1 });
    fireEvent.pointerCancel(h, { clientX: 200, pointerId: 1 });
    expect(onTrim).not.toHaveBeenCalled();
  });

  it('handles are inert when no onSegmentTrim is provided', () => {
    render(
      <VideoTimeline
        segments={[seg()]}
        onSegmentsReorder={() => {}}
        onSegmentDelete={() => {}}
        onAddSegment={() => {}}
        onPlaySegments={() => {}}
      />
    );
    const h = screen.getByRole('slider', { name: 'Trim start' });
    expect(() => drag(h, 100, 200)).not.toThrow();
    expect(h.className).toContain('pointer-events-none');
  });

  it('cannot trim a segment below the minimum length', () => {
    const onTrim = setup();
    drag(screen.getByRole('slider', { name: 'Trim start' }), 0, 100_000);
    const [, start, end] = onTrim.mock.calls[0];
    expect(end - start).toBe(250);
  });
});
