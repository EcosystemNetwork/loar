/**
 * Ad Seeds Hub — "Seed Dance"
 *
 * Advertisers post ad seeds (brand creatives + bounty per placement).
 * Filmmakers browse seeds and earn $LOAR by placing ads in their films.
 *
 * Tabs:
 *   Browse    — all open seeds, filterable by type
 *   My Seeds  — advertiser's posted seeds + placement stats
 *   My Gigs   — filmmaker's submitted placements + status
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Sparkles,
  Megaphone,
  Plus,
  Loader2,
  Image,
  Package,
  User,
  Volume2,
  Tv2,
  BookOpen,
  Eye,
  Trophy,
  Clock,
  CheckCircle2,
  ArrowRight,
  Coins,
  Film,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  useAdSeeds,
  useMyAdSeeds,
  useMyAdSeedPlacements,
  useAdSeedStats,
} from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';

export const Route = createFileRoute('/adplacements/seeds/')({
  component: SeedDanceHub,
});

const SEED_TYPES = [
  { value: 'ALL', label: 'All', icon: <Sparkles className="w-4 h-4" /> },
  { value: 'LOGO', label: 'Logo', icon: <Image className="w-4 h-4" /> },
  { value: 'PRODUCT', label: 'Product', icon: <Package className="w-4 h-4" /> },
  { value: 'CHARACTER', label: 'Character', icon: <User className="w-4 h-4" /> },
  { value: 'AUDIO', label: 'Audio', icon: <Volume2 className="w-4 h-4" /> },
  { value: 'BILLBOARD', label: 'Billboard', icon: <Tv2 className="w-4 h-4" /> },
  { value: 'NARRATIVE', label: 'Narrative', icon: <BookOpen className="w-4 h-4" /> },
] as const;

const SEED_TYPE_COLORS: Record<string, string> = {
  LOGO: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  PRODUCT: 'bg-green-500/10 text-green-400 border-green-500/20',
  CHARACTER: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  AUDIO: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  BILLBOARD: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  NARRATIVE: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};

type Tab = 'browse' | 'my-seeds' | 'my-gigs';

function SeedDanceHub() {
  const { isConnected, isAuthenticated } = useWalletAuth();
  const [tab, setTab] = useState<Tab>('browse');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const { data: stats } = useAdSeedStats();

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-b from-primary/10 to-background px-4 pt-6 pb-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-primary" />
                Seed Dance
              </h1>
              <p className="text-sm text-muted-foreground">
                Brands seed ads. Filmmakers earn by placing them.
              </p>
            </div>
            {isConnected && (
              <Link to="/adplacements/seeds/new">
                <Button size="sm" className="gap-1">
                  <Plus className="w-4 h-4" />
                  Plant Seed
                </Button>
              </Link>
            )}
          </div>

          {/* Stats bar */}
          {stats && (
            <div className="grid grid-cols-4 gap-2 mt-4">
              <MiniStat label="Seeds" value={String(stats.total)} />
              <MiniStat label="Open" value={String(stats.open)} />
              <MiniStat label="Budget" value={`${(stats.totalBudget / 1000).toFixed(1)}k`} />
              <MiniStat label="Placed" value={String(stats.totalPlacements)} />
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b">
          {[
            { key: 'browse' as Tab, label: 'Browse Seeds' },
            { key: 'my-seeds' as Tab, label: 'My Seeds' },
            { key: 'my-gigs' as Tab, label: 'My Gigs' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'browse' && <BrowseTab typeFilter={typeFilter} setTypeFilter={setTypeFilter} />}
        {tab === 'my-seeds' && <MySeedsTab />}
        {tab === 'my-gigs' && <MyGigsTab />}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-lg px-3 py-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function BrowseTab({
  typeFilter,
  setTypeFilter,
}: {
  typeFilter: string;
  setTypeFilter: (v: string) => void;
}) {
  const { data: seeds, isLoading } = useAdSeeds(
    'open',
    typeFilter === 'ALL' ? undefined : typeFilter
  );

  return (
    <div>
      {/* Type filter pills */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4 pb-3">
        {SEED_TYPES.map(({ value, label, icon }) => (
          <button
            key={value}
            onClick={() => setTypeFilter(value)}
            className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              typeFilter === value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* How it works */}
      <section className="mb-6">
        <HowItWorksCard />
      </section>

      {/* Seed list */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !seeds || seeds.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-xl">
          <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No open seeds yet</p>
          <p className="text-sm mt-1 mb-4">Be the first brand to plant a seed</p>
          <Link to="/adplacements/seeds/new">
            <Button variant="outline" size="sm" className="gap-1">
              <Plus className="w-4 h-4" />
              Plant a Seed
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {seeds.map((seed: any) => (
            <SeedCard key={seed.id} seed={seed} />
          ))}
        </div>
      )}
    </div>
  );
}

function SeedCard({ seed }: { seed: any }) {
  const color = SEED_TYPE_COLORS[seed.seedType] ?? '';
  const remaining = seed.maxPlacements - (seed.approvedPlacements || 0);
  const deadline = new Date(seed.deadline);
  const daysLeft = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86400000));

  return (
    <Link to="/adplacements/seeds/$seedId" params={{ seedId: seed.id }}>
      <Card className="hover:border-primary/30 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{seed.title}</p>
              <p className="text-xs text-muted-foreground">{seed.brandName}</p>
            </div>
            <Badge className={`text-xs shrink-0 ml-2 ${color}`}>{seed.seedType}</Badge>
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{seed.description}</p>

          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-green-400">
              <Coins className="w-3.5 h-3.5" />
              {seed.rewardPerPlacement} $LOAR
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Film className="w-3.5 h-3.5" />
              {remaining} left
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {daysLeft}d
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function HowItWorksCard() {
  const steps = [
    {
      icon: <Sparkles className="w-4 h-4" />,
      text: 'Brand plants a seed — creative + bounty budget',
    },
    { icon: <Eye className="w-4 h-4" />, text: 'Filmmakers browse and pick seeds to place' },
    { icon: <Film className="w-4 h-4" />, text: 'Place the ad in your film and submit proof' },
    { icon: <Trophy className="w-4 h-4" />, text: 'Brand approves — $LOAR released to filmmaker' },
  ];

  return (
    <Card className="bg-primary/5 border-primary/20">
      <CardHeader className="pb-2 pt-4 px-4">
        <h3 className="text-sm font-semibold">How Seed Dance Works</h3>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="space-y-2.5">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2.5 text-sm">
              <div className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                {step.icon}
              </div>
              <span className="text-muted-foreground pt-0.5">{step.text}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MySeedsTab() {
  const { isConnected } = useWalletAuth();
  const isAutoConnecting = false; // thirdweb removed — Circle DCW always instant
  const { data: seeds, isLoading } = useMyAdSeeds();

  if (isAutoConnecting) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Connect your wallet</p>
        <p className="text-sm mt-1">to manage your ad seeds</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!seeds || seeds.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No seeds planted</p>
        <p className="text-sm mt-1 mb-4">Create your first ad seed to attract filmmakers</p>
        <Link to="/adplacements/seeds/new">
          <Button variant="outline" size="sm" className="gap-1">
            <Plus className="w-4 h-4" />
            Plant a Seed
          </Button>
        </Link>
      </div>
    );
  }

  const open = seeds.filter((s: any) => s.status === 'open');
  const closed = seeds.filter((s: any) => s.status !== 'open');

  return (
    <div className="space-y-6">
      {open.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            Active Seeds
          </h2>
          <div className="space-y-3">
            {open.map((s: any) => (
              <MySeedCard key={s.id} seed={s} />
            ))}
          </div>
        </section>
      )}
      {closed.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3 flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-4 h-4" />
            Closed
          </h2>
          <div className="space-y-3">
            {closed.map((s: any) => (
              <MySeedCard key={s.id} seed={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MySeedCard({ seed }: { seed: any }) {
  const approved = seed.approvedPlacements || 0;
  const total = seed.maxPlacements || 1;
  const pct = Math.round((approved / total) * 100);
  const spent = approved * (seed.rewardPerPlacement || 0);

  return (
    <Link to="/adplacements/seeds/$seedId" params={{ seedId: seed.id }}>
      <Card className="hover:border-primary/30 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="font-medium text-sm">{seed.title}</p>
              <p className="text-xs text-muted-foreground">{seed.brandName}</p>
            </div>
            <Badge variant={seed.status === 'open' ? 'default' : 'secondary'} className="text-xs">
              {seed.status}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Placements</p>
              <p className="text-sm font-semibold">
                {approved}/{total}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-sm font-semibold">{seed.activePlacements || 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Spent</p>
              <p className="text-sm font-semibold">{spent} $LOAR</p>
            </div>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{pct}% filled</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function MyGigsTab() {
  const { isConnected } = useWalletAuth();
  const isAutoConnecting = false; // thirdweb removed — Circle DCW always instant
  const { data: placements, isLoading } = useMyAdSeedPlacements();

  if (isAutoConnecting) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Film className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Connect your wallet</p>
        <p className="text-sm mt-1">to view your placement gigs</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!placements || placements.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Film className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No placements yet</p>
        <p className="text-sm mt-1 mb-4">
          Browse seeds and earn $LOAR by placing ads in your films
        </p>
        <Link to="/adplacements/seeds">
          <Button variant="outline" size="sm" className="gap-1">
            Browse Seeds
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>
    );
  }

  const STATUS_ICONS: Record<string, React.ReactNode> = {
    pending: <Clock className="w-4 h-4 text-yellow-400" />,
    approved: <CheckCircle2 className="w-4 h-4 text-green-400" />,
    rejected: <XCircle className="w-4 h-4 text-red-400" />,
  };

  return (
    <div className="space-y-3">
      {placements.map((p: any) => (
        <Card key={p.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {p.episodeTitle || `Placement #${p.id.slice(0, 8)}`}
                </p>
                <p className="text-xs text-muted-foreground">Seed #{p.seedId?.slice(0, 8)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {STATUS_ICONS[p.status] ?? null}
                <Badge
                  variant={p.status === 'approved' ? 'default' : 'secondary'}
                  className="text-xs capitalize"
                >
                  {p.status}
                </Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-green-400 flex items-center gap-1">
                <Coins className="w-3 h-3" />
                {p.reward} $LOAR
              </span>
              {p.status === 'approved' && (
                <Badge variant="outline" className="text-xs text-green-400 border-green-500/20">
                  Paid
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
