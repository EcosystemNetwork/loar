import { describe, it, expect } from 'vitest';
import { resolveDraftMedia, mediaUrlSchema } from './draft-media';

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

describe('mediaUrlSchema', () => {
  it('accepts trusted https hosts', () => {
    for (const u of [
      'https://media.loar.fun/x.png',
      'https://x.mypinata.cloud/ipfs/abc',
      'https://v3.fal.media/files/a.png',
      'https://storage.googleapis.com/b/o.mp4',
    ])
      expect(mediaUrlSchema.safeParse(u).success, u).toBe(true);
  });
  it('accepts localhost http outside production only', () => {
    expect(mediaUrlSchema.safeParse('http://localhost:3000/x.png').success).toBe(true);
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(mediaUrlSchema.safeParse('http://localhost:3000/x.png').success).toBe(false);
    process.env.NODE_ENV = prev;
  });
  it('rejects unknown hosts, non-http schemes and oversized urls', () => {
    for (const u of [
      'https://evil.example.com/x.png',
      'https://loar.fun.evil.com/x.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      'https://media.loar.fun/' + 'a'.repeat(3000),
    ])
      expect(mediaUrlSchema.safeParse(u).success, u).toBe(false);
  });
  it('honours DRAFT_MEDIA_EXTRA_HOSTS', () => {
    process.env.DRAFT_MEDIA_EXTRA_HOSTS = 'cdn.example.com';
    expect(mediaUrlSchema.safeParse('https://a.cdn.example.com/x.png').success).toBe(true);
    delete process.env.DRAFT_MEDIA_EXTRA_HOSTS;
  });
});
