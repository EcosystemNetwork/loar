/**
 * Bounty Detail Page — View bounty, submit work, award winner, cancel.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Target,
  Clock,
  Coins,
  Users,
  Trophy,
  Loader2,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Upload,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DirectUpload } from '@/components/DirectUpload';
import { toast } from 'sonner';
import { useStoryBountiesWrite } from '@/hooks/useStoryBounties';
import { keccak256, toHex, type Hex } from 'viem';

export const Route = createFileRoute('/bounties/$bountyId')({
  component: BountyDetailPage,
});

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-green-500/10 text-green-500 border-green-500/20',
  claimed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  cancelled: 'bg-red-500/10 text-red-500 border-red-500/20',
  expired: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

function BountyDetailPage() {
  const { bountyId } = Route.useParams();
  const { address } = useWalletAuth();
  const queryClient = useQueryClient();

  // Submit form state
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitDescription, setSubmitDescription] = useState('');
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedHash, setUploadedHash] = useState<string | null>(null);

  // Confirm dialogs
  const [showCancel, setShowCancel] = useState(false);
  const [awardingId, setAwardingId] = useState<string | null>(null);

  const {
    data: bountyRaw,
    isLoading,
    isError: bountyError,
  } = useQuery({
    queryKey: ['bounty', bountyId],
    queryFn: () => trpcClient.bounties.get.query({ bountyId }),
  });
  const bounty = bountyRaw as any;

  const {
    data: submissions,
    isLoading: subsLoading,
    isError: subsError,
  } = useQuery({
    queryKey: ['bounty-submissions', bountyId],
    queryFn: () => trpcClient.bounties.submissions.query({ bountyId }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bounty', bountyId] });
    queryClient.invalidateQueries({ queryKey: ['bounty-submissions', bountyId] });
    queryClient.invalidateQueries({ queryKey: ['bounties'] });
    queryClient.invalidateQueries({ queryKey: ['bounty-stats'] });
  };

  const submitMutation = useMutation({
    mutationFn: (data: {
      bountyId: string;
      contentUrl: string;
      contentHash?: string;
      description: string;
    }) => trpcClient.bounties.submit.mutate(data),
    onSuccess: () => {
      invalidate();
      setShowSubmit(false);
      setSubmitDescription('');
      setUploadedUrl(null);
      setUploadedHash(null);
      toast.success('Submission sent!');
    },
    onError: (err: any) => toast.error(err.message || 'Submission failed'),
  });

  const bountiesWrite = useStoryBountiesWrite();

  const awardMutation = useMutation({
    mutationFn: async (data: {
      bountyId: string;
      submissionId: string;
      onChainBountyId?: number | null;
      winnerAddress?: string | null;
      submissionUrl?: string | null;
    }) => {
      let txHash: string | undefined;
      // On-chain settle when the bounty has a numeric on-chain id and the
      // winner has a wallet address. Without these, fall through to the
      // off-chain-only canon write (server still records auto-canon).
      if (
        data.onChainBountyId != null &&
        Number.isFinite(data.onChainBountyId) &&
        data.winnerAddress &&
        /^0x[a-fA-F0-9]{40}$/.test(data.winnerAddress)
      ) {
        try {
          const submissionHash = data.submissionUrl
            ? keccak256(toHex(data.submissionUrl))
            : ('0x'.padEnd(66, '0') as Hex);
          txHash = await bountiesWrite.awardBounty({
            bountyId: BigInt(data.onChainBountyId),
            winner: data.winnerAddress as Hex,
            submissionHash,
          });
        } catch (err) {
          toast.error(`On-chain award failed: ${err instanceof Error ? err.message : 'unknown'}`);
          throw err;
        }
      }
      return trpcClient.bounties.award.mutate({
        bountyId: data.bountyId,
        submissionId: data.submissionId,
        ...(txHash ? { txHash } : {}),
      });
    },
    onSuccess: () => {
      invalidate();
      setAwardingId(null);
      toast.success('Bounty awarded!');
    },
    onError: (err: any) => toast.error(err.message || 'Award failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: async (data: { bountyId: string; onChainBountyId?: number | null }) => {
      let txHash: string | undefined;
      if (data.onChainBountyId != null && Number.isFinite(data.onChainBountyId)) {
        try {
          txHash = await bountiesWrite.cancelBounty({
            bountyId: BigInt(data.onChainBountyId),
          });
        } catch (err) {
          toast.error(`On-chain cancel failed: ${err instanceof Error ? err.message : 'unknown'}`);
          throw err;
        }
      }
      return trpcClient.bounties.cancel.mutate({
        bountyId: data.bountyId,
        ...(txHash ? { txHash } : {}),
      });
    },
    onSuccess: () => {
      invalidate();
      setShowCancel(false);
      toast.success('Bounty cancelled');
    },
    onError: (err: any) => toast.error(err.message || 'Cancel failed'),
  });

  if (bountyError || subsError) {
    return (
      <div className="p-8 text-center text-red-400">Failed to load bounty. Please try again.</div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!bounty) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Bounty not found</h2>
        <Link to="/bounties" search={{}}>
          <Button variant="outline">Back to Bounties</Button>
        </Link>
      </div>
    );
  }

  const isPoster = address?.toLowerCase() === bounty.poster?.toLowerCase();
  const isOpen = bounty.status === 'open';
  const isExpired = new Date(bounty.deadline) < new Date();
  const deadlineDate = new Date(bounty.deadline);
  const daysLeft = Math.max(0, Math.ceil((deadlineDate.getTime() - Date.now()) / 86400000));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Back nav */}
        <Link
          to="/bounties"
          search={{}}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Bounties
        </Link>

        {/* Bounty header */}
        <div className="flex flex-col md:flex-row gap-6 mb-8">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={STATUS_STYLES[bounty.status] || ''}>{bounty.status}</Badge>
              <Badge variant="outline" className="capitalize">
                {bounty.contentType}
              </Badge>
              {isOpen && isExpired && (
                <Badge variant="destructive" className="text-[10px]">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Past deadline
                </Badge>
              )}
            </div>
            <h1 className="text-2xl md:text-3xl font-bold mb-3">{bounty.title}</h1>
            <p className="text-muted-foreground whitespace-pre-wrap mb-4">{bounty.description}</p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {isOpen && !isExpired
                  ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`
                  : deadlineDate.toLocaleDateString()}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" /> {bounty.submissionCount || 0} submissions
              </span>
              <span className="font-mono text-xs">
                Posted by {bounty.poster?.slice(0, 6)}...{bounty.poster?.slice(-4)}
              </span>
            </div>
          </div>

          {/* Reward + actions sidebar */}
          <Card className="md:w-64 flex-shrink-0">
            <CardContent className="p-5 space-y-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-3xl font-bold text-primary">
                  <Coins className="h-7 w-7" />
                  {bounty.reward?.toLocaleString()}
                </div>
                <p className="text-sm text-muted-foreground">$LOAR Reward</p>
              </div>

              <Separator />

              {/* Submit work (non-poster, open bounty) */}
              {isOpen && !isExpired && !isPoster && address && (
                <Dialog open={showSubmit} onOpenChange={setShowSubmit}>
                  <DialogTrigger asChild>
                    <Button className="w-full gap-2">
                      <Upload className="h-4 w-4" /> Submit Work
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Submit to Bounty</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Upload Content</Label>
                        <div className="mt-1">
                          <DirectUpload
                            label="Drop your submission here"
                            onUploadComplete={(manifest, _previewUrl) => {
                              setUploadedUrl(manifest.uploads[0]?.url || '');
                              setUploadedHash(manifest.contentHash);
                            }}
                          />
                        </div>
                        {uploadedUrl && (
                          <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> File uploaded
                          </p>
                        )}
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Textarea
                          placeholder="Describe your submission..."
                          value={submitDescription}
                          onChange={(e) => setSubmitDescription(e.target.value)}
                          className="min-h-[80px]"
                        />
                      </div>
                      <Button
                        className="w-full"
                        disabled={!uploadedUrl || !submitDescription || submitMutation.isPending}
                        onClick={() =>
                          submitMutation.mutate({
                            bountyId,
                            contentUrl: uploadedUrl!,
                            contentHash: uploadedHash || undefined,
                            description: submitDescription,
                          })
                        }
                      >
                        {submitMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )}
                        Submit
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}

              {/* Not connected */}
              {isOpen && !isExpired && !address && (
                <p className="text-sm text-center text-muted-foreground">
                  Connect wallet to submit work
                </p>
              )}

              {/* Cancel (poster only, open) */}
              {isOpen && isPoster && (
                <Dialog open={showCancel} onOpenChange={setShowCancel}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" className="w-full gap-2">
                      <XCircle className="h-4 w-4" /> Cancel Bounty
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Cancel Bounty?</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground mb-4">
                      You will receive a refund minus a 2% cancellation fee. This cannot be undone.
                    </p>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={() => setShowCancel(false)}>
                        Keep Open
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={cancelMutation.isPending}
                        onClick={() =>
                          cancelMutation.mutate({
                            bountyId,
                            onChainBountyId: (bounty as any)?.onChainBountyId ?? null,
                          })
                        }
                      >
                        {cancelMutation.isPending && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        Confirm Cancel
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}

              {/* Winner badge */}
              {bounty.status === 'claimed' && bounty.claimedBy && (
                <div className="text-center">
                  <Trophy className="h-6 w-6 text-amber-500 mx-auto mb-1" />
                  <p className="text-sm font-medium">Awarded to</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {bounty.claimedBy.slice(0, 6)}...{bounty.claimedBy.slice(-4)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Submissions section */}
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5" />
            Submissions ({submissions?.length || 0})
          </h2>

          {subsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !submissions?.length ? (
            <Card>
              <CardContent className="text-center py-10">
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No submissions yet. Be the first!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {submissions.map((sub: any) => {
                const isWinner = bounty.winningSubmissionId === sub.id;
                const isSubmitter = address?.toLowerCase() === sub.submitter?.toLowerCase();

                return (
                  <Card
                    key={sub.id}
                    className={isWinner ? 'border-amber-500/50 bg-amber-500/5' : ''}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-sm">
                              {sub.submitter?.slice(0, 6)}...{sub.submitter?.slice(-4)}
                            </span>
                            {isWinner && (
                              <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">
                                <Trophy className="h-3 w-3 mr-1" /> Winner
                              </Badge>
                            )}
                            {isSubmitter && (
                              <Badge variant="outline" className="text-[10px]">
                                You
                              </Badge>
                            )}
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                sub.status === 'accepted'
                                  ? 'text-green-500 border-green-500/30'
                                  : sub.status === 'rejected'
                                    ? 'text-red-500 border-red-500/30'
                                    : ''
                              }`}
                            >
                              {sub.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{sub.description}</p>
                          {sub.contentUrl && (
                            <a
                              href={sub.contentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" /> View content
                            </a>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(sub.createdAt).toLocaleString()}
                          </p>
                        </div>

                        {/* Award button (poster only, open bounty, pending submission) */}
                        {isPoster && isOpen && sub.status === 'pending' && (
                          <div>
                            {awardingId === sub.id ? (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  disabled={awardMutation.isPending}
                                  onClick={() =>
                                    awardMutation.mutate({
                                      bountyId,
                                      submissionId: sub.id,
                                      onChainBountyId: (bounty as any)?.onChainBountyId ?? null,
                                      winnerAddress: (sub as any)?.submitter ?? null,
                                      submissionUrl: (sub as any)?.contentUrl ?? null,
                                    })
                                  }
                                >
                                  {awardMutation.isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    'Confirm'
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setAwardingId(null)}
                                >
                                  No
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                onClick={() => setAwardingId(sub.id)}
                              >
                                <Trophy className="h-3 w-3" /> Award
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
