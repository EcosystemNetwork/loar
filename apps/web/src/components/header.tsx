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

/**
 * Routes hidden from navigation (empty = all routes visible).
 * Add paths here to temporarily hide incomplete features.
 */
const HIDDEN_ROUTES = new Set<string>([]);

/** Core navigation — the 5 most important user flows */
const primaryLinks = [
  { to: '/discover', label: 'Discover' },
  { to: '/create', label: 'Create' },
  { to: '/editor', label: 'Editor' },
  { to: '/tokens', label: 'Launchpad' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/dashboard', label: 'Dashboard' },
].filter((l) => !HIDDEN_ROUTES.has(l.to));

/** Grouped secondary links — organized by function with section headers */
const moreGroups = [
  {
    label: 'Explore',
    links: [
      { to: '/wiki', label: 'Wiki' },
      { to: '/market', label: 'Marketplace' },
      { to: '/activity', label: 'Activity' },
    ],
  },
  {
    label: 'My Stuff',
    links: [
      { to: '/my-works', label: 'My Works' },
      { to: '/notifications', label: 'Notifications' },
      { to: '/credits', label: 'Credits' },
    ],
  },
  {
    label: 'Earn',
    links: [
      { to: '/staking', label: 'Staking' },
      { to: '/bounties', label: 'Bounties' },
      { to: '/sell', label: 'Sell' },
      { to: '/licensing', label: 'Licensing' },
      { to: '/collabs', label: 'Collabs' },
    ],
  },
  {
    label: 'More',
    links: [
      { to: '/agents', label: 'Agents', beta: true },
      { to: '/ads', label: 'Ads', beta: true },
      { to: '/sandbox', label: 'Sandbox', beta: true },
      { to: '/subscriptions', label: 'Subscriptions' },
      { to: '/faucet', label: 'Faucet' },
      { to: '/pricing', label: 'Pricing' },
      { to: '/docs', label: 'Docs' },
    ],
  },
] as const;

const moreLinks = moreGroups.flatMap((g) => g.links.filter((l) => !HIDDEN_ROUTES.has(l.to)));

const allLinks = [...primaryLinks, ...moreLinks];

export default function Header() {
  const matchRoute = useMatchRoute();
  const [mobileOpen, setMobileOpen] = useState(false);

  const moreIsActive = moreLinks.some(({ to }) => matchRoute({ to, fuzzy: true }));

  return (
    <header className="border-b bg-card/50 backdrop-blur-xl sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left side - Logo and Navigation */}
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-3">
              <img src="/loarlogo.svg" alt="LOAR Logo" className="h-9 w-auto object-contain" />
            </Link>
            <nav className="hidden lg:flex items-center gap-1">
              {primaryLinks.map(({ to, label }) => {
                const isActive = matchRoute({ to, fuzzy: true });
                return (
                  <Link
                    key={to}
                    to={to}
                    className={`px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}

              {/* More dropdown — grouped by function */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                      moreIsActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    More
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 max-h-[calc(100vh-80px)]">
                  {moreGroups.map((group, gi) => {
                    const visibleLinks = group.links.filter((l) => !HIDDEN_ROUTES.has(l.to));
                    if (!visibleLinks.length) return null;
                    return (
                      <DropdownMenuGroup key={group.label}>
                        {gi > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          {group.label}
                        </DropdownMenuLabel>
                        {visibleLinks.map((link) => (
                          <DropdownMenuItem key={link.to} asChild>
                            <Link
                              to={link.to}
                              className={`w-full cursor-pointer flex items-center justify-between ${
                                matchRoute({ to: link.to, fuzzy: true })
                                  ? 'text-primary font-medium'
                                  : ''
                              }`}
                            >
                              {link.label}
                              {'beta' in link && link.beta && (
                                <span className="text-[9px] font-semibold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full leading-none">
                                  BETA
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

          {/* Right side - Wallet and Theme Toggle */}
          <div className="flex items-center gap-2">
            <LoarBalance />
            <NotificationBell />
            <WalletConnectButton size="sm" />
            <Web3ModeToggle />
            <ModeToggle />
            {/* Mobile menu toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Navigation — compact 2-col grid grouped by category */}
        {mobileOpen && (
          <nav
            id="mobile-nav"
            aria-label="Mobile navigation"
            className="lg:hidden mt-3 pb-2 border-t pt-3 max-h-[70vh] overflow-y-auto"
          >
            {/* Primary links as prominent row */}
            <div className="grid grid-cols-3 gap-1 mb-2">
              {primaryLinks.map(({ to, label }) => {
                const isActive = matchRoute({ to, fuzzy: true });
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setMobileOpen(false)}
                    className={`px-2 py-2.5 rounded-md text-sm font-medium text-center transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
            {/* Grouped secondary links in 2-col grid */}
            {moreGroups.map((group) => {
              const visibleLinks = group.links.filter((l) => !HIDDEN_ROUTES.has(l.to));
              if (!visibleLinks.length) return null;
              return (
                <div key={group.label} className="mb-1">
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider border-t mt-1">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-0.5">
                    {visibleLinks.map((link) => {
                      const isActive = matchRoute({ to: link.to, fuzzy: true });
                      return (
                        <Link
                          key={link.to}
                          to={link.to}
                          onClick={() => setMobileOpen(false)}
                          className={`px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                            isActive
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          }`}
                        >
                          {link.label}
                          {'beta' in link && link.beta && (
                            <span className="text-[9px] font-semibold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full">
                              BETA
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
