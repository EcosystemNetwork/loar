/**
 * Ad Seed Detail — View seed details, placements, and submit/approve placements.
 *
 * Two modes:
 *   Filmmaker   — see seed details, creative assets, submit a placement
 *   Advertiser  — see all placements, approve/reject each one
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Coins,
  Film,
  ExternalLink,
  Info,
  Image,
  Package,
  User,
  Volume2,
  Tv2,
  BookOpen,
  Trophy,
  Send,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useAdSeed,
  useAdSeedPlacements,
  useSubmitAdSeedPlacement,
  useApproveAdSeedPlacement,
  useRejectAdSeedPlacement,
} from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';

export const Route = createFileRoute('/adplacements/seeds/$seedId')({
  component: SeedDetailPage,
});

const SEED_TYPE_ICONS: Record<string, React.ReactNode> = {
  LOGO: <Image className="w-5 h-5" />,
  PRODUCT: <Package className="w-5 h-5" />,
  CHARACTER: <User className="w-5 h-5" />,
  AUDIO: <Volume2 className="w-5 h-5" />,
  BILLBOARD: <Tv2 className="w-5 h-5" />,
  NARRATIVE: <BookOpen className="w-5 h-5" />,
};

const SEED_TYPE_LABELS: Record<string, string> = {
  LOGO: 'Logo Placement',
  PRODUCT: 'Product Placement',
  CHARACTER: 'Sponsored Character',
  AUDIO: 'Audio Mention',
  BILLBOARD: 'Visual Billboard',
  NARRATIVE: 'Narrative Integration',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-500/10 text-green-400 border-green-500/20',
  paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  exhausted: 'bg-muted text-muted-foreground border-border',
  expired: 'bg-red-500/10 text-red-400 border-red-500/20',
};

function SeedDetailPage() {
  const { seedId } = Route.useParams();
  const navigate = useNavigate();
  const { address, isConnected } = useWalletAuth();

  const { data: seed, isLoading: seedLoading } = useAdSeed(seedId);
  const { data: placements, isLoading: placementsLoading } = useAdSeedPlacements(seedId);
  const submitPlacement = useSubmitAdSeedPlacement();
  const approvePlacement = useApproveAdSeedPlacement();
  const rejectPlacement = useRejectAdSeedPlacement();

  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [contentUrl, setContentUrl] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timestamp, setTimestamp] = useState('');

  if (seedLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!seed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center px-4">
        <Sparkles className="w-12 h-12 mb-3 text-muted-foreground opacity-30" />
        <p className="font-semibold mb-1">Seed not found</p>
        <p className="text-sm text-muted-foreground mb-4">
          This ad seed may have been removed or doesn't exist.
        </p>
        <Button variant="outline" onClick={() => navigate({ to: '/adplacements/seeds' })}>
          Back to Seeds
        </Button>
      </div>
    );
  }

  const isAdvertiser = !!address && address.toLowerCase() === seed.advertiserUid?.toLowerCase();
  const remaining = (seed.maxPlacements || 0) - (seed.approvedPlacements || 0);
  const deadline = new Date(seed.deadline);
  const daysLeft = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86400000));
  const isExpired = deadline < new Date();
  const pct = seed.maxPlacements
    ? Math.round(((seed.approvedPlacements || 0) / seed.maxPlacements) * 100)
    : 0;

  const pendingPlacements = (placements ?? []).filter((p: any) => p.status === 'pending');
  const approvedPlacements = (placements ?? []).filter((p: any) => p.status === 'approved');
  const rejectedPlacements = (placements ?? []).filter((p: any) => p.status === 'rejected');

  async function handleSubmit() {
    if (!isConnected) {
      toast.error('Connect your wallet');
      return;
    }
    if (!contentUrl.trim()) {
      toast.error('Provide a link to your film');
      return;
    }
    if (!description.trim()) {
      toast.error('Describe how you placed the ad');
      return;
    }
    try {
      await submitPlacement.mutateAsync({
        seedId,
        contentUrl: contentUrl.trim(),
        episodeTitle: episodeTitle.trim() || undefined,
        description: description.trim(),
        timestamp: timestamp.trim() || undefined,
      });
      toast.success('Placement submitted! The advertiser will review it.');
      setShowSubmitForm(false);
      setContentUrl('');
      setEpisodeTitle('');
      setDescription('');
      setTimestamp('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to submit placement');
    }
  }

  async function handleApprove(placementId: string) {
    try {
      await approvePlacement.mutateAsync({ placementId });
      toast.success('Placement approved! $LOAR released.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to approve');
    }
  }

  async function handleReject(placementId: string) {
    try {
      await rejectPlacement.mutateAsync({ placementId, reason: 'Does not meet guidelines' });
      toast.success('Placement rejected.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to reject');
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate({ to: '/adplacements/seeds' })}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <p className="font-semibold text-sm">Seed Detail</p>
          <p className="text-xs text-muted-foreground">#{seedId.slice(0, 12)}</p>
        </div>
        <Badge className={`text-xs ${STATUS_COLORS[seed.status] ?? ''}`}>{seed.status}</Badge>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Seed info card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                {SEED_TYPE_ICONS[seed.seedType ?? ''] ?? <Sparkles className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{seed.title}</p>
                <p className="text-xs text-muted-foreground">{seed.brandName}</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed mb-3">{seed.description}</p>

            <Badge variant="outline" className="text-xs mb-3">
              {SEED_TYPE_LABELS[seed.seedType ?? ''] ?? seed.seedType}
            </Badge>

            {seed.creativeUrl && (
              <a
                href={seed.creativeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline mb-3"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Creative Assets
              </a>
            )}

            {seed.guidelines && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground mb-3">
                <span className="font-medium text-foreground">Guidelines: </span>
                {seed.guidelines}
              </div>
            )}

            {seed.targetGenres?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {seed.targetGenres.map((g: string) => (
                  <Badge key={g} variant="secondary" className="text-xs">
                    {g}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          <StatCard
            icon={<Coins className="w-4 h-4 text-green-400" />}
            label="Reward"
            value={`${seed.rewardPerPlacement} $LOAR`}
          />
          <StatCard
            icon={<Film className="w-4 h-4 text-blue-400" />}
            label="Remaining"
            value={String(remaining)}
          />
          <StatCard
            icon={<Trophy className="w-4 h-4 text-yellow-400" />}
            label="Approved"
            value={String(seed.approvedPlacements || 0)}
          />
          <StatCard
            icon={<Clock className="w-4 h-4 text-muted-foreground" />}
            label="Days Left"
            value={isExpired ? 'Expired' : `${daysLeft}d`}
          />
        </div>

        {/* Progress bar */}
        <div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {seed.approvedPlacements || 0} of {seed.maxPlacements} placements filled ({pct}%)
          </p>
        </div>

        <Separator />

        {/* Placements list */}
        <section>
          <h2 className="font-semibold mb-3 flex items-center gap-1.5">
            <Eye className="w-4 h-4" />
            Placements
            {(placements?.length ?? 0) > 0 && (
              <Badge variant="secondary" className="text-xs ml-1">
                {placements!.length}
              </Badge>
            )}
          </h2>

          {placementsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !placements || placements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-xl">
              <Film className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No placements yet — be the first</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingPlacements.length > 0 && (
                <PlacementGroup
                  title="Pending Review"
                  icon={<Clock className="w-4 h-4 text-yellow-400" />}
                  placements={pendingPlacements}
                  isAdvertiser={isAdvertiser}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  approving={approvePlacement.isPending}
                  rejecting={rejectPlacement.isPending}
                />
              )}
              {approvedPlacements.length > 0 && (
                <PlacementGroup
                  title="Approved"
                  icon={<CheckCircle className="w-4 h-4 text-green-400" />}
                  placements={approvedPlacements}
                  isAdvertiser={isAdvertiser}
                />
              )}
              {rejectedPlacements.length > 0 && (
                <PlacementGroup
                  title="Rejected"
                  icon={<XCircle className="w-4 h-4 text-red-400" />}
                  placements={rejectedPlacements}
                  isAdvertiser={isAdvertiser}
                />
              )}
            </div>
          )}
        </section>

        {/* Filmmaker — submit placement */}
        {!isAdvertiser && seed.status === 'open' && !isExpired && remaining > 0 && (
          <section>
            <h2 className="font-semibold mb-3 flex items-center gap-1.5">
              <Send className="w-4 h-4" />
              Submit Placement
            </h2>

            {!showSubmitForm ? (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setShowSubmitForm(true)}
                disabled={!isConnected}
              >
                {isConnected ? 'I placed this ad — submit proof' : 'Connect wallet to submit'}
              </Button>
            ) : (
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="rounded-lg bg-muted/50 px-3 py-2 flex gap-2 text-xs text-muted-foreground">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-400" />
                    Show the advertiser where their ad appears in your film. The more context you
                    provide, the faster they'll approve.
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contentUrl">Film / Episode URL *</Label>
                    <Input
                      id="contentUrl"
                      placeholder="Link to your film or episode"
                      value={contentUrl}
                      onChange={(e) => setContentUrl(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="episodeTitle">Episode Title (optional)</Label>
                    <Input
                      id="episodeTitle"
                      placeholder="e.g. Episode 3: The Heist"
                      value={episodeTitle}
                      onChange={(e) => setEpisodeTitle(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="placementDesc">How did you place the ad? *</Label>
                    <Textarea
                      id="placementDesc"
                      placeholder="Describe where and how the brand appears in your film..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="timestamp">Timestamp (optional)</Label>
                    <Input
                      id="timestamp"
                      placeholder="e.g. 1:23 - 1:45"
                      value={timestamp}
                      onChange={(e) => setTimestamp(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      When does the ad appear? Helps the advertiser find it quickly.
                    </p>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setShowSubmitForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleSubmit}
                      disabled={submitPlacement.isPending}
                    >
                      {submitPlacement.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Send className="w-4 h-4 mr-2" />
                      )}
                      Submit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {/* Expired / exhausted notice */}
        {(isExpired || seed.status === 'exhausted') && (
          <Card className="border-yellow-500/20 bg-yellow-500/5">
            <CardContent className="p-3 flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-300">
                {seed.status === 'exhausted'
                  ? 'All placement slots have been filled.'
                  : 'This seed has expired and is no longer accepting placements.'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Advertiser CTA */}
        {isAdvertiser && pendingPlacements.length > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 text-center">
              <p className="text-sm font-medium">
                {pendingPlacements.length} placement{pendingPlacements.length > 1 ? 's' : ''}{' '}
                waiting for your review
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Approve to release $LOAR to the filmmaker
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-2.5 text-center">
        <div className="flex justify-center mb-1">{icon}</div>
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-xs font-semibold mt-0.5">{value}</p>
      </CardContent>
    </Card>
  );
}

function PlacementGroup({
  title,
  icon,
  placements,
  isAdvertiser,
  onApprove,
  onReject,
  approving,
  rejecting,
}: {
  title: string;
  icon: React.ReactNode;
  placements: any[];
  isAdvertiser: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  approving?: boolean;
  rejecting?: boolean;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
        {icon}
        {title} ({placements.length})
      </h3>
      <div className="space-y-2">
        {placements.map((p: any) => (
          <PlacementRow
            key={p.id}
            placement={p}
            isAdvertiser={isAdvertiser}
            onApprove={onApprove}
            onReject={onReject}
            approving={approving}
            rejecting={rejecting}
          />
        ))}
      </div>
    </div>
  );
}

function PlacementRow({
  placement,
  isAdvertiser,
  onApprove,
  onReject,
  approving,
  rejecting,
}: {
  placement: any;
  isAdvertiser: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  approving?: boolean;
  rejecting?: boolean;
}) {
  const addr = placement.filmmaker
    ? `${placement.filmmaker.slice(0, 6)}...${placement.filmmaker.slice(-4)}`
    : 'Unknown';

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {placement.episodeTitle || `Placement by ${addr}`}
            </p>
            <p className="text-xs text-muted-foreground">{addr}</p>
          </div>
          <Badge
            variant={placement.status === 'approved' ? 'default' : 'secondary'}
            className="text-xs capitalize shrink-0 ml-2"
          >
            {placement.status}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{placement.description}</p>

        {placement.timestamp && (
          <p className="text-xs text-muted-foreground mb-2">
            <span className="font-medium text-foreground">Timestamp:</span> {placement.timestamp}
          </p>
        )}

        <a
          href={placement.contentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" />
          View Film
        </a>

        {placement.rejectionReason && (
          <p className="text-xs text-red-400 mt-2">Reason: {placement.rejectionReason}</p>
        )}

        {isAdvertiser && placement.status === 'pending' && onApprove && onReject && (
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-7 text-red-400 border-red-500/20 hover:bg-red-500/10"
              onClick={() => onReject(placement.id)}
              disabled={rejecting}
            >
              {rejecting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <XCircle className="w-3 h-3 mr-1" />
              )}
              Reject
            </Button>
            <Button
              size="sm"
              className="flex-1 text-xs h-7"
              onClick={() => onApprove(placement.id)}
              disabled={approving}
            >
              {approving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCircle className="w-3 h-3 mr-1" />
              )}
              Approve
            </Button>
          </div>
        )}

        {placement.status === 'approved' && (
          <div className="flex items-center gap-1 mt-2 text-xs text-green-400">
            <Coins className="w-3 h-3" />
            {placement.reward} $LOAR paid
          </div>
        )}
      </CardContent>
    </Card>
  );
}
