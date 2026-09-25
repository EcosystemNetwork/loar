import { describe, it, expect } from 'vitest';
import { parseLiveUrl } from './live-url';

describe('parseLiveUrl', () => {
  it('parses the common YouTube shapes to a canonical url', () => {
    const want = {
      platform: 'youtube',
      ref: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    };
    expect(parseLiveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5')).toEqual(want);
    expect(parseLiveUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual(want);
    expect(parseLiveUrl('https://youtube.com/live/dQw4w9WgXcQ')).toEqual(want);
    expect(parseLiveUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(want);
  });
  it('parses Twitch and Kick channels (lowercased)', () => {
    expect(parseLiveUrl('https://www.twitch.tv/SomeStreamer')).toEqual({
      platform: 'twitch',
      ref: 'somestreamer',
      url: 'https://www.twitch.tv/somestreamer',
    });
    expect(parseLiveUrl('https://kick.com/some_streamer/')).toEqual({
      platform: 'kick',
      ref: 'some_streamer',
      url: 'https://kick.com/some_streamer',
    });
  });
  it('rejects other hosts, look-alikes, non-https, creds, and malformed ids', () => {
    for (const bad of [
      'http://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://evil.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://user:pw@youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=short',
      'https://youtube.com/watch?v="><script>',
      'https://twitch.tv/',
      'https://twitch.tv/a',
      'javascript:alert(1)',
      'not a url',
      '',
    ])
      expect(parseLiveUrl(bad), bad).toBeNull();
  });
});
