import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClipInspector } from '../ClipInspector';
import type { EpisodeClip } from '../EpisodeClipTimeline';

const clip = (over: Partial<EpisodeClip> = {}): EpisodeClip => ({
  nodeId: 'a',
  label: 'Opening',
  videoUrl: 'https://v/a.mp4',
  trimStart: 0,
  trimEnd: 0,
  ...over,
});

afterEach(cleanup);

describe('ClipInspector', () => {
  it('shows the clip’s current levels', () => {
    render(
      <ClipInspector
        clips={[clip({ volume: 0.5, fadeIn: 1.5 })]}
        minLength={8}
        onPatch={() => {}}
      />
    );
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
    expect(screen.getByText('Opening')).toBeInTheDocument();
  });

  it('applies a slider change once, on release — not on every step of the drag', () => {
    const onPatch = vi.fn();
    render(<ClipInspector clips={[clip()]} minLength={8} onPatch={onPatch} />);
    const fade = screen.getByLabelText('Fade in');
    fireEvent.change(fade, { target: { value: '0.5' } });
    fireEvent.change(fade, { target: { value: '1.2' } });
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.pointerUp(fade);
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ fadeIn: 1.2 });
    // settling again with nothing new changed is a no-op
    fireEvent.blur(fade);
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it('caps fades at half the shortest selected clip', () => {
    render(<ClipInspector clips={[clip()]} minLength={3} onPatch={() => {}} />);
    expect(screen.getByLabelText('Fade in')).toHaveAttribute('max', '1.5');
    expect(screen.getByLabelText('Fade out')).toHaveAttribute('max', '1.5');
  });

  it('mutes and unmutes', () => {
    const onPatch = vi.fn();
    const { rerender } = render(<ClipInspector clips={[clip()]} minLength={8} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole('button', { name: /^Mute/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ volume: 0 });
    rerender(<ClipInspector clips={[clip({ volume: 0 })]} minLength={8} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole('button', { name: /Unmute/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ volume: 1 });
  });

  it('labels a multi-selection', () => {
    render(
      <ClipInspector clips={[clip(), clip({ nodeId: 'b' })]} minLength={8} onPatch={() => {}} />
    );
    expect(screen.getByText('2 clips')).toBeInTheDocument();
  });
});
