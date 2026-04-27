/**
 * Site Header
 *
 * Sticky top navigation bar with logo, primary links, "More" dropdown
 * for secondary pages, wallet connect, and theme toggle.
 * Collapses all links on mobile.
 */

import { Link, useMatchRoute } from '@tanstack/react-router';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { LoarBalance } from './LoarBalance';
import { Web3ModeToggle } from './web3-mode-toggle';
import { ModeToggle } from './mode-toggle';
import { NotificationBell } from './social/NotificationBell';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Menu, X, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';

/**
 * Routes hidden from navigation (empty = all routes visible).
 * Add paths here to temporarily hide incomplete features.
 */
const HIDDEN_ROUTES = new Set<string>([]);

/** Core navigation — primary user flows shown inline. */
const primaryLinksBase = [
  { to: '/discover', label: 'Discover' },
  { to: '/create', label: 'Create' },
  { to: '/tokens', label: 'Launchpad' },
  { to: '/wiki', label: 'Wiki' },
  { to: '/dashboard', label: 'Dashboard' },
] as const;

type MoreLink = { to: string; label: string; beta?: boolean };
type MoreGroup = { label: string; links: MoreLink[] };

/** Grouped secondary links — organized by function with section headers.
 *  Studio + Gallery appear under "My Stuff" only when the caller has universes
 *  (appended at render time in `buildMoreGroups`). */
const moreGroupsBase: MoreGroup[] = [
  {
    label: 'Explore',
    links: [
      { to: '/market', label: 'Marketplace' },
      { to: '/activity', label: 'Activity' },
    ],
  },
  {
    label: 'Tools',
    links: [{ to: '/lab/zai', label: 'Z.AI Lab' }],
  },
  {
    label: 'My Stuff',
    links: [
      { to: '/my-works', label: 'My Works' },
      { to: '/notifications', label: 'Notifications' },
      { to: '/credits', label: 'Credits' },
      { to: '/settings/api-keys', label: 'API Keys' },
    ],
  },
  {
    label: 'Earn',
    links: [{ to: '/sell', label: 'Sell' }],
  },
  {
    label: 'More',
    links: [
      // Sandbox is reachable from /create — no longer a standalone nav entry.
      { to: '/subscriptions', label: 'Subscriptions' },
      { to: '/faucet', label: 'Faucet' },
      { to: '/pricing', label: 'Pricing' },
      { to: '/docs', label: 'Docs' },
    ],
  },
];

function buildMoreGroups(hasUniverses: boolean): MoreGroup[] {
  if (!hasUniverses) return moreGroupsBase;
  return moreGroupsBase.map((g) =>
    g.label === 'My Stuff'
      ? {
          ...g,
          links: [
            { to: '/studio', label: 'Studio' },
            { to: '/gallery', label: 'Gallery' },
            ...g.links,
          ],
        }
      : g
  );
}

