/**
 * Canon Marketplace — submit content for universe canon and vote
 *
 * Tabs:
 *  - Voting: active submissions anyone can vote on
 *  - Accepted: locked canon entries
 *  - Submit: form to propose new canon (creator)
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  Gavel,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  Clock,
  Plus,
  Loader2,
  Send,
  BookOpen,
  Trophy,
  ShieldCheck,
  FileCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmTx } from '@/components/tx-confirm';
import { UserText } from '@/components/user-text';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useCanonSubmissions,
  useSubmitCanon,
  useVoteCanon,
  useCanon,
  useFinalizeCanon,
  useLicenseCanon,
} from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useVocab } from '@/hooks/use-vocab';
import { useUniverseAddresses } from '@/hooks/useUniverseAddresses';
import { TokenGateGuard } from '@/components/governance/TokenGateGuard';
import { useState } from 'react';
import { toast } from 'sonner';
import { useReadContract, useChainId, usePublicClient } from 'wagmi';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { canonMarketplaceAbi, governanceErc20Abi } from '@loar/abis/generated';
import { CanonMarketplace } from '@loar/abis/addresses';
import { formatEther, parseEther } from 'viem';

export const Route = createFileRoute('/canon/$universeId')({
  component: CanonPage,
});

const SUBMISSION_TYPES = [
  { value: 'CHARACTER', label: 'Character' },
  { value: 'PLOT_ARC', label: 'Plot Arc' },
  { value: 'LOCATION', label: 'Location' },
  { value: 'LORE_RULE', label: 'Lore Rule' },
] as const;

function CanonPage() {
  const { universeId } = useParams({ from: '/canon/$universeId' });
  const { isConnected, address } = useWalletAuth();
  const v = useVocab();
  const { tokenAddress } = useUniverseAddresses(universeId);

  const { data: voting, isLoading: loadingVoting } = useCanonSubmissions(universeId, 'VOTING');
  const { data: accepted, isLoading: loadingAccepted } = useCanon(universeId);

  return (
    <TokenGateGuard universeId={universeId} target="canon">
      <div className="min-h-screen bg-background pb-24">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
          <Link to="/shop/$universeId" params={{ universeId }}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <Gavel className="w-4 h-4 text-primary" />
          <span className="font-semibold">{v('canon-marketplace')}</span>
        </div>

        <div className="max-w-2xl mx-auto px-4 pt-4">
          <Tabs defaultValue="voting">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="voting" className="flex-1 gap-1">
                <Clock className="w-3 h-3" />
                Voting
                {voting && voting.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs px-1.5 h-4">
                    {voting.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="accepted" className="flex-1 gap-1">
                <Trophy className="w-3 h-3" />
                Canon
              </TabsTrigger>
              <TabsTrigger value="submit" className="flex-1 gap-1">
                <Plus className="w-3 h-3" />
                Submit
              </TabsTrigger>
            </TabsList>

            {/* Voting tab */}
            <TabsContent value="voting">
              {loadingVoting ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : voting && voting.length > 0 ? (
                <div className="space-y-3">
                  {(voting as any[]).map((sub) => (
                    <SubmissionCard
                      key={sub.id}
                      submission={sub}
                      universeId={universeId}
                      isConnected={isConnected}
                      voterAddress={address}
                      tokenAddress={tokenAddress}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Gavel className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No active submissions to vote on</p>
                </div>
              )}
            </TabsContent>

            {/* Accepted canon tab */}
            <TabsContent value="accepted">
              {loadingAccepted ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : accepted && (accepted as any[]).length > 0 ? (
                <div className="space-y-3">
                  {(accepted as any[]).map((entry) => (
                    <CanonCard key={entry.id} entry={entry} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No canon entries yet</p>
                  <p className="text-xs mt-1">Submit content and let token holders decide</p>
                </div>
              )}
            </TabsContent>

            {/* Submit tab */}
            <TabsContent value="submit">
              {!isConnected ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground mb-4">{v('connect-wallet')} to submit</p>
                  <Link to="/login">
                    <Button variant="outline">{v('connect-wallet')}</Button>
                  </Link>
                </div>
              ) : (
                <SubmitForm universeId={universeId} tokenAddress={tokenAddress} />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </TokenGateGuard>
  );
}

// ---- Submission card with vote buttons ----

function SubmissionCard({
  submission,
  universeId,
  isConnected,
  voterAddress,
  tokenAddress,
}: {
  submission: any;
  universeId: string;
  isConnected: boolean;
  voterAddress?: string | null;
  tokenAddress?: `0x${string}`;
}) {
  const vote = useVoteCanon();
  const finalizeSrv = useFinalizeCanon();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const canonAddress = CanonMarketplace[String(chainId) as keyof typeof CanonMarketplace] as
    | `0x${string}`
    | undefined;
  const [voted, setVoted] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // Display the voter's current governance balance for transparency. The
  // actual vote weight is derived server-side from on-chain getVotes; the
  // value shown here is informational only.
  const { data: tokenBalance } = useReadContract({
    address: tokenAddress,
    abi: governanceErc20Abi,
    functionName: 'balanceOf',
    args: voterAddress ? [voterAddress as `0x${string}`] : undefined,
    query: { enabled: !!voterAddress && !!tokenAddress },
  });
  const displayWeight = tokenBalance ? formatEther(tokenBalance) : null;

  const totalVotes = (submission.votesFor || 0) + (submission.votesAgainst || 0);
  const forPct = totalVotes > 0 ? Math.round((submission.votesFor / totalVotes) * 100) : 0;

  const deadline =
    submission.votingDeadline?.toDate?.() ??
    (submission.votingDeadline ? new Date(submission.votingDeadline) : null);
  const deadlinePassed = deadline ? Date.now() >= deadline.getTime() : false;
  const daysLeft = deadline
    ? Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86_400_000))
    : null;
  const onChainSubmissionId: string | null = submission.onChainSubmissionId ?? null;

  async function castVote(support: boolean) {
    if (!isConnected) {
      toast.error('Connect your wallet to vote');
      return;
    }
    if (voted) return;
    try {
      // Server derives vote weight authoritatively from on-chain getVotes/
      // balanceOf — client-supplied weight is no longer accepted.
      await vote.mutateAsync({
        submissionId: submission.id,
        support,
      });
      setVoted(true);
      toast.success(support ? 'Voted for!' : 'Voted against');
    } catch (e: any) {
      toast.error(e?.message ?? 'Vote failed');
    }
  }

  async function finalize() {
    if (!isConnected) {
      toast.error('Connect your wallet to finalize');
      return;
    }
    setFinalizing(true);
    try {
      let txHash: string | undefined;
      // On-chain finalize when the submission has an on-chain ID.
      if (onChainSubmissionId && canonAddress) {
        const hash = await writeContractAsync({
          address: canonAddress,
          abi: canonMarketplaceAbi,
          functionName: 'finalize',
          args: [BigInt(onChainSubmissionId)],
        });
        txHash = hash;
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
        }
      }
      const res = await finalizeSrv.mutateAsync({ submissionId: submission.id, txHash });
      toast.success(res.accepted ? 'Accepted into canon!' : 'Submission rejected', {
        description: txHash ? `On-chain tx: ${txHash.slice(0, 10)}…` : undefined,
      });
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || 'Finalize failed');
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{submission.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {submission.submissionType?.replace(/_/g, ' ')}
              {daysLeft !== null && <span className="ml-2 text-yellow-500">{daysLeft}d left</span>}
            </p>
          </div>
          <Badge variant="outline" className="text-xs shrink-0">
            <Clock className="w-3 h-3 mr-1" />
            Voting
          </Badge>
        </div>

        {submission.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3 break-words">
            <UserText>{submission.description}</UserText>
          </p>
        )}

        {/* Vote bar */}
        {totalVotes > 0 && (
          <div className="mb-3">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${forPct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span className="text-green-600">{forPct}% for</span>
              <span>{totalVotes} votes</span>
              <span className="text-red-500">{100 - forPct}% against</span>
            </div>
          </div>
        )}

        {/* Vote buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={voted ? 'secondary' : 'outline'}
            className="flex-1 gap-1 text-xs h-8"
            disabled={voted || vote.isPending || deadlinePassed}
            onClick={() => castVote(true)}
          >
            <ThumbsUp className="w-3 h-3" />
            For ({submission.votesFor ?? 0})
          </Button>
          <Button
            size="sm"
            variant={voted ? 'secondary' : 'outline'}
            className="flex-1 gap-1 text-xs h-8"
            disabled={voted || vote.isPending || deadlinePassed}
            onClick={() => castVote(false)}
          >
            <ThumbsDown className="w-3 h-3" />
            Against ({submission.votesAgainst ?? 0})
          </Button>
        </div>
        {displayWeight && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Your voting power: {Number(displayWeight).toLocaleString()}
          </p>
        )}

        {/* Finalize — anyone can call once the voting deadline has passed.
            If the submission has an on-chain id, we call CanonMarketplace.finalize()
            on-chain first, then mirror the result in Firestore. */}
        {deadlinePassed && (
          <div className="mt-3 pt-3 border-t space-y-2">
            <Button
              size="sm"
              variant="default"
              className="w-full gap-1 text-xs h-8"
              disabled={finalizing || finalizeSrv.isPending}
              onClick={finalize}
            >
              {finalizing || finalizeSrv.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ShieldCheck className="w-3 h-3" />
              )}
              Finalize voting
              {onChainSubmissionId && canonAddress && (
                <span className="ml-1 opacity-70">(on-chain)</span>
              )}
            </Button>
            {!onChainSubmissionId && (
              <p className="text-[10px] text-muted-foreground">
                Off-chain submission — Firestore-only finalize.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Accepted canon card ----

function CanonCard({ entry }: { entry: any }) {
  const [licenseOpen, setLicenseOpen] = useState(false);
  const { isConnected } = useWalletAuth();

  return (
    <Card className="border-green-500/20">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{entry.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {entry.submissionType?.replace(/_/g, ' ')}
              {entry.finalizedAt && (
                <span className="ml-2">
                  ·{' '}
                  {new Date(
                    entry.finalizedAt?.toDate?.() ?? entry.finalizedAt
                  ).toLocaleDateString()}
                </span>
              )}
            </p>
            {entry.description && (
              <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 break-words">
                <UserText>{entry.description}</UserText>
              </p>
            )}
          </div>
          <Badge variant="default" className="shrink-0 text-xs bg-green-600 hover:bg-green-600">
            Canon
          </Badge>
        </div>
        {entry.ipfsUrl && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs text-muted-foreground">
              Pinned to IPFS:{' '}
              <span className="font-mono text-primary">{entry.ipfsCid?.slice(0, 16)}…</span>
            </p>
          </div>
        )}

        <div className="mt-3 pt-3 border-t">
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1 text-xs h-8"
            disabled={!isConnected}
            onClick={() => setLicenseOpen(true)}
          >
            <FileCheck className="w-3 h-3" />
            {isConnected ? 'License this canon' : 'Connect wallet to license'}
          </Button>
        </div>
      </CardContent>
      {licenseOpen && (
        <LicenseCanonDialog entry={entry} open={licenseOpen} onOpenChange={setLicenseOpen} />
      )}
    </Card>
  );
}

// ---- License canon dialog (on-chain payable + tRPC record) ----

function LicenseCanonDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [ethAmount, setEthAmount] = useState('0.01');
  const [submitting, setSubmitting] = useState(false);
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const licenseSrv = useLicenseCanon();
  const canonAddress = CanonMarketplace[String(chainId) as keyof typeof CanonMarketplace] as
    | `0x${string}`
    | undefined;
  const onChainSubmissionId: string | null = entry.onChainSubmissionId ?? null;

  async function handleLicense() {
    if (!onChainSubmissionId) {
      toast.error('This canon entry has no on-chain submission id — cannot license on-chain.');
      return;
    }
    if (!canonAddress) {
      toast.error('CanonMarketplace is not deployed on the current network.');
      return;
    }
    let parsedValue: bigint;
    try {
      parsedValue = parseEther(ethAmount || '0');
    } catch {
      toast.error('Enter a valid ETH amount.');
      return;
    }
    if (parsedValue <= 0n) {
      toast.error('License fee must be greater than zero.');
      return;
    }
    setSubmitting(true);
    try {
      // WEB-4: licenseCanon sends ETH to the CanonMarketplace contract.
      // Confirm the exact amount + target before the wallet sign step.
      const approved = await confirmTx({
        title: 'License canon submission',
        description: 'Pay the ETH license fee to the CanonMarketplace.',
        chainName: 'Base Sepolia',
        functionName: 'licenseCanon',
        to: canonAddress,
        valueEth: ethAmount,
        summary: [['Submission id', String(onChainSubmissionId)]],
        confirmLabel: 'License',
      });
      if (!approved) {
        setSubmitting(false);
        return;
      }
      const hash = await writeContractAsync({
        address: canonAddress,
        abi: canonMarketplaceAbi,
        functionName: 'licenseCanon',
        args: [BigInt(onChainSubmissionId)],
        value: parsedValue,
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await licenseSrv.mutateAsync({
        submissionId: entry.id,
        fee: parsedValue.toString(),
        txHash: hash,
      });
      toast.success('Canon licensed!', {
        description: `Tx: ${hash.slice(0, 10)}…`,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || 'License failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>License canon</DialogTitle>
          <DialogDescription>
            Pay ETH to license <span className="font-medium">{entry.title}</span>. The fee is routed
            to the creator via PaymentRouter; a protocol cut is taken per{' '}
            <code className="text-xs">canonLicenseFeeBps</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="license-eth">License fee (ETH)</Label>
            <Input
              id="license-eth"
              type="number"
              step="0.001"
              min="0"
              value={ethAmount}
              onChange={(e) => setEthAmount(e.target.value)}
              disabled={submitting}
            />
            <p className="text-[11px] text-muted-foreground">
              The amount is up to you — higher fees strengthen your rights claim.
            </p>
          </div>
          {!onChainSubmissionId && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              This legacy entry has no on-chain submission id. On-chain licensing is disabled.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleLicense}
            disabled={submitting || !onChainSubmissionId || !canonAddress}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            License
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Submit form ----

function SubmitForm({
  universeId,
  tokenAddress,
}: {
  universeId: string;
  tokenAddress?: `0x${string}`;
}) {
  const submit = useSubmitCanon();
  const [form, setForm] = useState({
    submissionType: 'CHARACTER' as const,
    title: '',
    description: '',
    contentHash: '',
    metadataURI: '',
    mediaUrl: '',
  });

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Title and description are required');
      return;
    }
    if (!form.contentHash.trim()) {
      toast.error('Content hash is required');
      return;
    }
    try {
      await submit.mutateAsync({
        universeId,
        universeToken: tokenAddress || '',
        submissionType: form.submissionType,
        title: form.title.trim(),
        description: form.description.trim(),
        contentHash: form.contentHash.trim(),
        metadataURI: form.metadataURI.trim() || `ipfs://${form.contentHash.trim()}`,
        mediaUrl: form.mediaUrl.trim() || undefined,
      });
      toast.success('Submitted for voting!', {
        description: 'Token holders can now vote over the next 7 days.',
      });
      setForm({
        submissionType: 'CHARACTER',
        title: '',
        description: '',
        contentHash: '',
        metadataURI: '',
        mediaUrl: '',
      });
    } catch (e: any) {
      toast.error(e?.message ?? 'Submission failed');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold mb-1">Propose Canon</h2>
        <p className="text-xs text-muted-foreground">
          Submit content for the community to vote on. Accepted entries become permanent universe
          canon.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Submission Type</Label>
        <Select value={form.submissionType} onValueChange={(v) => set('submissionType', v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUBMISSION_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="can-title">Title *</Label>
        <Input
          id="can-title"
          placeholder="Name your submission"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="can-desc">Description *</Label>
        <Textarea
          id="can-desc"
          placeholder="Describe your canon proposal in detail…"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          rows={4}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="can-hash">Content Hash *</Label>
        <Input
          id="can-hash"
          placeholder="SHA-256 or IPFS CID of your content"
          value={form.contentHash}
          onChange={(e) => set('contentHash', e.target.value)}
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="can-media">Media URL (optional)</Label>
        <Input
          id="can-media"
          placeholder="https://…"
          value={form.mediaUrl}
          onChange={(e) => set('mediaUrl', e.target.value)}
        />
      </div>

      <Button className="w-full gap-2" onClick={handleSubmit} disabled={submit.isPending} size="lg">
        {submit.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
        Submit for Voting
      </Button>
    </div>
  );
}
