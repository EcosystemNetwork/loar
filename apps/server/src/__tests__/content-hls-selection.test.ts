import { describe, expect, it } from 'vitest';
import { isShortForm, needsHls } from '../services/content-hls';

const https = 'https://cdn.example.com/v.mp4';

describe('needsHls (backfill selection)', () => {
  it('selects video and ai-video with an https source and no hlsUrl', () => {
    expect(needsHls({ mediaType: 'video', mediaUrl: https })).toBe(true);
    expect(needsHls({ mediaType: 'ai-video', mediaUrl: https, hlsUrl: '' })).toBe(true);
    expect(needsHls({ mediaType: 'video', mediaUrl: https, hlsUrl: null })).toBe(true);
  });

  it('skips items that already have HLS, so re-running is idempotent', () => {
    expect(
      needsHls({ mediaType: 'video', mediaUrl: https, hlsUrl: 'https://cdn/x/master.m3u8' })
    ).toBe(false);
  });

  it('skips non-video media', () => {
    for (const mediaType of ['image', 'ai-image', 'audio', '3d', undefined]) {
      expect(needsHls({ mediaType, mediaUrl: https })).toBe(false);
    }
  });

  it('skips sources ffmpeg is never pointed at: non-https, missing, or already an HLS playlist', () => {
    expect(needsHls({ mediaType: 'video', mediaUrl: 'http://cdn/v.mp4' })).toBe(false);
    expect(needsHls({ mediaType: 'video', mediaUrl: 'file:///etc/passwd' })).toBe(false);
    expect(needsHls({ mediaType: 'video', mediaUrl: 'ipfs://Qm123' })).toBe(false);
    expect(needsHls({ mediaType: 'video' })).toBe(false);
    expect(needsHls({ mediaType: 'video', mediaUrl: 42 })).toBe(false);
    expect(needsHls({ mediaType: 'video', mediaUrl: 'https://cdn/x/master.m3u8' })).toBe(false);
    expect(needsHls({ mediaType: 'video', mediaUrl: 'https://cdn/x/master.m3u8?sig=1' })).toBe(
      false
    );
  });
});

describe('isShortForm', () => {
  it('flags vertical clips only', () => {
    expect(isShortForm({ aspectRatio: '9:16' })).toBe(true);
    expect(isShortForm({ aspectRatio: '16:9' })).toBe(false);
    expect(isShortForm({})).toBe(false);
  });
});