export default function Header() {
  const matchRoute = useMatchRoute();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { address, isAuthenticated } = useWalletAuth();

  // Surface the Studio link only for users who actually have universes to manage.
  const { data: hasUniverses } = useQuery({
    queryKey: ['header', 'has-universes', address],
    queryFn: () =>
      trpcClient.universes.getByCreator
        .query({ creator: address! })
        .then((r: any) => ((r?.data ?? r) as unknown[])?.length > 0),
    enabled: !!address && isAuthenticated,
    staleTime: 60_000,
  });

  // Studio + Gallery surface only for users with universes, but we keep them
  // in the More dropdown instead of inline to avoid overflowing the header on
  // 1440px viewports.
  const primaryLinks = primaryLinksBase.filter((l) => !HIDDEN_ROUTES.has(l.to));
  const moreGroups = buildMoreGroups(!!hasUniverses);
  const moreLinks = moreGroups.flatMap((g) => g.links.filter((l) => !HIDDEN_ROUTES.has(l.to)));

  const moreIsActive = moreLinks.some(({ to }) => matchRoute({ to, fuzzy: true }));

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 lg:px-6">
        {/* ── Left: Logo + Nav ── */}
        <div className="flex items-center gap-4 min-w-0">
          <Link to="/" className="flex-shrink-0">
            <img src="/loarIconTextLogo.png" alt="LOAR" className="h-7 w-auto object-contain" />
          </Link>

          <nav className="hidden lg:flex items-center">
            {primaryLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to as any}
                className="relative px-2.5 py-1.5 text-[13px] font-medium tracking-wide transition-colors text-muted-foreground hover:text-foreground [&.active]:text-foreground"
                activeProps={{ className: 'active group' }}
              >
                {({ isActive }: { isActive: boolean }) => (
                  <>
                    {label}
                    {isActive && (
                      <span className="absolute bottom-0 left-2.5 right-2.5 h-[2px] bg-primary rounded-full" />
                    )}
                  </>
                )}
              </Link>
            ))}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium tracking-wide transition-colors ${
                    moreIsActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  More
                  <ChevronDown className="h-3 w-3 opacity-50" />
                  {moreIsActive && (
                    <span className="absolute bottom-0 left-2.5 right-2.5 h-[2px] bg-primary rounded-full" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {moreGroups.map((group, gi) => {
                  const visibleLinks = group.links.filter((l) => !HIDDEN_ROUTES.has(l.to));
                  if (!visibleLinks.length) return null;
                  return (
                    <DropdownMenuGroup key={group.label}>
                      {gi > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                        {group.label}
                      </DropdownMenuLabel>
                      {visibleLinks.map((link) => (
                        <DropdownMenuItem key={link.to} asChild>
                          <Link
                            to={link.to as any}
                            activeProps={{ className: 'text-primary font-medium' }}
                            inactiveProps={{ className: 'text-foreground' }}
                            className="w-full cursor-pointer flex items-center justify-between text-[13px]"
                          >
                            {link.label}
                            {'beta' in link && link.beta && (
                              <span className="text-[9px] font-semibold bg-primary/10 text-primary/80 px-1.5 py-0.5 rounded leading-none uppercase tracking-wider">
                                Beta
                              </span>
                            )}
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>

        {/* ── Right: Actions ── */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <LoarBalance />
          <NotificationBell />
          <WalletConnectButton size="sm" />
          <div className="hidden sm:flex items-center gap-1 ml-1 pl-1.5 border-l border-border/50">
            <Web3ModeToggle />
            <ModeToggle />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden ml-0.5 h-8 w-8"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ── Mobile Navigation ── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-x-0 top-14 bottom-0 z-40 bg-background/95 backdrop-blur-xl border-t border-border/40 overflow-y-auto">
          <nav
            id="mobile-nav"
            aria-label="Mobile navigation"
            className="mx-auto max-w-[1440px] px-4 py-3"
          >
            <div className="grid grid-cols-3 gap-1 mb-3">
              {primaryLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to as any}
                  onClick={() => setMobileOpen(false)}
                  activeProps={{ className: 'bg-primary/10 text-primary' }}
                  inactiveProps={{
                    className: 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                  }}
                  className="px-2 py-2.5 rounded-lg text-[13px] font-medium text-center transition-colors"
                >
                  {label}
                </Link>
              ))}
            </div>
            {moreGroups.map((group) => {
              const visibleLinks = group.links.filter((l) => !HIDDEN_ROUTES.has(l.to));
              if (!visibleLinks.length) return null;
              return (
                <div key={group.label} className="mb-1">
                  <p className="px-2 pt-2.5 pb-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest border-t border-border/30">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-0.5">
                    {visibleLinks.map((link) => (
                      <Link
                        key={link.to}
                        to={link.to as any}
                        onClick={() => setMobileOpen(false)}
                        activeProps={{ className: 'bg-primary/10 text-primary' }}
                        inactiveProps={{
                          className:
                            'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                        }}
                        className="px-3 py-2 rounded-lg text-[13px] font-medium transition-colors flex items-center gap-2"
                      >
                        {link.label}
                        {'beta' in link && link.beta && (
                          <span className="text-[9px] font-semibold bg-primary/10 text-primary/70 px-1.5 py-0.5 rounded leading-none">
                            BETA
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-1 pt-2 mt-2 border-t border-border/30 sm:hidden">
              <Web3ModeToggle />
              <ModeToggle />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
