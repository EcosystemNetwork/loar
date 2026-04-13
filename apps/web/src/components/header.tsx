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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Menu, X, ChevronDown } from 'lucide-react';
import { useState } from 'react';

const primaryLinks = [
  { to: '/discover', label: 'Discover' },
  { to: '/create', label: 'Create' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/tokens', label: 'Launchpad' },
  { to: '/credits', label: 'Credits' },
  { to: '/dashboard', label: 'Dashboard' },
];

const moreLinks = [
  { to: '/wiki', label: 'Wiki' },
  { to: '/market', label: 'Marketplace' },
  { to: '/bounties', label: 'Bounties' },
  { to: '/staking', label: 'Staking' },
  { to: '/agents', label: 'Agents' },
  { to: '/activity', label: 'Activity' },
  { to: '/my-works', label: 'My Works' },
  { to: '/sell', label: 'Sell' },
  { to: '/licensing', label: 'Licensing' },
  { to: '/collabs', label: 'Collabs' },
  { to: '/ads', label: 'Ads' },
  { to: '/sandbox', label: 'Sandbox' },
  { to: '/docs', label: 'Docs' },
];

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

              {/* More dropdown */}
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
                <DropdownMenuContent align="start" className="w-44">
                  {moreLinks.map(({ to, label }, i) => (
                    <DropdownMenuItem key={to} asChild>
                      <Link
                        to={to}
                        className={`w-full cursor-pointer ${
                          matchRoute({ to, fuzzy: true }) ? 'text-primary font-medium' : ''
                        }`}
                      >
                        {label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
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

        {/* Mobile Navigation — shows all links flat */}
        {mobileOpen && (
          <nav
            id="mobile-nav"
            aria-label="Mobile navigation"
            className="lg:hidden mt-3 pb-1 flex flex-col gap-1 border-t pt-3"
          >
            {allLinks.map(({ to, label }) => {
              const isActive = matchRoute({ to, fuzzy: true });
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
