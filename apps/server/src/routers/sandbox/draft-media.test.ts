import { describe, it, expect } from 'vitest';
import { resolveDraftMedia } from './draft-media';

describe('resolveDraftMedia', () => {
  it('prefers the 3D model over a turntable video and thumbnail', () => {
    expect(
      resolveDraftMedia({
        modelUrl: 'https://x/m.glb',
        videoUrl: 'https://x/t.mp4',
        imageUrl: 'https://x/t.png',
      })
    ).toEqual({ mediaUrl: 'https://x/m.glb', mediaType: 'ai-3d', thumbnailUrl: 'https://x/t.png' });
  });
  it('uses the audio url for audio drafts (no image)', () => {
    expect(resolveDraftMedia({ audioUrl: 'https://x/a.mp3' })).toEqual({
      mediaUrl: 'https://x/a.mp3',
      mediaType: 'ai-audio',
      thumbnailUrl: null,
    });
  });
  it('video beats image; image is the fallback', () => {
    expect(resolveDraftMedia({ videoUrl: 'v', imageUrl: 'i' }).mediaType).toBe('ai-video');
    expect(resolveDraftMedia({ imageUrl: 'i' })).toMatchObject({
      mediaUrl: 'i',
      mediaType: 'ai-image',
    });
  });
  it('returns an empty mediaUrl when the draft has no media', () => {
    expect(resolveDraftMedia({}).mediaUrl).toBe('');
  });
  it('prefers an explicit thumbnail', () => {
    expect(resolveDraftMedia({ imageUrl: 'i', thumbnailUrl: 't' }).thumbnailUrl).toBe('t');
  });
});
