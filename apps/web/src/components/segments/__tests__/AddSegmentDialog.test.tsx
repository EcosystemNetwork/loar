import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Only the network / billing boundary is replaced; the dialog itself is real.
const imageToImage = vi.fn();
vi.mock('@/utils/trpc', () => ({
  trpcClient: { image: { imageToImage: { mutate: (...a: unknown[]) => imageToImage(...a) } } },
}));
const checkCredits = vi.fn(() => true);
vi.mock('@/hooks/useCreditCheck', () => ({
  useCreditCheck: () => ({
    checkCredits,
    checkGenerationEnabled: () => true,
    invalidateBalance: vi.fn(),
  }),
}));

import { AddSegmentDialog } from '../AddSegmentDialog';

const characters = [
  { id: 'c1', character_name: 'Mara', image_url: 'https://cdn.example.com/mara.png' },
  { id: 'c2', character_name: 'Kest', image_url: 'https://cdn.example.com/kest.png' },
  { id: 'c3', character_name: 'Ghost', image_url: '' },
];

function setup(chars = characters) {
  const onGenerate = vi.fn().mockResolvedValue(undefined);
  render(
    <AddSegmentDialog
      isOpen
      onClose={() => {}}
      onGenerate={onGenerate}
      isGenerating={false}
      characters={chars}
    />
  );
  return { onGenerate };
}

const generateSegmentButton = () => screen.getByRole('button', { name: /generate segment/i });

describe('AddSegmentDialog image-to-video', () => {
  beforeEach(() => {
    imageToImage.mockReset();
    checkCredits.mockClear();
  });

  it('no longer shows the "coming soon" stub and lists characters', () => {
    setup();
    fireEvent.click(screen.getByText('Image-to-Video'));
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.getByRole('button', { name: /mara/i })).toBeTruthy();
    // A character without an image can't be used as a reference.
    expect((screen.getByRole('button', { name: /ghost/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('keeps Generate Segment disabled until a frame exists', () => {
    setup();
    fireEvent.click(screen.getByText('Image-to-Video'));
    fireEvent.change(screen.getByLabelText(/scene & action prompt/i), {
      target: { value: 'walks through a market' },
    });
    expect((generateSegmentButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('generates a frame from the selected characters, then animates it', async () => {
    imageToImage.mockResolvedValue({
      status: 'completed',
      imageUrl: 'https://cdn.example.com/frame.png',
    });
    const { onGenerate } = setup();
    fireEvent.click(screen.getByText('Image-to-Video'));

    fireEvent.click(screen.getByRole('button', { name: /mara/i }));
    fireEvent.click(screen.getByRole('button', { name: /kest/i }));
    fireEvent.change(screen.getByLabelText(/scene & action prompt/i), {
      target: { value: 'walk through a market' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^generate frame$/i }));

    await waitFor(() => expect(screen.getByAltText(/generated starting frame/i)).toBeTruthy());
    const args = imageToImage.mock.calls[0][0];
    expect(args.imageUrls).toEqual([
      'https://cdn.example.com/mara.png',
      'https://cdn.example.com/kest.png',
    ]);
    expect(args.imageSize).toBe('landscape_16_9');
    expect(args.prompt).toContain('Mara and Kest walk through a market');

    fireEvent.click(generateSegmentButton());
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0][0]).toMatchObject({
      mode: 'image-to-video',
      imageUrl: 'https://cdn.example.com/frame.png',
      characterIds: ['c1', 'c2'],
      characterNames: ['Mara', 'Kest'],
    });
  });

  it('surfaces a frame-generation failure and stays blocked', async () => {
    imageToImage.mockRejectedValue(new Error('quota exceeded'));
    setup();
    fireEvent.click(screen.getByText('Image-to-Video'));
    fireEvent.click(screen.getByRole('button', { name: /mara/i }));
    fireEvent.change(screen.getByLabelText(/scene & action prompt/i), {
      target: { value: 'stands in rain' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^generate frame$/i }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('quota exceeded'));
    expect((generateSegmentButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps at most two characters selected, dropping the oldest', () => {
    setup([
      ...characters,
      { id: 'c4', character_name: 'Vex', image_url: 'https://cdn.example.com/vex.png' },
    ]);
    fireEvent.click(screen.getByText('Image-to-Video'));
    for (const n of [/mara/i, /kest/i, /vex/i])
      fireEvent.click(screen.getByRole('button', { name: n }));
    const pressed = (n: RegExp) =>
      screen.getByRole('button', { name: n }).getAttribute('aria-pressed');
    expect(pressed(/mara/i)).toBe('false');
    expect(pressed(/kest/i)).toBe('true');
    expect(pressed(/vex/i)).toBe('true');
  });
});
