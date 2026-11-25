/**
 * Navigation — the single source of truth for every nav surface:
 * desktop header, mobile tab bar, mobile drawer, account menu and the
 * Studio hub's tool grid. Kept out of components so the whole link set can
 * be unit-tested (every target is a real route, no duplicates, no ambiguous
 * active state).
 *
 * Information architecture — the product has four jobs:
 *
 *   Watch   → Discover, Wiki, 3D World           (primary nav / Explore)
 *   Create  → the one-prompt generation console  (primary nav)
 *   Studio  → your universes + every pro tool    (primary nav → /studio hub)
 *   Own     → Launchpad, marketplaces, revenue   (primary nav / Explore)
 *
 * Anything that is "mine" (works, balance, keys, settings) lives in the
 * account menu. Pro tools live in the Studio hub, not in global nav.
 */

export type NavLink = { to: string; label: string; beta?: boolean };
export type NavGroup = { label: string; links: NavLink[] };
export type StudioTool = NavLink & { description: string };
export type StudioToolGroup = { label: string; tools: StudioTool[] };

/**
 * Routes hidden from navigation (empty = all routes visible).
 * Add paths here to temporarily hide incomplete features.
 */
export const HIDDEN_ROUTES = new Set<string>([]);

/** Auth screens are a quiet brand moment: logo + form, no app nav. */
export const AUTH_ROUTES = new Set<string>(['/login']);

/** Signed-out visitors: watch + try. No rooms they cannot enter. */
export const signedOutLinks = [
  { to: '/discover', label: 'Discover' },
  { to: '/create', label: 'Create' },
  { to: '/wiki', label: 'Wiki' },
  { to: '/world', label: '3D World' },
] as const satisfies readonly NavLink[];

/** Signed-in users: the four jobs, in funnel order. */
export const signedInLinks = [
  { to: '/discover', label: 'Discover' },
  { to: '/create', label: 'Create' },
  { to: '/studio', label: 'Studio' },
  { to: '/tokens', label: 'Launchpad' },
  { to: '/wiki', label: 'Wiki' },
] as const satisfies readonly NavLink[];

/** "Explore" dropdown (signed in) — community + markets beyond Discover. */
export const exploreLinks: NavLink[] = [
  { to: '/world', label: '3D World' },
  { to: '/market', label: 'Marketplace' },
  { to: '/marketplace/likeness', label: 'Likeness Marketplace' },
  { to: '/governance', label: 'Governance' },
  { to: '/bounties', label: 'Bounties' },
  { to: '/points-leaderboard', label: 'Leaderboard' },
  { to: '/activity', label: 'Activity' },
  { to: '/agents/discover', label: 'Agent Economy' },
  { to: '/residency', label: 'Residency' },
];

/** Account menu (avatar) — everything that is "mine". */
export const accountGroups: NavGroup[] = [
  {
    label: 'You',
    links: [
      { to: '/dashboard', label: 'Dashboard' },
      { to: '/my-works', label: 'My Works' },
      { to: '/notifications', label: 'Notifications' },
      { to: '/dashboard/personas', label: 'My Personas' },
      { to: '/marketplace/likeness/my-listings', label: 'My Likeness Listings' },
      { to: '/royalties', label: 'Royalty Splits' },
    ],
  },
  {
    label: 'Balance & billing',
    links: [
      { to: '/credits', label: 'Points' },
      { to: '/pricing', label: 'Pricing' },
      { to: '/subscriptions', label: 'Subscriptions' },
      { to: '/swap', label: 'Swap' },
      { to: '/faucet', label: 'Testnet Faucet' },
    ],
  },
  {
    label: 'Settings',
    links: [
      { to: '/settings/api-keys', label: 'Provider Keys (BYOK)' },
      { to: '/settings/agent-keys', label: 'API Keys' },
      { to: '/settings/usage', label: 'Usage' },
      { to: '/settings/wallets', label: 'Wallets' },
      { to: '/docs', label: 'Docs' },
    ],
  },
];

