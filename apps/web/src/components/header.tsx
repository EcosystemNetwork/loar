/**
 * Site Header
 *
 * Sticky top navigation: logo, the primary jobs (Discover · Create · Studio ·
 * Launchpad · Wiki), a short Explore dropdown, and the account menu. Pro tools
 * live in the Studio hub; personal pages, billing and display toggles live in
 * the account menu. All link data comes from `@/lib/navLinks`.
 */

import { Link, useMatchRoute, useRouterState } from '@tanstack/react-router';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { LoarBalance } from './LoarBalance';
import { NotificationBell } from './social/NotificationBell';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Menu, X, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useWalletAuth } from '@/lib/wallet-auth';
import {
  AUTH_ROUTES,
  needsExactMatch,
  primaryLinks as getPrimaryLinks,
  visibleAccountGroups,
  visibleExploreLinks,
} from '@/lib/navLinks';

export default function Header() {
  const matchRoute = useMatchRoute();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { address } = useWalletAuth();
  // `address` hydrates from localStorage synchronously, so keying on it (not
  // `isAuthenticated`, which waits for the /auth/me round-trip) avoids
  // flashing the signed-out nav at returning users.
  const signedIn = !!address;
  const onAuthPage = useRouterState({
    select: (s) => AUTH_ROUTES.has(s.location.pathname),
  });

  const primaryLinks = onAuthPage ? [] : getPrimaryLinks(signedIn);
  const exploreLinks = onAuthPage ? [] : visibleExploreLinks(signedIn);
  // Mobile drawer mirrors the account menu so small screens reach the same rooms.
  const drawerGroups =
    signedIn && !onAuthPage
      ? [{ label: 'Explore', links: exploreLinks }, ...visibleAccountGroups()]
      : [];
  const drawerLinks = drawerGroups.flatMap((g) => g.links);
  const exploreIsActive = exploreLinks.some(({ to }) => matchRoute({ to, fuzzy: true }));

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 lg:px-6">
        {/* ── Left: Logo + Nav ── */}
        <div className="flex items-center gap-4 min-w-0">
          {/* Auth pages carry their own large logo — don't show two. */}
          {!onAuthPage && (
            <Link to="/" className="shrink min-w-0">
              <img
                src="/loarIconTextLogo.png"
                alt="LOAR"
                className="h-7 w-auto max-w-full object-contain"
              />
            </Link>
          )}

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

            {exploreLinks.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium tracking-wide transition-colors ${
                      exploreIsActive
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Explore
                    <ChevronDown className="h-3 w-3 opacity-50" />
                    {exploreIsActive && (
                      <span className="absolute bottom-0 left-2.5 right-2.5 h-[2px] bg-primary rounded-full" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 p-1.5">
                  {exploreLinks.map((link) => (
                    <DropdownMenuItem key={link.to} asChild>
                      <Link
                        to={link.to as any}
                        activeOptions={{ exact: needsExactMatch(link.to, exploreLinks) }}
                        activeProps={{ className: 'text-primary font-medium' }}
                        className="w-full cursor-pointer text-[13px]"
                      >
                        {link.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>
        </div>

        {/* ── Right: Actions ── */}
        {onAuthPage ? (
          <Link
            to="/"
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to home
          </Link>
        ) : (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {signedIn && <LoarBalance />}
            {signedIn && <NotificationBell />}
            <WalletConnectButton size="sm" />
            <Button
              variant="ghost"
              size="icon"
              // Signed-out phones already have every link in the bottom tab bar —
              // the menu only earns its place on tablets (no tab bar, no inline nav)
              // or once there's an account menu's worth of rooms (audit #25).
              className={`${signedIn ? 'inline-flex' : 'hidden md:inline-flex'} lg:hidden ml-0.5 h-8 w-8`}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>

      {/* ── Mobile Navigation ── */}
      {mobileOpen && !onAuthPage && (
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
            {drawerGroups.map((group) => {
              return (
                <div key={group.label} className="mb-1">
                  <p className="px-2 pt-2.5 pb-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest border-t border-border/30">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-0.5">
                    {group.links.map((link) => (
                      <Link
                        key={link.to}
                        to={link.to as any}
                        activeOptions={{ exact: needsExactMatch(link.to, drawerLinks) }}
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
          </nav>
        </div>
      )}
    </header>
  );
}
