/**
 * Mobile Bottom Nav
 *
 * Five-slot tab bar that sits fixed at the bottom of the viewport on
 * touch devices. Mirrors the primary public funnel — Home, Discover,
 * Create, Wiki, Dashboard — and hides on `md` and up where the
 * full top nav is visible.
 *
 * Pages that should stay clear of this bar add `pb-bottom-nav md:pb-0`
 * to their root container.
 */

import { Link, useMatchRoute } from '@tanstack/react-router';
import { Home, Compass, Plus, BookOpen, LayoutDashboard } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type Tab = {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** When true, match `/foo` and any descendant route as active. */
  fuzzy?: boolean;
};

/**
 * Routes where the bottom nav should hide because the page is an
 * immersive surface that owns the bottom of the viewport (video
 * playback, fullscreen editors, modal-style flows).
 */
const HIDE_ON_ROUTES = [{ to: '/play/$universeId' as const }, { to: '/login' as const }] as const;

const TABS: Tab[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/discover', label: 'Discover', icon: Compass, fuzzy: true },
  { to: '/create', label: 'Create', icon: Plus, fuzzy: true },
  { to: '/wiki', label: 'Wiki', icon: BookOpen, fuzzy: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, fuzzy: true },
];

export default function MobileBottomNav() {
  const matchRoute = useMatchRoute();

  // Hide on immersive routes (video player, fullscreen flows).
  if (HIDE_ON_ROUTES.some((r) => matchRoute(r))) {
    return null;
  }

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl pb-safe-nav"
    >
      <ul className="flex h-14 items-stretch">
        {TABS.map(({ to, label, icon: Icon, fuzzy }) => {
          const isActive = !!matchRoute(
            // Home only matches exactly; everything else matches its subtree.
            to === '/' ? { to } : { to, fuzzy: fuzzy ?? false }
          );
          return (
            <li key={to} className="flex-1">
              <Link
                to={to as any}
                aria-current={isActive ? 'page' : undefined}
                className={`flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-wide transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon
                  className={`h-5 w-5 transition-transform ${isActive ? 'scale-110' : ''}`}
                  aria-hidden="true"
                />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