/** Studio hub tool grid — every pro tool, grouped by what you're doing. */
export const studioToolGroups: StudioToolGroup[] = [
  {
    label: 'Make',
    tools: [
      { to: '/canvas', label: 'Canvas', description: 'Node-based board for chaining generations.' },
      {
        to: '/notebook',
        label: 'Notebook',
        description: 'Write scripts and lore, generate inline.',
      },
      {
        to: '/series',
        label: 'Series Mode',
        description: 'Multi-episode arcs with locked cast and style.',
        beta: true,
      },
      {
        to: '/lab/voice-studio',
        label: 'Voice Studio',
        description: 'Clone, design and direct character voices.',
      },
      { to: '/lab/zai', label: 'Model Lab', description: 'Try any model directly, side by side.' },
      {
        to: '/lab/gpt-image',
        label: 'GPT Image Lab',
        description: 'Prompt-faithful stills and edits.',
      },
      {
        to: '/create/persona',
        label: 'Persona',
        description: 'Bundle voice, look, 3D and personality.',
      },
      {
        to: '/create/likeness',
        label: 'Likeness',
        description: 'Register a likeness you can license.',
      },
      { to: '/upload', label: 'Upload', description: 'Bring your own footage, images and audio.' },
    ],
  },
  {
    label: 'Edit',
    tools: [
      { to: '/editor', label: 'Clip Editor', description: 'Cut, trim and score episodes.' },
      {
        to: '/edit/inpaint',
        label: 'Inpaint',
        description: 'Fill, remove or replace part of an image.',
      },
      { to: '/edit/outpaint', label: 'Outpaint', description: 'Reframe, extend and zoom out.' },
      { to: '/relight', label: 'Relight', description: 'Change lighting and tone on any still.' },
    ],
  },
  {
    label: 'Grow & sell',
    tools: [
      {
        to: '/virality',
        label: 'Virality Predictor',
        description: 'Rank episodes by real viewer signals.',
        beta: true,
      },
      {
        to: '/marketing',
        label: 'Marketing Studio',
        description: 'Turn episodes into promo assets.',
        beta: true,
      },
      {
        to: '/ad-reference',
        label: 'Ad Reference',
        description: 'Reference library for ad creative.',
        beta: true,
      },
      { to: '/sell', label: 'Sell', description: 'List products and merch in the shop.' },
      {
        to: '/adplacements',
        label: 'Ad Placements',
        description: 'Sell placements inside your episodes.',
        beta: true,
      },
      {
        to: '/brand/dashboard',
        label: 'Brand Dashboard',
        description: 'For brands buying placements.',
        beta: true,
      },
      {
        to: '/agents',
        label: 'Agents',
        description: 'Register agents that work in your universe.',
        beta: true,
      },
      { to: '/arc', label: 'Arc USDC', description: 'USDC payments on Arc.', beta: true },
    ],
  },
];

const visible = <T extends NavLink>(links: readonly T[]): T[] =>
  links.filter((l) => !HIDDEN_ROUTES.has(l.to));

/** Inline header links for the current auth state. */
export function primaryLinks(signedIn: boolean): NavLink[] {
  return visible(signedIn ? signedInLinks : signedOutLinks);
}

/** Explore dropdown — signed-in only. */
export function visibleExploreLinks(signedIn: boolean): NavLink[] {
  return signedIn ? visible(exploreLinks) : [];
}

/** Account groups with hidden routes applied and empty groups dropped. */
export function visibleAccountGroups(): NavGroup[] {
  return accountGroups
    .map((g) => ({ ...g, links: visible(g.links) }))
    .filter((g) => g.links.length > 0);
}

/** Studio tool groups with hidden routes applied and empty groups dropped. */
export function visibleStudioToolGroups(): StudioToolGroup[] {
  return studioToolGroups
    .map((g) => ({ ...g, tools: visible(g.tools) }))
    .filter((g) => g.tools.length > 0);
}

/** Mobile tab bar: Home + the first four primary links — same order as desktop. */
export function mobileTabs(signedIn: boolean): NavLink[] {
  return [{ to: '/', label: 'Home' }, ...primaryLinks(signedIn)].slice(0, 5);
}

/**
 * Whether `to` needs an exact active match. TanStack's `Link` matches by
 * prefix, so a link that has another nav link nested beneath it (e.g.
 * `/dashboard` vs `/dashboard/personas`) would otherwise highlight alongside
 * its child and the menu would show two "current" entries.
 */
export function needsExactMatch(to: string, links: readonly NavLink[]): boolean {
  return links.some((l) => l.to.startsWith(`${to}/`));
}

/** Every link in every nav surface — for exact-match checks and tests. */
export function allNavLinks(): NavLink[] {
  return [
    ...signedOutLinks,
    ...signedInLinks,
    ...exploreLinks,
    ...accountGroups.flatMap((g) => g.links),
    ...studioToolGroups.flatMap((g) => g.tools),
  ];
}
