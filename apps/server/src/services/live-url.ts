/**
 * Livestream URL validation. Only YouTube / Twitch / Kick are accepted, and we
 * store the *parsed* reference (platform + id/channel) rather than trusting the
 * raw string — the web builds the iframe URL from the reference, so a creator
 * can't smuggle an arbitrary embed src through this field.
 */

export type LivePlatform = 'youtube' | 'twitch' | 'kick';

export interface LiveRef {
  platform: LivePlatform;
  /** YouTube video id, or Twitch/Kick channel name. */
  ref: string;
  /** Canonical public page URL (for the "open in new tab" link). */
  url: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL = /^[A-Za-z0-9_]{3,25}$/;

export function parseLiveUrl(input: string): LiveRef | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    let id: string | null = null;
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:live|embed)\/([^/]+)$/);
      id = m?.[1] ?? null;
    }
    return id && YT_ID.test(id)
      ? { platform: 'youtube', ref: id, url: `https://www.youtube.com/watch?v=${id}` }
      : null;
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1);
    return YT_ID.test(id)
      ? { platform: 'youtube', ref: id, url: `https://www.youtube.com/watch?v=${id}` }
      : null;
  }
  if (host === 'twitch.tv') {
    const ch = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    return ch && CHANNEL.test(ch)
      ? { platform: 'twitch', ref: ch, url: `https://www.twitch.tv/${ch}` }
      : null;
  }
  if (host === 'kick.com') {
    const ch = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    return ch && CHANNEL.test(ch)
      ? { platform: 'kick', ref: ch, url: `https://kick.com/${ch}` }
      : null;
  }
  return null;
}
