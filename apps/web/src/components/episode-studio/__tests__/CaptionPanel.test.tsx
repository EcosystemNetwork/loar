import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CaptionPanel } from '../CaptionPanel';
import { MAX_OVERLAYS, type TextOverlay } from '@/lib/episodeCut';

const ov = (over: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 'o1',
  text: 'Hello',
  start: 1,
  end: 4,
  position: 'bottom',
  size: 'md',
  ...over,
});

function setup(over: Partial<React.ComponentProps<typeof CaptionPanel>> = {}) {
  const props = {
    overlays: [ov()],
    selectedId: 'o1' as string | null,
    total: 10,
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onPatch: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  const utils = render(<CaptionPanel {...props} />);
  return { props, ...utils };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CaptionPanel', () => {
  it('explains how to add a caption when there are none', () => {
    setup({ overlays: [], selectedId: null });
    expect(screen.getByText(/No captions yet/)).toBeInTheDocument();
  });

  it('lists captions when none is selected, and selects on click', () => {
    const { props } = setup({ selectedId: null });
    fireEvent.click(screen.getByRole('button', { name: /Hello/ }));
    expect(props.onSelect).toHaveBeenCalledWith('o1');
  });

  it('adds a caption, unless the episode is empty or the cap is reached', () => {
    const { props, unmount } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Add caption/ }));
    expect(props.onAdd).toHaveBeenCalled();
    unmount();
    setup({ total: 0 });
    expect(screen.getByRole('button', { name: /Add caption/ })).toBeDisabled();
    cleanup();
    setup({
      overlays: Array.from({ length: MAX_OVERLAYS }, (_, i) => ov({ id: `o${i}` })),
      selectedId: null,
    });
    expect(screen.getByRole('button', { name: /Add caption/ })).toBeDisabled();
  });

  it('commits typed text once, shortly after typing stops', () => {
    const { props } = setup();
    const box = screen.getByLabelText('Text');
    fireEvent.change(box, { target: { value: 'Hel' } });
    fireEvent.change(box, { target: { value: 'Hello wor' } });
    fireEvent.change(box, { target: { value: 'Hello world' } });
    expect(props.onPatch).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(props.onPatch).toHaveBeenCalledTimes(1);
    expect(props.onPatch).toHaveBeenCalledWith('o1', { text: 'Hello world' });
  });

  it('commits immediately on blur and never saves blank text', () => {
    const { props } = setup();
    const box = screen.getByLabelText('Text');
    fireEvent.change(box, { target: { value: 'Bye' } });
    fireEvent.blur(box);
    expect(props.onPatch).toHaveBeenLastCalledWith('o1', { text: 'Bye' });
    vi.mocked(props.onPatch).mockClear();
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.blur(box);
    expect(props.onPatch).not.toHaveBeenCalled();
  });

  it('edits timing, position and size', () => {
    const { props } = setup();
    fireEvent.change(screen.getByLabelText('Start (s)'), { target: { value: '2.5' } });
    expect(props.onPatch).toHaveBeenLastCalledWith('o1', { start: 2.5 });
    fireEvent.change(screen.getByLabelText('End (s)'), { target: { value: '6' } });
    expect(props.onPatch).toHaveBeenLastCalledWith('o1', { end: 6 });
    fireEvent.click(screen.getByRole('radio', { name: 'top' }));
    expect(props.onPatch).toHaveBeenLastCalledWith('o1', { position: 'top' });
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
    expect(props.onPatch).toHaveBeenLastCalledWith('o1', { size: 'lg' });
    expect(screen.getByRole('radio', { name: 'bottom' })).toHaveAttribute('aria-checked', 'true');
  });

  it('ignores a half-typed number instead of patching NaN', () => {
    const { props } = setup();
    fireEvent.change(screen.getByLabelText('Start (s)'), { target: { value: '' } });
    expect(props.onPatch).not.toHaveBeenCalled();
  });

  it('deletes the selected caption', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(props.onDelete).toHaveBeenCalledWith('o1');
  });
});
