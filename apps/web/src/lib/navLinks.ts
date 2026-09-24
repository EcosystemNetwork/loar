/**
 * Header navigation data — the primary inline links and the grouped "More"
 * dropdown. Kept out of `header.tsx` so the link set can be unit-tested
 * (every target must be a real route, no duplicates, no ambiguous active state).
 */

export type NavLink = { to: string; label: string; beta?: boolean };
export type NavGroup = { label: string; links: NavLink[] };

/**
 * Routes hidden from navigation (empty = all routes visible).
 * Add paths here to temporarily hide incomplete features.
 */
export const HIDDEN_ROUTES = new Set<string>([]);

/** Core navigation — primary user flows shown inline. */
export const primaryLinksBase = [
  { to: '/discover', label: 'Discover' },
  { to: '/create', label: 'Create' },
  { to: '/tokens', label: 'Launchpad' },
  { to: '/wiki', label: 'Wiki' },
  { to: '/dashboard', label: 'Dashboard' },
] as const;

/** Surfaced inline only for users who own universes — Studio is the entry
 *  point to the React Flow universe editor (`/universe/$id`). */
export const ownerPrimaryLink = { to: '/studio', label: 'My Studio' } as const;

/** Grouped secondary links — organized by function with section headers.
 *  Each group is a single, non-overlapping concern so links are easy to find:
 *  Explore (discovery), Studio (creation tools), My Stuff (owned content),
 *  Wallet & Billing (all money/credits), Earn, Developer, Agents & Brands.
 *  Gallery appears under "My Stuff" only when the caller has universes
 *  (prepended at render time in `buildMoreGroups`). */
export const moreGroupsBase: NavGroup[] = [
  {
    label: 'Explore',
    links: [
      { to: '/market', label: 'Marketplace' },
      { to: '/marketplace/likeness', label: 'Likeness Marketplace' },
      { to: '/governance', label: 'Governance' },
      { to: '/activity', label: 'Activity' },
    ],
  },
  {
    label: 'Studio',
    links: [
      { to: '/canvas', label: 'Canvas' },
      { to: '/notebook', label: 'Notebook' },
      { to: '/editor', label: 'Clip Editor' },
      { to: '/lab/voice-studio', label: 'Voice Studio' },
      { to: '/lab/zai', label: 'Model Lab' },
      { to: '/lab/gpt-image', label: 'GPT Image Lab' },
      { to: '/marketing', label: 'Marketing Studio', beta: true },
      { to: '/ad-reference', label: 'Ad Reference', beta: true },
    ],
  },
  {
    label: 'My Stuff',
    links: [
      { to: '/my-works', label: 'My Works' },
      { to: '/marketplace/likeness/my-listings', label: 'My Likeness Listings' },
      { to: '/notifications', label: 'Notifications' },
      { to: '/series', label: 'Series Mode', beta: true },
      { to: '/virality', label: 'Virality Predictor', beta: true },
      { to: '/royalties', label: 'Royalty Splits', beta: true },
    ],
  },
  {
    label: 'Wallet & Billing',
    links: [
      { to: '/credits', label: 'Points Balance' },
      { to: '/swap', label: 'Swap' },
      { to: '/subscriptions', label: 'Subscriptions' },
      { to: '/pricing', label: 'Pricing' },
      { to: '/faucet', label: 'Faucet' },
    ],
  },
  {
    label: 'Earn',
    links: [
      { to: '/points-leaderboard', label: 'Points Leaderboard' },
      { to: '/bounties', label: 'Bounties' },
      { to: '/sell', label: 'Sell' },
      { to: '/residency', label: 'Residency', beta: true },
    ],
  },
  {
    label: 'Developer',
    links: [
      { to: '/settings/agent-keys', label: 'API Keys' },
      { to: '/settings/api-keys', label: 'Provider Keys (BYOK)' },
      { to: '/docs', label: 'Docs' },
    ],
  },
  {
    label: 'Agents & Brands',
    links: [
      { to: '/agents', label: 'Agents', beta: true },
      { to: '/agents/discover', label: 'Agent Economy', beta: true },
      { to: '/arc', label: 'Arc USDC', beta: true },
      { to: '/adplacements', label: 'Ads', beta: true },
      { to: '/brand/dashboard', label: 'Brand Dashboard', beta: true },
      // Sandbox is reachable from /create — no longer a standalone nav entry.
    ],
  },
];

export function buildMoreGroups(hasUniverses: boolean): NavGroup[] {
  if (!hasUniverses) return moreGroupsBase;
  // Studio is promoted inline (see `ownerPrimaryLink`); keep Gallery in the
  // dropdown alongside the other owner-only items.
  return moreGroupsBase.map((g) =>
    g.label === 'My Stuff' ? { ...g, links: [{ to: '/gallery', label: 'Gallery' }, ...g.links] } : g
  );
}

/** Groups with `HIDDEN_ROUTES` applied and empty groups dropped. */
export function visibleMoreGroups(hasUniverses: boolean): NavGroup[] {
  return buildMoreGroups(hasUniverses)
    .map((g) => ({ ...g, links: g.links.filter((l) => !HIDDEN_ROUTES.has(l.to)) }))
    .filter((g) => g.links.length > 0);
}

/**
 * Whether `to` needs an exact active match. TanStack's `Link` matches by
 * prefix, so a link that has another nav link nested beneath it (e.g.
 * `/agents` vs `/agents/discover`) would otherwise highlight alongside its
 * child and the menu would show two "current" entries.
 */
export function needsExactMatch(to: string, groups: NavGroup[]): boolean {
  return groups.some((g) => g.links.some((l) => l.to.startsWith(`${to}/`)));
}
