/**
 * /admin — Site-wide admin hub.
 *
 * Landing page for every admin sub-dashboard. Same gate as the pages it
 * links to (SIWE session + `VITE_ADMIN_ADDRESSES` allowlist on the client;
 * each linked page's own `adminProcedure` calls enforce it again
 * server-side, so this page being reachable never grants access on its own).
 *
 * Each card does its own tiny, independently-gated query for a live count
 * badge. Any of them failing or being slow never blocks the others or the
 * page itself — badges just render empty.
 */
import { createFileRoute, redirect, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import {
  Shield,
  AlertTriangle,
  Loader2,
  Globe,
  DollarSign,
  Power,
  FlagTriangleRight,
  Home,
  Rocket,
  KeyRound,
  Activity,
  ArrowRight,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const Route = createFileRoute('/admin/')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin' } });
    }
  },
  component: AdminHub,
});

function useIsAdmin() {
  const { isAuthenticated, isAuthenticating, address } = useWalletAuth();
  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());
  return { isAuthenticated, isAuthenticating, isAdmin };
}

interface AdminLink {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
  badge?: () => React.ReactNode;
}

function ModerationBadge({ enabled }: { enabled: boolean }) {
  const { data: flags } = useQuery({
    queryKey: ['admin-hub', 'moderation', 'flags'],
    queryFn: () =>
      trpcClient.moderation.reviewQueue.query({ type: 'flags', status: 'pending', limit: 50 }),
    enabled,
    staleTime: 30_000,
  });
  const { data: takedowns } = useQuery({
    queryKey: ['admin-hub', 'moderation', 'takedowns'],
    queryFn: () =>
      trpcClient.moderation.reviewQueue.query({ type: 'takedowns', status: 'pending', limit: 50 }),
    enabled,
    staleTime: 30_000,
  });
  const count = ((flags as any)?.items?.length ?? 0) + ((takedowns as any)?.items?.length ?? 0);
  if (!count) return null;
  return <Badge variant="destructive">{count} pending</Badge>;
}

function ResidencyBadge({ enabled }: { enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ['admin-hub', 'residency'],
    queryFn: () => trpcClient.residencies.listApplications.query({ status: 'pending', limit: 100 }),
    enabled,
    staleTime: 30_000,
  });
  const count = ((data as any)?.length ?? (data as any)?.items?.length) || 0;
  if (!count) return null;
  return <Badge variant="secondary">{count} pending</Badge>;
}

function UniversesBadge({ enabled }: { enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ['admin-hub', 'universes'],
    queryFn: () => trpcClient.universes.adminList.query(),
    enabled,
    staleTime: 30_000,
  });
  const hidden = ((data as any)?.data ?? []).filter((u: any) => u.isHidden).length;
  if (!hidden) return null;
  return <Badge variant="outline">{hidden} hidden</Badge>;
}

function OpsBadge({ enabled }: { enabled: boolean }) {
  const { data: cfg } = useQuery({
    queryKey: ['admin-hub', 'ops-config'],
    queryFn: () => trpcClient.admin.getConfig.query(),
    enabled,
    staleTime: 30_000,
  });
  const { data: abuse } = useQuery({
    queryKey: ['admin-hub', 'ops-abuse'],
    queryFn: () => trpcClient.admin.listAbuseFlags.query({ status: 'open', limit: 50 }),
    enabled,
    staleTime: 30_000,
  });
  const killed = cfg
    ? (
        ['generationEnabled', 'mintingEnabled', 'purchaseEnabled', 'registrationEnabled'] as const
      ).filter((k) => cfg[k] === false).length
    : 0;
  const openFlags = (abuse as any)?.items?.length ?? 0;
  if (!killed && !openFlags) return null;
  return (
    <div className="flex gap-1.5">
      {killed > 0 && <Badge variant="destructive">{killed} disabled</Badge>}
      {openFlags > 0 && <Badge variant="secondary">{openFlags} abuse flags</Badge>}
    </div>
  );
}

function UsersBadge({ enabled }: { enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ['admin-hub', 'analytics-overview'],
    queryFn: () => trpcClient.admin.analytics.overview.query(),
    enabled,
    staleTime: 30_000,
  });
  const total = (data as any)?.totalUsers;
  if (total == null) return null;
  return <Badge variant="outline">{total} users</Badge>;
}

function MainnetBadge({ enabled }: { enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ['admin-hub', 'mainnet'],
    queryFn: () => trpcClient.mainnetReadiness.snapshot.query(),
    enabled,
    staleTime: 30_000,
  });
  const blocked = (data as any)?.blockedCount ?? 0;
  if (!blocked) return null;
  return <Badge variant="destructive">{blocked} blocked</Badge>;
}

function AdminHub() {
  const { isAuthenticated, isAuthenticating, isAdmin } = useIsAdmin();
  const gated = isAuthenticated && isAdmin;

  const links: AdminLink[] = [
    {
      to: '/admin/dashboard',
      title: 'Site Analytics',
      description: 'Total users, signups over time, active wallets, universes/episodes.',
      icon: Users,
      badge: () => <UsersBadge enabled={gated} />,
    },
    {
      to: '/admin/ops',
      title: 'Ops',
      description: 'Feature kill switches, spend caps, abuse flags, retro auto-canon.',
      icon: Power,
      badge: () => <OpsBadge enabled={gated} />,
    },
    {
      to: '/admin/moderation',
      title: 'Moderation',
      description: 'Flagged content, DMCA takedowns, audit log.',
      icon: FlagTriangleRight,
      badge: () => <ModerationBadge enabled={gated} />,
    },
    {
      to: '/admin/universes',
      title: 'Universes',
      description: 'Hide / restore / permanently delete universes.',
      icon: Globe,
      badge: () => <UniversesBadge enabled={gated} />,
    },
    {
      to: '/admin/residency',
      title: 'Residency',
      description: 'Review pending residency applications.',
      icon: Home,
      badge: () => <ResidencyBadge enabled={gated} />,
    },
    {
      to: '/admin/cost',
      title: 'Cost',
      description: 'Margin, revenue, and per-provider cost dashboard.',
      icon: DollarSign,
    },
    {
      to: '/admin/mainnet',
      title: 'Mainnet Readiness',
      description: 'Live scorecard of every launch blocker.',
      icon: Rocket,
      badge: () => <MainnetBadge enabled={gated} />,
    },
    {
      to: '/admin/byok-codes',
      title: 'BYOK Codes',
      description: 'Mint and manage fee-waiver unlock codes.',
      icon: KeyRound,
    },
    {
      to: '/admin/mcp-usage',
      title: 'MCP Usage',
      description: 'Observability for the MCP agent integration.',
      icon: Activity,
    },
  ];

  if (isAuthenticating) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-2 text-center">
          <Shield className="mx-auto h-12 w-12 text-red-400" />
          <h2 className="text-xl font-bold">Unauthorized</h2>
          <p className="text-sm text-muted-foreground">
            Your wallet address does not have admin access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Shield className="h-6 w-6" /> Admin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Every admin dashboard, in one place.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {links.map(({ to, title, description, icon: Icon, badge: renderBadge }) => (
            <Link key={to} to={to} className="group block">
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Icon className="h-6 w-6 text-muted-foreground group-hover:text-foreground" />
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                  </div>
                  {renderBadge ? <div>{renderBadge()}</div> : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <p className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          Access is allowlisted via <code className="mx-1">VITE_ADMIN_ADDRESSES</code> and enforced
          again server-side on every action.
        </p>
      </div>
    </div>
  );
}
