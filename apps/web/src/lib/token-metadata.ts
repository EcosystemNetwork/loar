/**
 * Token metadata — description + social links, stored in the token's existing
 * on-chain `metadata` string (no contract change).
 *
 * New launches write compact JSON: {"description":"…","socials":{"website":"…","twitter":"…","telegram":"…"}}.
 * Legacy tokens hold a plain-text description (e.g. "Governance token for X"), so
 * `parseTokenMetadata` treats anything that isn't a JSON object as the description.
 *
 * Every URL is validated to https before it is stored *and* again when parsed —
 * metadata is attacker-controlled (anyone can deploy a token), so a `javascript:`
 * link must never reach an <a href>.
 */

export type SocialPlatform = 'website' | 'twitter' | 'telegram';

export interface TokenSocials {
  website?: string;
  twitter?: string;
  telegram?: string;
}

export interface ParsedTokenMetadata {
  description: string;
  socials: TokenSocials;
}

export const SOCIAL_PLATFORMS: SocialPlatform[] = ['website', 'twitter', 'telegram'];

/** Hosts a handle-style link must point at. `website` may be any https host. */
const PLATFORM_HOSTS: Record<Exclude<SocialPlatform, 'website'>, string[]> = {
  twitter: ['x.com', 'twitter.com'],
  telegram: ['t.me', 'telegram.me'],
};

const MAX_URL_LENGTH = 200;
// The whole string goes on-chain (calldata + storage), so keep it modest.
export const MAX_METADATA_LENGTH = 1024;

function hostMatches(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return allowed.some((a) => h === a);
}

/**
 * Normalise user input for one platform to a canonical https URL, or null when
 * it isn't valid. Accepts a bare handle for twitter/telegram ("@name" / "name").
 */
export function normalizeSocial(platform: SocialPlatform, raw: string | undefined): string | null {
  const input = (raw ?? '').trim();
  if (!input) return null;
  if (input.length > MAX_URL_LENGTH) return null;

  let candidate = input;
  if (platform !== 'website' && !/^https?:\/\//i.test(input)) {
    const handle = input.replace(/^@/, '').replace(/^\/+/, '');
    // Bare handle (no dots/slashes) → build the canonical URL.
    if (/^[A-Za-z0-9_]{1,32}$/.test(handle)) {
      candidate = platform === 'twitter' ? `https://x.com/${handle}` : `https://t.me/${handle}`;
    } else {
      candidate = `https://${input}`; // e.g. "x.com/name"
    }
  } else if (platform === 'website' && !/^https?:\/\//i.test(input)) {
    candidate = `https://${input}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes('.')) return null;
  if (platform !== 'website' && !hostMatches(url.hostname, PLATFORM_HOSTS[platform])) return null;
  return url.toString();
}

/** Serialise for the on-chain `metadata` field. Returns '' when there is nothing to store. */
export function encodeTokenMetadata(input: {
  description?: string;
  socials?: Partial<Record<SocialPlatform, string>>;
}): string {
  const description = (input.description ?? '').trim();
  const socials: TokenSocials = {};
  for (const p of SOCIAL_PLATFORMS) {
    const url = normalizeSocial(p, input.socials?.[p]);
    if (url) socials[p] = url;
  }
  if (!description && Object.keys(socials).length === 0) return '';
  // Keys omitted when empty keeps calldata small.
  const payload: { description?: string; socials?: TokenSocials } = {};
  if (description) payload.description = description;
  if (Object.keys(socials).length) payload.socials = socials;
  return JSON.stringify(payload);
}

/** Parse a token's on-chain `metadata`; never throws, never returns an unsafe URL. */
export function parseTokenMetadata(metadata: string | null | undefined): ParsedTokenMetadata {
  const raw = (metadata ?? '').trim();
  if (!raw) return { description: '', socials: {} };
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as { description?: unknown; socials?: Record<string, unknown> };
      const socials: TokenSocials = {};
      for (const p of SOCIAL_PLATFORMS) {
        const v = obj.socials?.[p];
        const url = typeof v === 'string' ? normalizeSocial(p, v) : null;
        if (url) socials[p] = url;
      }
      return {
        description: typeof obj.description === 'string' ? obj.description : '',
        socials,
      };
    } catch {
      /* fall through — treat as plain text */
    }
  }
  return { description: raw, socials: {} };
}

/** Human description for a token, tolerant of both formats. */
export function tokenDescription(metadata: string | null | undefined): string {
  return parseTokenMetadata(metadata).description;
}
