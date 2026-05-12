/**
 * UniversePublishPanel — canon/draft management + "Launch Publicly" flow.
 *
 * Canon is the publishing primitive. Draft episodes are team-only; canon
 * episodes are what the public sees on a launched universe. Publishing is
 * **one-way** — once an episode is canon, it cannot be reversed.
 *
 * Behaviour differs by `universeType`:
 *   - `fun`: universe starts private, owner launches it publicly via this
 *     panel. Canon lives in Firestore only (free, instant).
 *   - `monetized`: universe is public from the launchpad. Canon is on-chain
 *     (Universe.sol). Phase 2 will wire the setCanonForEpisode tx flow here;
 *     for now the server returns NOT_IMPLEMENTED and the button is disabled.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  X,
  Check,
  Film,
  Loader2,
  Lock,
  Globe,
  Sparkles,
  Info,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getAddress, keccak256, toBytes } from 'viem';
import { useWriteContract } from '@/hooks/useCircleWrite';

/**
 * Minimal ABI for `setCanonForEpisode`. Kept inline so the UI doesn't block
 * on regenerating `@loar/abis` after every contract change.
 */
const SET_CANON_FOR_EPISODE_ABI = [
  {
    type: 'function',
    name: 'setCanonForEpisode',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tipNodeId', type: 'uint256' },
      { name: 'episodeHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

interface UniversePublishPanelProps {
  universeId: string;
  onClose: () => void;
}

interface EpisodeClip {
  nodeId?: string;
}

interface EpisodeRow {
  id: string;
  title: string;
  clipCount?: number;
  clips?: EpisodeClip[];
  isCanon?: boolean;
  canonizedAt?: string | null;
}

/**
 * Resolve the canon tip node id for an episode: the last clip whose `nodeId`
 * parses as a positive integer (i.e. corresponds to an on-chain VideoNode).
 * Returns null when no clip has an on-chain node — such an episode can't be
 * canonized on a monetized universe.
 */
function resolveCanonTipNodeId(clips: EpisodeClip[] | undefined): bigint | null {
  if (!clips) return null;
  for (let i = clips.length - 1; i >= 0; i--) {
    const raw = clips[i]?.nodeId;
    if (!raw) continue;
    if (!/^\d+$/.test(raw)) continue;
    try {
      const parsed = BigInt(raw);
      if (parsed > 0n) return parsed;
    } catch {
      // fall through
    }
  }
  return null;
}

export function UniversePublishPanel({ universeId, onClose }: UniversePublishPanelProps) {
  const queryClient = useQueryClient();
  const [confirmingEpisodeId, setConfirmingEpisodeId] = useState<string | null>(null);
  const [confirmingLaunch, setConfirmingLaunch] = useState(false);

  const { data: universeDoc, isLoading: isLoadingUniverse } = useQuery({
    queryKey: ['universe-publish-state', universeId],
    queryFn: () => trpcClient.universes.get.query({ id: universeId }),
  });

  const { data: episodes, isLoading: isLoadingEpisodes } = useQuery({
    queryKey: ['universeEpisodes', universeId],
    queryFn: () =>
      trpcClient.episodes.list.query({ universeId, limit: 50 }) as Promise<EpisodeRow[]>,
  });

  const universeData = (universeDoc?.data ?? {}) as {
    universeType?: 'fun' | 'monetized';
    isPrivate?: boolean;
  };
  const universeType = universeData.universeType ?? 'monetized';
  const isPrivate = Boolean(universeData.isPrivate);

  const { canon, drafts } = useMemo(() => {
    const canon: EpisodeRow[] = [];
    const drafts: EpisodeRow[] = [];
    for (const ep of episodes ?? []) {
      (ep.isCanon ? canon : drafts).push(ep);
    }
    return { canon, drafts };
  }, [episodes]);

  const { writeContractAsync } = useWriteContract();

  // Z.AI canon-consistency advisory. Triggered on-demand from the confirm
  // dialog ("Preview canon score") and again as a server-side soft gate
  // inside publishAsCanon. The bypass flag below carries the creator's
  // explicit override when the verdict is off-canon-high.
  const [bypassCanon, setBypassCanon] = useState(false);
  type CanonAdvisory =
    | { skipped: true; reason: string }
    | {
        skipped: false;
        score: number;
        verdict: 'canonical' | 'borderline' | 'off-canon';
        contradictions: Array<{ severity: 'low' | 'med' | 'high'; note: string }>;
        summary: string;
        thumbUrl: string;
      };

  const canonPreview = useMutation({
    mutationFn: (episodeId: string) =>
      trpcClient.zai.canonCheckEpisode.mutate({ episodeId }) as Promise<CanonAdvisory>,
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Canon preview failed'),
  });

  // Reset advisory + bypass each time the confirm dialog opens for a new episode.
  useEffect(() => {
    if (confirmingEpisodeId) {
      setBypassCanon(false);
      canonPreview.reset();
    }
    // canonPreview is intentionally omitted — its identity churns each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmingEpisodeId]);

  const advisory = canonPreview.data;
  const advisoryBlocks =
    advisory &&
    !advisory.skipped &&
    advisory.verdict === 'off-canon' &&
    advisory.contradictions.some((c) => c.severity === 'high');

  const publishMutation = useMutation({
    mutationFn: async (episodeId: string) => {
      // Fun universes: straight Firestore flip.
      if (universeType === 'fun') {
        return await trpcClient.episodes.publishAsCanon.mutate({
          episodeId,
          bypassCanonCheck: bypassCanon,
        });
      }

      // Monetized universes: sign setCanonForEpisode on-chain, then pass the
      // resulting txHash to the server which verifies the EpisodeCanonized
      // event and mirrors isCanon.
      const episode = (episodes ?? []).find((ep) => ep.id === episodeId);
      const tipNodeId = resolveCanonTipNodeId(episode?.clips);
      if (!tipNodeId) {
        throw new Error(
          'This episode has no on-chain nodes. Save its clips to the timeline before canonizing.'
        );
      }

      const episodeHash = keccak256(toBytes(episodeId));
      // Pin the chain explicitly. Without this the wallet signs against
      // whatever network it currently shows, which may be a different chain
      // where the same address resolves to an unrelated contract.
      const universeChainId = (universeData as { chainId?: number } | undefined)?.chainId;
      const txHash = await writeContractAsync({
        address: getAddress(universeId),
        abi: SET_CANON_FOR_EPISODE_ABI,
        functionName: 'setCanonForEpisode',
        args: [tipNodeId, episodeHash],
        ...(universeChainId ? { chainId: universeChainId } : {}),
      });

      return await trpcClient.episodes.publishAsCanon.mutate({
        episodeId,
        txHash,
        canonTipNodeId: tipNodeId.toString(),
        bypassCanonCheck: bypassCanon,
      });
    },
    onSuccess: (_res, episodeId) => {
      toast.success('Episode published as canon');
      setConfirmingEpisodeId(null);
      queryClient.invalidateQueries({ queryKey: ['universeEpisodes', universeId] });
      queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to publish';
      toast.error(msg);
      setConfirmingEpisodeId(null);
    },
  });

  const launchMutation = useMutation({
    mutationFn: async () => {
      return await trpcClient.universes.setPrivate.mutate({ universeId, isPrivate: false });
    },
    onSuccess: () => {
      toast.success('Universe is now public');
      setConfirmingLaunch(false);
      queryClient.invalidateQueries({ queryKey: ['universe-publish-state', universeId] });
      queryClient.invalidateQueries({ queryKey: ['universe-privacy', universeId] });
      queryClient.invalidateQueries({ queryKey: ['universes', 'all'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to launch';
      toast.error(msg);
    },
  });

  const isLoading = isLoadingUniverse || isLoadingEpisodes;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" /> Publish & Canon
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            <span className="ml-2 text-sm text-zinc-400">Loading...</span>
          </div>
        ) : (
          <>
            {/* Launch section — fun universes only. Monetized universes are
                always public, so we show an info note instead. */}
            {universeType === 'fun' ? (
              <Card className="mb-6 border-zinc-800 bg-zinc-800/50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isPrivate ? (
                          <Lock className="w-4 h-4 text-amber-400" />
                        ) : (
                          <Globe className="w-4 h-4 text-emerald-400" />
                        )}
                        <span className="text-sm font-semibold text-white">
                          {isPrivate ? 'Private universe' : 'Public universe'}
                        </span>
                        <Badge
                          className={
                            isPrivate
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          }
                        >
                          {isPrivate ? 'Draft' : 'Live'}
                        </Badge>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        {isPrivate
                          ? 'Only you and your team can see this universe. Launch it publicly to let viewers discover your canon episodes. Drafts stay team-only.'
                          : 'Anyone can discover this universe. Only canon episodes are visible to the public; drafts remain team-only.'}
                      </p>
                    </div>
                    {isPrivate && (
                      <Button
                        onClick={() => setConfirmingLaunch(true)}
                        disabled={launchMutation.isPending}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                      >
                        <Globe className="w-4 h-4 mr-2" />
                        Launch Publicly
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="mb-6 border-zinc-800 bg-zinc-800/50">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Info className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
                    <div className="text-xs text-zinc-400 leading-relaxed">
                      <span className="text-white font-semibold">Launchpad universe.</span>{' '}
                      Monetized universes are public from mint — their token is trading, so they
                      can't be hidden. Manage visibility by choosing which episodes you publish as
                      canon below.
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Canon episodes */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Check className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Canon</h3>
                <Badge variant="outline" className="text-[10px] border-zinc-700">
                  {canon.length}
                </Badge>
              </div>
              {canon.length === 0 ? (
                <p className="text-xs text-zinc-500 px-1">
                  No canon episodes yet. Publish a draft below to make it part of your universe's
                  official story.
                </p>
              ) : (
                <div className="space-y-2">
                  {canon.map((ep) => (
                    <EpisodeRowView key={ep.id} episode={ep} isCanon />
                  ))}
                </div>
              )}
            </div>

            {/* Draft episodes */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Film className="w-4 h-4 text-zinc-400" />
                <h3 className="text-sm font-semibold text-white">Drafts</h3>
                <Badge variant="outline" className="text-[10px] border-zinc-700">
                  {drafts.length}
                </Badge>
              </div>
              {drafts.length === 0 ? (
                <p className="text-xs text-zinc-500 px-1">No drafts. New episodes appear here.</p>
              ) : (
                <div className="space-y-2">
                  {drafts.map((ep) => (
                    <EpisodeRowView
                      key={ep.id}
                      episode={ep}
                      isCanon={false}
                      publishing={publishMutation.isPending && publishMutation.variables === ep.id}
                      onPublish={() => setConfirmingEpisodeId(ep.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Confirm launch dialog */}
        {confirmingLaunch && (
          <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
            <div className="bg-zinc-900 rounded-xl border border-zinc-700 max-w-md w-full p-6">
              <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <Globe className="w-5 h-5 text-emerald-400" /> Launch publicly?
              </h3>
              <p className="text-sm text-zinc-400 mb-4">
                Your universe will be visible to anyone. <strong>{canon.length}</strong> canon
                episode{canon.length === 1 ? '' : 's'} will be shown to the public. Drafts will stay
                team-only. You can return to private anytime.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setConfirmingLaunch(false)}>
                  Cancel
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => launchMutation.mutate()}
                  disabled={launchMutation.isPending}
                >
                  {launchMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Globe className="w-4 h-4 mr-2" />
                  )}
                  Launch
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm publish-as-canon dialog — one-way, destructive confirm */}
        {confirmingEpisodeId && (
          <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
            <div className="bg-zinc-900 rounded-xl border border-zinc-700 max-w-md w-full p-6">
              <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <Check className="w-5 h-5 text-amber-400" /> Publish as canon?
              </h3>
              <p className="text-sm text-zinc-400 mb-2">
                This episode will become part of your universe's official story. Once canon, it
                cannot be demoted back to draft — canon is permanent.
              </p>
              {universeType === 'monetized' && (
                <p className="text-xs text-amber-400/80 mb-4">
                  Monetized universes write canon on-chain. You'll sign a
                  <code className="mx-1 text-amber-300">setCanonForEpisode</code>
                  transaction. Gas is paid by your wallet.
                </p>
              )}

              {/* Z.AI canon advisory — preview the GLM-5V consistency score
                  before committing. Always optional; the server runs the
                  same check inline and soft-blocks only on off-canon-high. */}
              <div className="mt-4 rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-zinc-300">
                    <ShieldCheck className="w-3.5 h-3.5 text-violet-400" />
                    <span>Canon consistency advisory (Z.AI GLM-5V)</span>
                  </div>
                  {!advisory && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => canonPreview.mutate(confirmingEpisodeId)}
                      disabled={canonPreview.isPending}
                      className="h-7 text-xs"
                    >
                      {canonPreview.isPending ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          Scoring…
                        </>
                      ) : (
                        'Preview score'
                      )}
                    </Button>
                  )}
                </div>

                {advisory?.skipped && (
                  <p className="text-xs text-zinc-500 italic">{advisory.reason}</p>
                )}

                {advisory && !advisory.skipped && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-white">{advisory.score}</span>
                      <span className="text-xs text-zinc-400">/100</span>
                      <Badge
                        className={
                          advisory.verdict === 'canonical'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : advisory.verdict === 'borderline'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        }
                      >
                        {advisory.verdict}
                      </Badge>
                      {advisory.thumbUrl && (
                        <img
                          src={advisory.thumbUrl}
                          alt="frame analyzed"
                          className="h-10 w-10 rounded object-cover border border-zinc-700 ml-auto"
                        />
                      )}
                    </div>
                    {advisory.summary && (
                      <p className="text-xs text-zinc-400">{advisory.summary}</p>
                    )}
                    {advisory.contradictions.length > 0 && (
                      <ul className="text-xs space-y-1">
                        {advisory.contradictions.map((c, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <Badge
                              variant="secondary"
                              className={`text-[9px] shrink-0 ${
                                c.severity === 'high'
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                                  : c.severity === 'med'
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                    : 'bg-zinc-700/40 text-zinc-300'
                              }`}
                            >
                              {c.severity}
                            </Badge>
                            <span className="text-zinc-300">{c.note}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {advisoryBlocks && (
                      <label className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/5 border border-rose-500/30 rounded p-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={bypassCanon}
                          onChange={(e) => setBypassCanon(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span className="flex-1">
                          <strong className="inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Override the advisory and publish anyway
                          </strong>
                          <br />
                          The server soft-blocks off-canon publishes by default. Toggle this to
                          override — recorded as <code>bypassed</code> in the audit log.
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end mt-4">
                <Button variant="ghost" onClick={() => setConfirmingEpisodeId(null)}>
                  Cancel
                </Button>
                <Button
                  className="bg-amber-600 hover:bg-amber-700"
                  onClick={() => publishMutation.mutate(confirmingEpisodeId)}
                  disabled={publishMutation.isPending || (advisoryBlocks && !bypassCanon)}
                >
                  {publishMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  {advisoryBlocks && bypassCanon ? 'Override & Publish' : 'Publish as Canon'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EpisodeRowView({
  episode,
  isCanon,
  publishing,
  onPublish,
}: {
  episode: EpisodeRow;
  isCanon: boolean;
  publishing?: boolean;
  onPublish?: () => void;
}) {
  const clipCount = episode.clipCount ?? episode.clips?.length ?? 0;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{episode.title}</p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-[10px] border-zinc-700">
            {clipCount} clip{clipCount === 1 ? '' : 's'}
          </Badge>
          {isCanon ? (
            <Badge className="text-[10px] bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
              Canon
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border-amber-500/40">
              Draft
            </Badge>
          )}
        </div>
      </div>
      {!isCanon && onPublish && (
        <Button size="sm" variant="outline" onClick={onPublish} disabled={publishing}>
          {publishing ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5 mr-1" />
          )}
          Publish
        </Button>
      )}
    </div>
  );
}
