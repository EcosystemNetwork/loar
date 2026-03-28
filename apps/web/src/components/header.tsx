/**
 * Site Header
 *
 * Sticky top navigation bar with logo, page links, wallet connect button,
 * sign-out action, and theme toggle. Collapses nav links on mobile.
 */

import { Link, useMatchRoute } from '@tanstack/react-router';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { LoarBalance } from './LoarBalance';
import { ModeToggle } from './mode-toggle';
import { Button } from './ui/button';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';

export default function Header() {
  const matchRoute = useMatchRoute();
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = [
    { to: '/' as const, label: 'Home' },
    { to: '/dashboard' as const, label: 'Dashboard' },
    { to: '/discover' as const, label: 'Discover' },
    { to: '/upload' as const, label: 'Upload' },
    { to: '/my-works' as const, label: 'My Works' },
    { to: '/create' as const, label: 'Create' },
    { to: '/wiki' as const, label: 'Wiki' },
    { to: '/market' as const, label: 'Slop Market' },
    { to: '/docs' as const, label: 'Docs' },
  ];

  return (
    <header className="border-b bg-card/50 backdrop-blur-xl sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left side - Logo and Navigation */}
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-3">
              <img src="/loarlogo.svg" alt="LOAR Logo" className="h-9 w-auto object-contain" />
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {links.map(({ to, label }) => {
                const isActive = matchRoute({ to, fuzzy: to !== '/' });
                return (
                  <Link
                    key={to}
                    to={to}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
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
          </div>

          {/* Right side - Wallet and Theme Toggle */}
          <div className="flex items-center gap-2">
            <LoarBalance />
            <WalletConnectButton size="sm" />
            <ModeToggle />
            {/* Mobile menu toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileOpen && (
          <nav className="md:hidden mt-3 pb-1 flex flex-col gap-1 border-t pt-3">
            {links.map(({ to, label }) => {
              const isActive = matchRoute({ to, fuzzy: to !== '/' });
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
