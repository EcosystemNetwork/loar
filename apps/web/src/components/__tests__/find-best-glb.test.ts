import { describe, expect, it } from 'vitest';
import type { MediaAttachment } from '@/hooks/useMediaAttachments';
import { findBestGlb } from '../MediaGallery';

const glb = (id: string, label: string, subCategory: string | null): MediaAttachment =>
  ({
    id,
    label,
    subCategory,
    mimeType: 'model/gltf-binary',
    originalFilename: 'model.glb',
    category: '3d',
  }) as MediaAttachment;

describe('findBestGlb', () => {
  it('prefers the refined (textured) GLB over an untextured preview attached first', () => {
    const preview = glb('a', 'text preview — GLB', 'preview');
    const refined = glb('b', 'text refine — GLB', 'high_poly');
    expect(findBestGlb([preview, refined])?.id).toBe('b');
    expect(findBestGlb([refined, preview])?.id).toBe('b');
  });

  it('prefers a game_ready image-to-3D model over a preview', () => {
    const preview = glb('a', 'text preview — GLB', 'preview');
    const gameReady = glb('b', 'image to 3d — GLB', 'game_ready');
    expect(findBestGlb([preview, gameReady])?.id).toBe('b');
  });

  it('falls back to the preview when it is the only GLB', () => {
    const preview = glb('a', 'text preview — GLB', 'preview');
    expect(findBestGlb([preview])?.id).toBe('a');
  });

  it('returns null with no GLBs', () => {
    expect(findBestGlb([])).toBeNull();
  });
});
