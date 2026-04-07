/**
 * Ads Hub — Browse open ad slots (advertisers) + view active sponsorships
 *
 * Tabs:
 *   Browse  — all open slots across the platform, filterable by placement type
 *   Campaigns — advertiser's active sponsorships with impression stats
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Megaphone,
  Tv2,
  Package,
  User,
  Volume2,
  Plus,
  TrendingUp,
  Eye,
  Film,
  Loader2,
  ArrowRight,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useAdSlots, useMySponsorships } from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { formatEther } from 'viem';

export const Route = createFileRoute('/ads/')({
  component: AdsHubPage,
});

const PLACEMENT_TYPES = [
  { value: 'ALL', label: 'All Types', icon: <Megaphone className="w-4 h-4" /> },
  { value: 'BILLBOARD', label: 'Billboard', icon: <Tv2 className="w-4 h-4" /> },
  { value: 'PRODUCT', label: 'Product', icon: <Package className="w-4 h-4" /> },
  { value: 'SPONSORED_CHARACTER', label: 'Character', icon: <User className="w-4 h-4" /> },
  { value: 'AUDIO_MENTION', label: 'Audio', icon: <Volume2 className="w-4 h-4" /> },
] as const;

const PLACEMENT_COLORS: Record<string, string> = {
  BILLBOARD: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  PRODUCT: 'bg-green-500/10 text-green-400 border-green-500/20',
  SPONSORED_CHARACTER: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  AUDIO_MENTION: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

type Tab = 'browse' | 'campaigns';

// We load a platform-wide view by using a sentinel universe ID that the server
// will interpret as "all universes". For now we query a known sample universe
// and supplement with the user's own campaigns.
const PLATFORM_UNIVERSE_ID = '__platform__';

function AdsHubPage() {
  const { isConnected } = useWalletAuth();
  const [tab, setTab] = useState<Tab>('browse');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const { data: sponsorships, isLoading: loadingCampaigns } = useMySponsorships();

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-b from-primary/10 to-background px-4 pt-6 pb-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Megaphone className="w-6 h-6 text-primary" />
                Ad Placements
              </h1>
              <p className="text-sm text-muted-foreground">
                Sponsor AI-generated universes with your brand
              </p>
            </div>
            {isConnected && (
              <Link to="/ads/new">
                <Button size="sm" className="gap-1">
                  <Plus className="w-4 h-4" />
                  Create Slot
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b">
          {(['browse', 'campaigns'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'browse' ? 'Browse Slots' : 'My Campaigns'}
              {t === 'campaigns' && (sponsorships?.length ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {sponsorships!.length}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* Browse tab */}
        {tab === 'browse' && (
          <BrowseTab typeFilter={typeFilter} setTypeFilter={setTypeFilter} />
        )}

        {/* Campaigns tab */}
        {tab === 'campaigns' && (
          <CampaignsTab
            sponsorships={sponsorships ?? []}
            isLoading={loadingCampaigns}
            isConnected={isConnected}
          />
        )}
      </div>
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
  // Slots are per-universe; for the hub we show a placeholder callout
  // and direct users to per-universe shop pages for the actual bid flow.
  // Deep-linking from /shop/$universeId will render the ad slots for that universe.
  return (
    <div>
      {/* Type filter pills */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4 pb-3">
        {PLACEMENT_TYPES.map(({ value, label, icon }) => (
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

      {/* Placement type showcase */}
      <section>
        <h2 className="font-semibold mb-3">Placement Types</h2>
        <div className="grid grid-cols-2 gap-3">
          {PLACEMENT_TYPES.filter((p) => p.value !== 'ALL').map(({ value, label, icon }) => (
            <PlacementTypeCard
              key={value}
              type={value}
              label={label}
              icon={icon}
              active={typeFilter === 'ALL' || typeFilter === value}
            />
          ))}
        </div>

        <div className="mt-6 p-4 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
          <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium mb-1">Find slots inside universe shops</p>
          <p className="text-xs mb-3">
            Visit any universe's storefront to see open ad slots and place bids.
          </p>
          <Link to="/market">
            <Button variant="outline" size="sm" className="gap-1">
              Browse Universes
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}

function PlacementTypeCard({
  type,
  label,
  icon,
  active,
}: {
  type: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  const DESCRIPTIONS: Record<string, string> = {
    BILLBOARD: 'Visual banner shown during episodes',
    PRODUCT: 'Brand product featured in the narrative',
    SPONSORED_CHARACTER: 'Character co-created with your brand',
    AUDIO_MENTION: 'Brand mentioned in the audio track',
  };
  const color = PLACEMENT_COLORS[type] ?? '';

  return (
    <Card className={`transition-opacity ${active ? 'opacity-100' : 'opacity-40'}`}>
      <CardContent className="p-3">
        <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border mb-2 ${color}`}>
          {icon}
          {label}
        </div>
        <p className="text-xs text-muted-foreground">{DESCRIPTIONS[type]}</p>
      </CardContent>
    </Card>
  );
}

function HowItWorksCard() {
  const steps = [
    { icon: <Megaphone className="w-4 h-4" />, text: 'Creator opens a slot on their universe' },
    { icon: <TrendingUp className="w-4 h-4" />, text: 'Advertisers bid — highest bid wins' },
    { icon: <Film className="w-4 h-4" />, text: 'Winning brand appears across N episodes' },
    { icon: <Eye className="w-4 h-4" />, text: 'Impressions tracked per episode automatically' },
  ];

  return (
    <Card className="bg-primary/5 border-primary/20">
      <CardHeader className="pb-2 pt-4 px-4">
        <h3 className="text-sm font-semibold">How Ad Placements Work</h3>
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

function CampaignsTab({
  sponsorships,
  isLoading,
  isConnected,
}: {
  sponsorships: any[];
  isLoading: boolean;
  isConnected: boolean;
}) {
  if (!isConnected) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Connect your wallet</p>
        <p className="text-sm mt-1">to view your active campaigns</p>
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

  if (sponsorships.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No active campaigns</p>
        <p className="text-sm mt-1 mb-4">Win a slot auction to run your first campaign</p>
        <Link to="/market">
          <Button variant="outline" size="sm">Browse Universes</Button>
        </Link>
      </div>
    );
  }

  const active = sponsorships.filter((s) => s.active);
  const ended = sponsorships.filter((s) => !s.active);

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            Active
          </h2>
          <div className="space-y-3">
            {active.map((s) => <SponsorshipCard key={s.id} s={s} />)}
          </div>
        </section>
      )}
      {ended.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3 flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-4 h-4" />
            Ended
          </h2>
          <div className="space-y-3">
            {ended.map((s) => <SponsorshipCard key={s.id} s={s} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function SponsorshipCard({ s }: { s: any }) {
  const paidEth = s.totalPaid ? formatEther(BigInt(s.totalPaid)) : '0';
  const progressPct =
    s.episodesRemaining != null && s.episodesRemaining + s.impressions > 0
      ? Math.round((s.impressions / (s.impressions + s.episodesRemaining)) * 100)
      : 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="font-medium text-sm">Universe #{s.universeId?.slice(0, 8) ?? '—'}</p>
            <p className="text-xs text-muted-foreground">Slot #{s.slotId?.slice(0, 8) ?? '—'}</p>
          </div>
          <Badge variant={s.active ? 'default' : 'secondary'} className="text-xs">
            {s.active ? 'Active' : 'Ended'}
          </Badge>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Stat label="Spent" value={`${parseFloat(paidEth).toFixed(4)} ETH`} />
          <Stat label="Impressions" value={String(s.impressions ?? 0)} />
          <Stat label="Episodes Left" value={String(s.episodesRemaining ?? 0)} />
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">{progressPct}% complete</p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
