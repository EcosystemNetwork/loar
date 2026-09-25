import { describe, it, expect } from 'vitest';
import { liveEmbedUrl } from '../live-embed';

describe('liveEmbedUrl', () => {
  it('builds the three player urls', () => {
    expect(liveEmbedUrl('youtube', 'dQw4w9WgXcQ', 'loar.fun')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0'
    );
    expect(liveEmbedUrl('twitch', 'some_streamer', 'loar.fun')).toBe(
      'https://player.twitch.tv/?channel=some_streamer&parent=loar.fun&autoplay=true'
    );
    expect(liveEmbedUrl('kick', 'some_streamer', 'loar.fun')).toBe(
      'https://player.kick.com/some_streamer'
    );
  });
  it('refuses malformed refs, unknown platforms and hostile parents', () => {
    expect(liveEmbedUrl('youtube', 'x"><script>', 'a.com')).toBeNull();
    expect(liveEmbedUrl('youtube', 'short', 'a.com')).toBeNull();
    expect(liveEmbedUrl('twitch', 'a', 'a.com')).toBeNull();
    expect(liveEmbedUrl('twitch', 'good_name', 'a.com&x=1')).toBeNull();
    expect(liveEmbedUrl('vimeo', 'abcdefghijk', 'a.com')).toBeNull();
  });
});
