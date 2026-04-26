/**
 * RevenuePanel — Revenue management sidebar for universe creators
 * Integrates into the universe timeline view for quick access
 * to all monetization features
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DollarSign,
  Film,
  Users,
  Coins,
  Crown,
  ShoppingBag,
  BarChart3,
  Layers,
} from 'lucide-react';
import { BatchMintEpisodesDialog } from '@/components/BatchMintEpisodesDialog';
import {
  useEpisodeNFTs,
  useCreateEpisodeListing,
  useCanonSubmissions,
  useSubmitCanon,
  useCreditBalance,
  useUniverseSubStats,
  useUniverseMetrics,
} from '@/hooks/useRevenue';
import { useVocab } from '@/hooks/use-vocab';
import { Price } from '@/components/Price';

interface RevenuePanelProps {
  universeId: string;
  universeName?: string;
}

export function RevenuePanel({ universeId, universeName }: RevenuePanelProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <DollarSign className="w-4 h-4" />
          Revenue
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[500px] sm:w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Revenue Streams</SheetTitle>
          <SheetDescription>
            {universeName || `Universe ${universeId}`} — Manage all monetization
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="overview" className="text-xs">
              Overview
            </TabsTrigger>
            <TabsTrigger value="nft" className="text-xs">
              NFTs
            </TabsTrigger>
            <TabsTrigger value="canon" className="text-xs">
              Canon
            </TabsTrigger>
            <TabsTrigger value="subs" className="text-xs">
              Subs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <OverviewTab universeId={universeId} />
          </TabsContent>

          <TabsContent value="nft" className="space-y-4 mt-4">
            <NFTTab universeId={universeId} />
          </TabsContent>

          <TabsContent value="canon" className="space-y-4 mt-4">
            <CanonTab universeId={universeId} />
          </TabsContent>

          <TabsContent value="subs" className="space-y-4 mt-4">
            <SubsTab universeId={universeId} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function OverviewTab({ universeId }: { universeId: string }) {
  const { data: metrics } = useUniverseMetrics(universeId);
  const { data: episodes } = useEpisodeNFTs(universeId);
  const { data: subStats } = useUniverseSubStats(universeId);

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">Revenue Overview</h3>
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={<BarChart3 className="w-4 h-4" />}
          label="Views"
          value={(metrics as any)?.totalViews ?? 0}
        />
        <MetricCard
          icon={<Film className="w-4 h-4" />}
          label="Episodes"
          value={(episodes as any[])?.length ?? 0}
        />
        <MetricCard
          icon={<Crown className="w-4 h-4" />}
          label="Subscribers"
          value={(subStats as any)?.totalSubscribers ?? 0}
        />
        <MetricCard
          icon={<Coins className="w-4 h-4" />}
          label="Total Revenue"
          value={<Price wei={(metrics as any)?.totalRevenue ?? '0'} hideChain />}
        />
      </div>
    </div>
  );
}

function NFTTab({ universeId }: { universeId: string }) {
  const { data: episodes } = useEpisodeNFTs(universeId);
  const createListing = useCreateEpisodeListing();
  const [showForm, setShowForm] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Own Episodes</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setBatchOpen(true)}>
            <Layers className="h-3.5 w-3.5" />
            Batch
          </Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Create Listing'}
          </Button>
        </div>
      </div>

      <BatchMintEpisodesDialog
        universeId={universeId}
        open={batchOpen}
        onOpenChange={setBatchOpen}
      />

      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const formData = new FormData(form);
                await createListing.mutateAsync({
                  universeId,
                  nodeId: Number(formData.get('nodeId')),
                  contentHash: formData.get('contentHash') as string,
                  title: formData.get('title') as string,
                  description: formData.get('description') as string,
                  mediaUrl: formData.get('mediaUrl') as string,
                  mintPrice: formData.get('mintPrice') as string,
                  maxSupply: Number(formData.get('maxSupply') || 0),
                  metadataURI: '',
                });
                setShowForm(false);
              }}
            >
              <div className="space-y-2">
                <Input name="title" placeholder="Episode Title" required />
                <Textarea name="description" placeholder="Description" required />
                <Input name="nodeId" type="number" placeholder="Node ID" required />
                <Input name="contentHash" placeholder="Content Hash" required />
                <Input name="mediaUrl" placeholder="Media URL" required />
                <Input name="mintPrice" placeholder="Mint Price (wei)" required />
                <Input name="maxSupply" type="number" placeholder="Max Supply (0=unlimited)" />
                <Button type="submit" className="w-full" disabled={createListing.isPending}>
                  {createListing.isPending ? 'Creating...' : 'Create Listing'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {(episodes as any[])?.length ? (
        <div className="space-y-2">
          {(episodes as any[]).map((ep: any) => (
            <Card key={ep.id}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{ep.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {ep.minted} minted {ep.maxSupply > 0 ? `/ ${ep.maxSupply}` : ''}
                    </p>
                  </div>
                  <p className="text-sm font-mono">
                    <Price wei={ep.mintPrice} hideChain />
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No episodes listed yet</p>
      )}
    </div>
  );
}

function CanonTab({ universeId }: { universeId: string }) {
  const { data: submissions } = useCanonSubmissions(universeId, 'VOTING');
  const submitCanon = useSubmitCanon();
  const v = useVocab();

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">{v('canon-marketplace')}</h3>
      <p className="text-sm text-muted-foreground">
        Active submissions being voted on by {v('token-holders').toLowerCase()}
      </p>
      {(submissions as any[])?.length ? (
        <div className="space-y-2">
          {(submissions as any[]).map((sub: any) => (
            <Card key={sub.id}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{sub.title}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {sub.submissionType?.toLowerCase()}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="text-green-500">For: {sub.votesFor}</p>
                    <p className="text-red-500">Against: {sub.votesAgainst}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No active submissions</p>
      )}
    </div>
  );
}

function SubsTab({ universeId }: { universeId: string }) {
  const { data: stats } = useUniverseSubStats(universeId);

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Subscriptions</h3>
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={<Crown className="w-4 h-4" />}
          label="Total Subs"
          value={(stats as any)?.totalSubscribers ?? 0}
        />
        <MetricCard
          icon={<Users className="w-4 h-4" />}
          label="Tiers"
          value={(stats as any)?.availableTiers?.length ?? 0}
        />
      </div>
      {(stats as any)?.tierCounts &&
        Object.entries((stats as any).tierCounts).map(([tier, count]) => (
          <div key={tier} className="flex justify-between text-sm">
            <span>{tier}</span>
            <span className="font-mono">{count as number}</span>
          </div>
        ))}
    </div>
  );
}

// ---- Helpers ----

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground">{icon}</div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-bold">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatWei(wei: string): string {
  try {
    const num = Number(BigInt(wei)) / 1e18;
    return num.toFixed(4);
  } catch {
    return '0.0000';
  }
}
