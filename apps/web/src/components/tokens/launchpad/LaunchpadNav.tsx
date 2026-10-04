/**
 * LaunchpadNav — the shared sub-navigation for every /tokens/* page, so the
 * launchpad reads as one product instead of a pile of separate routes.
 */
import { Link } from '@tanstack/react-router';
import { Bell, Compass, Plus, Repeat, Trophy, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { to: '/tokens', label: 'Discover', icon: Compass, exact: true },
  { to: '/tokens/swap', label: 'Swap', icon: Repeat },
  { to: '/tokens/portfolio', label: 'Portfolio', icon: Wallet },
  { to: '/tokens/holders', label: 'Top holders', icon: Trophy },
  { to: '/tokens/alerts', label: 'Alerts', icon: Bell },
] as const;

export function LaunchpadNav({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Launchpad"
      className={cn(
        'sticky top-14 z-20 border-b border-border bg-background/85 backdrop-blur-md',
        className
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-1 px-4">
        <div className="-mb-px flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {ITEMS.map(({ to, label, icon: Icon, ...rest }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: 'exact' in rest, includeSearch: false }}
              className="group inline-flex h-11 flex-shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:border-primary data-[status=active]:text-foreground"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          ))}
        </div>
        <Link
          to="/tokens/launch"
          className="ml-2 inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-sm transition-[transform,background-color] hover:bg-primary/90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:active:scale-100"
        >
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Launch token</span>
          <span className="sm:hidden">Launch</span>
        </Link>
      </div>
    </nav>
  );
}
