/** Build a player iframe src from a *server-validated* stream reference. Pure. */

export type LivePlatform = 'youtube' | 'twitch' | 'kick';

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL = /^[A-Za-z0-9_]{3,25}$/;
const HOST = /^[A-Za-z0-9.-]+$/;

/** Returns null for anything that doesn't match the strict shapes (defence in depth). */
export function liveEmbedUrl(platform: string, ref: string, parentHost: string): string | null {
  if (platform === 'youtube' && YT_ID.test(ref)) {
    // nocookie domain + click-to-load in the UI means no third-party requests until asked.
    return `https://www.youtube-nocookie.com/embed/${ref}?autoplay=1&rel=0`;
  }
  if (platform === 'twitch' && CHANNEL.test(ref) && HOST.test(parentHost)) {
    return `https://player.twitch.tv/?channel=${ref}&parent=${parentHost}&autoplay=true`;
  }
  if (platform === 'kick' && CHANNEL.test(ref)) {
    return `https://player.kick.com/${ref}`;
  }
  return null;
}
