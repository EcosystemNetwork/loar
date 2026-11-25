import { SERVER_URL } from '@/utils/query-client';

/**
 * Public link for a universe that unfurls with a real preview card on
 * X / Discord / Telegram / iMessage. In production `/share/*` is proxied from
 * loar.fun to the API (see netlify.toml), so the link stays on the brand
 * domain; in dev there is no proxy, so it points at the API directly.
 */
export function universeShareUrl(id: string): string {
  const origin = import.meta.env.PROD ? window.location.origin : SERVER_URL;
  return `${origin}/share/universe/${encodeURIComponent(id)}`;
}

/** Same as `universeShareUrl`, for a single episode (`/episode/:id`). */
export function episodeShareUrl(id: string): string {
  const origin = import.meta.env.PROD ? window.location.origin : SERVER_URL;
  return `${origin}/share/episode/${encodeURIComponent(id)}`;
}
