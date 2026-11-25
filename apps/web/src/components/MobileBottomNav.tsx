/**
 * Mobile Bottom Nav
 *
 * Five-slot tab bar that sits fixed at the bottom of the viewport on
 * touch devices. Tabs come from `mobileTabs()` in `@/lib/navLinks` — Home
 * plus the first four desktop primary links — so mobile and desktop always
 * share one IA. Hides on `md` and up where the full top nav is visible.
 *
 * Pages that should stay clear of this bar add `pb-bottom-nav md:pb-0`
 * to their root container.
 */

import { Link, useMatchRoute } from '@tanstack/react-router';
import { Home, Compass, Plus, BookOpen, Clapperboard, Rocket, Globe, Circle } from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { mobileTabs } from '@/lib/navLinks';
import type { ComponentType, SVGProps } from 'react';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<string, IconType> = {
  '/': Home,
  '/discover': Compass,
  '/create': Plus,
  '/studio': Clapperboard,
  '/tokens': Rocket,
  '/wiki': BookOpen,
  '/world': Globe,
};

/**
 * Routes where the bottom nav should hide because the page is an
 * immersive surface that owns the bottom of the viewport (video
 * playback, fullscreen editors, modal-style flows).
 */
const HIDE_ON_ROUTES = [{ to: '/play/$universeId' as const }, { to: '/login' as const }] as const;

export default function MobileBottomNav() {
  const matchRoute = useMatchRoute();
  const { address } = useWalletAuth();
  const tabs = mobileTabs(!!address);

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
        {tabs.map(({ to, label }) => {
          const Icon = ICONS[to] ?? Circle;
          const isActive = !!matchRoute(
            // Home only matches exactly; everything else matches its subtree.
            to === '/' ? { to } : { to, fuzzy: true }
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
