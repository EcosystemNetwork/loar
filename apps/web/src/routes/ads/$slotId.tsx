/**
 * Ad Slot Detail
 *
 * Two modes depending on who is viewing:
 *   Advertiser  — see placement specs, current bid, place a higher bid
 *   Creator     — see all bids ranked, accept the winning bid
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ArrowLeft,
  Tv2,
  Package,
  User,
  Volume2,
  TrendingUp,
  CheckCircle,
  Loader2,
  Gavel,
  Eye,
  Film,
  Info,
  Crown,
  Trophy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useAdBids,
  usePlaceBid,
  useAcceptBid,
} from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { formatEther, parseEther } from 'viem';

export const Route = createFileRoute('/ads/$slotId')({
  component: SlotDetailPage,
});

const PLACEMENT_ICONS: Record<string, React.ReactNode> = {
  BILLBOARD: <Tv2 className="w-5 h-5" />,
  PRODUCT: <Package className="w-5 h-5" />,
  SPONSORED_CHARACTER: <User className="w-5 h-5" />,
  AUDIO_MENTION: <Volume2 className="w-5 h-5" />,
};

const PLACEMENT_LABELS: Record<string, string> = {
  BILLBOARD: 'Billboard',
  PRODUCT: 'Product Placement',
  SPONSORED_CHARACTER: 'Sponsored Character',
  AUDIO_MENTION: 'Audio Mention',
};

// The slot data comes from the parent route's search params (passed via Link state)
// or re-fetched. We use search params to avoid an extra round-trip.
interface SlotSearch {
  universeId?: string;
  placementType?: string;
  minBid?: string;
  currentBid?: string;
  currentBidder?: string;
  description?: string;
  constraints?: string;
  episodes?: number;
  creatorUid?: string;
  active?: boolean;
}

export function SlotDetailPage() {
  const { slotId } = Route.useParams();
  const search = Route.useSearch() as SlotSearch;
  const navigate = useNavigate();
  const { user, isConnected } = useWalletAuth();

  const { data: bids, isLoading: bidsLoading } = useAdBids(slotId);
  const placeBid = usePlaceBid();
  const acceptBid = useAcceptBid();

  const [bidEth, setBidEth] = useState('');
  const [brandName, setBrandName] = useState('');
  const [creativeUrl, setCreativeUrl] = useState('');
  const [showBidForm, setShowBidForm] = useState(false);

  const isCreator = !!user?.uid && user.uid === search.creatorUid;
  const currentBidWei = search.currentBid ?? '0';
  const minBidWei = search.minBid ?? '0';
  const currentBidEth = parseFloat(formatEther(BigInt(currentBidWei)));
  const minBidEth = parseFloat(formatEther(BigInt(minBidWei)));
  const floorEth = Math.max(currentBidEth, minBidEth);

  const sortedBids = [...(bids ?? [])].sort((a, b) =>
    Number(BigInt(b.amount) - BigInt(a.amount))
  );
  const topBid = sortedBids[0];

  async function handleBid() {
    if (!isConnected) { toast.error('Connect your wallet'); return; }
    if (!brandName.trim()) { toast.error('Enter your brand name'); return; }
    const amt = parseFloat(bidEth);
    if (!amt || amt <= floorEth) {
      toast.error(`Bid must be above ${floorEth.toFixed(4)} ETH`);
      return;
    }
    try {
      const weiAmount = parseEther(bidEth as `${number}`).toString();
      // In production the ETH transfer happens via the AdPlacement.sol contract.
      // Here we record the off-chain bid + txHash would come from the wallet tx.
      await placeBid.mutateAsync({
        slotId,
        amount: weiAmount,
        txHash: '0x' + Math.random().toString(16).slice(2).padEnd(64, '0'), // placeholder
        brandName: brandName.trim(),
        creativeUrl: creativeUrl.trim() || undefined,
      });
      toast.success('Bid placed!');
      setShowBidForm(false);
      setBidEth('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to place bid');
    }
  }

  async function handleAccept() {
    if (!isConnected) { toast.error('Connect your wallet'); return; }
    try {
      await acceptBid.mutateAsync({ slotId });
      toast.success('Bid accepted — sponsorship is now active!');
      navigate({ to: '/ads/' });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to accept bid');
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate({ to: '/ads/' })}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <p className="font-semibold text-sm">Ad Slot</p>
          <p className="text-xs text-muted-foreground">#{slotId.slice(0, 12)}…</p>
        </div>
        {search.active !== false ? (
          <Badge variant="default" className="text-xs">Open</Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">Closed</Badge>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Placement type banner */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                {PLACEMENT_ICONS[search.placementType ?? ''] ?? <Gavel className="w-5 h-5" />}
              </div>
              <div>
                <p className="font-semibold">
                  {PLACEMENT_LABELS[search.placementType ?? ''] ?? search.placementType ?? 'Ad Slot'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Universe #{search.universeId?.slice(0, 10) ?? '—'}
                </p>
              </div>
            </div>

            {search.description && (
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                {search.description}
              </p>
            )}

            {search.constraints && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Constraints: </span>
                {search.constraints}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            icon={<TrendingUp className="w-4 h-4 text-primary" />}
            label="Floor"
            value={`${minBidEth.toFixed(4)} ETH`}
          />
          <StatCard
            icon={<Crown className="w-4 h-4 text-yellow-400" />}
            label="Top Bid"
            value={currentBidEth > 0 ? `${currentBidEth.toFixed(4)} ETH` : 'No bids'}
          />
          <StatCard
            icon={<Film className="w-4 h-4 text-blue-400" />}
            label="Episodes"
            value={String(search.episodes ?? '—')}
          />
        </div>

        <Separator />

        {/* Bid list */}
        <section>
          <h2 className="font-semibold mb-3 flex items-center gap-1.5">
            <Gavel className="w-4 h-4" />
            Bids
            {(sortedBids.length > 0) && (
              <Badge variant="secondary" className="text-xs ml-1">{sortedBids.length}</Badge>
            )}
          </h2>

          {bidsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : sortedBids.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-xl">
              <Gavel className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No bids yet — be the first</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedBids.map((bid: any, i: number) => (
                <BidRow
                  key={bid.id}
                  bid={bid}
                  rank={i}
                  isCreator={isCreator}
                  isTopBid={i === 0}
                  onAccept={handleAccept}
                  accepting={acceptBid.isPending}
                />
              ))}
            </div>
          )}
        </section>

        {/* Creator — accept top bid CTA */}
        {isCreator && topBid && !showBidForm && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Ready to accept?</p>
                <p className="text-xs text-muted-foreground">
                  Top bid: {parseFloat(formatEther(BigInt(topBid.amount))).toFixed(4)} ETH by{' '}
                  {topBid.brandName}
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleAccept}
                disabled={acceptBid.isPending}
                className="gap-1"
              >
                {acceptBid.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="w-3.5 h-3.5" />
                )}
                Accept
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Advertiser — place bid */}
        {!isCreator && search.active !== false && (
          <section>
            <h2 className="font-semibold mb-3 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              Place a Bid
            </h2>

            {!showBidForm ? (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setShowBidForm(true)}
                disabled={!isConnected}
              >
                {isConnected ? 'Place a Bid' : 'Connect Wallet to Bid'}
              </Button>
            ) : (
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="rounded-lg bg-muted/50 px-3 py-2 flex gap-2 text-xs text-muted-foreground">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-400" />
                    Your bid must exceed {floorEth.toFixed(4)} ETH. If outbid, your ETH is
                    automatically refunded by the smart contract.
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bidAmt">Bid amount (ETH) *</Label>
                    <div className="relative">
                      <Input
                        id="bidAmt"
                        type="number"
                        step="0.001"
                        min={floorEth + 0.001}
                        placeholder={`> ${floorEth.toFixed(4)}`}
                        value={bidEth}
                        onChange={(e) => setBidEth(e.target.value)}
                        className="pr-14"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        ETH
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="brand">Brand name *</Label>
                    <Input
                      id="brand"
                      placeholder="ACME Corp"
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="creative">Creative URL (optional)</Label>
                    <Input
                      id="creative"
                      placeholder="Link to logo, brief, or brand kit"
                      value={creativeUrl}
                      onChange={(e) => setCreativeUrl(e.target.value)}
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setShowBidForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleBid}
                      disabled={placeBid.isPending}
                    >
                      {placeBid.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Gavel className="w-4 h-4 mr-2" />
                      )}
                      Submit Bid
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {/* Impression tracking note */}
        <Card className="bg-muted/30 border-muted">
          <CardContent className="p-3 flex gap-2.5">
            <Eye className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Impressions are recorded automatically each time the platform generates an episode for
              this universe. The sponsorship ends when the episode count reaches zero.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <div className="flex justify-center mb-1">{icon}</div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold mt-0.5">{value}</p>
      </CardContent>
    </Card>
  );
}

function BidRow({
  bid,
  rank,
  isCreator,
  isTopBid,
  onAccept,
  accepting,
}: {
  bid: any;
  rank: number;
  isCreator: boolean;
  isTopBid: boolean;
  onAccept: () => void;
  accepting: boolean;
}) {
  const ethAmt = parseFloat(formatEther(BigInt(bid.amount))).toFixed(4);

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
        isTopBid ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-border'
      }`}
    >
      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-muted text-muted-foreground">
        {isTopBid ? <Trophy className="w-3.5 h-3.5 text-yellow-400" /> : `#${rank + 1}`}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{bid.brandName}</p>
        <p className="text-xs text-muted-foreground">{ethAmt} ETH</p>
      </div>
      {isCreator && isTopBid && (
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 gap-1 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
          onClick={onAccept}
          disabled={accepting}
        >
          {accepting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
          Accept
        </Button>
      )}
    </div>
  );
}
