/**
 * DubLipsyncPanel — E2 + E3 from prd-editor.md
 *
 * Two integrated flows for a clip already loaded in the editor:
 *
 *   E2 — Multilingual dubbing
 *     Pick target languages → multilingualDub.create runs the source video
 *     through translation + TTS. Each target language yields a separate job
 *     id; the panel polls multilingualDub.status (a mutation) for each.
 *
 *   E3 — Inline lipsync
 *     Once a dub track completes, the "Lipsync" button calls lipsync.sync
 *     with the editor's current video + the chosen dub audio. The result
 *     replaces the editor's video URL so subsequent edits operate on the
 *     lipsynced clip; lineage is preserved server-side.
 */
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Globe, Mic2, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';

const LANGUAGES = [
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
] as const;
type LangCode = (typeof LANGUAGES)[number]['code'];

interface DubTrack {
  langCode: LangCode;
  jobId: string;
  status: 'queued' | 'dubbing' | 'complete' | 'failed';
  outputAudioUrl?: string;
  outputVideoUrl?: string;
  failureReason?: string;
}

interface DubLipsyncPanelProps {
  videoUrl: string | null;
  durationSec?: number;
  onVideoReplaced: (newVideoUrl: string) => void;
}

export function DubLipsyncPanel({
  videoUrl,
  durationSec = 8,
  onVideoReplaced,
}: DubLipsyncPanelProps) {
  const [selectedLangs, setSelectedLangs] = useState<LangCode[]>([]);
  const [dubTracks, setDubTracks] = useState<DubTrack[]>([]);
  const [activeDubLang, setActiveDubLang] = useState<LangCode | null>(null);

  // E2: kick off the dub job (returns N per-lang job ids)
  const dubMutation = useMutation({
    mutationFn: async () => {
      if (!videoUrl) throw new Error('Load a video first');
      if (selectedLangs.length === 0) throw new Error('Pick at least one language');

      const res = (await trpcClient.multilingualDub.create.mutate({
        sourceVideoUrl: videoUrl,
        targetLangs: selectedLangs as unknown as readonly string[] as never,
        durationSec,
        highestResolution: true,
      } as never)) as {
        jobs: Array<{ id: string; targetLang: string }>;
        failures: Array<{ targetLang: string; error: string }>;
      };

      // Add new tracks for each successfully started job.
      setDubTracks((prev) => {
        const next = [...prev];
        for (const job of res.jobs ?? []) {
          const lang = job.targetLang as LangCode;
          if (!next.some((t) => t.langCode === lang)) {
            next.push({ langCode: lang, jobId: job.id, status: 'queued' });
          }
        }
        return next;
      });
      if (res.failures?.length) {
        toast.warning(
          `${res.failures.length} language(s) failed to start: ${res.failures.map((f) => f.targetLang).join(', ')}`
        );
      }
      return res;
    },
    onSuccess: () => toast.success('Dubbing started — tracks will appear when ready'),
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Dubbing failed'),
  });

  // Poll each non-terminal job. The server's `status` endpoint is a mutation
  // because it drives state transitions (downloads output, refunds on fail).
  useEffect(() => {
    const pending = dubTracks.filter((t) => t.status === 'queued' || t.status === 'dubbing');
    if (pending.length === 0) return;

    const handle = setInterval(async () => {
      for (const track of pending) {
        try {
          const res = (await trpcClient.multilingualDub.status.mutate({
            id: track.jobId,
          } as never)) as Record<string, unknown>;
          const status = (res.status as DubTrack['status']) ?? 'queued';
          const outputAudioUrl = (res.outputAudioUrl as string | undefined) ?? undefined;
          const outputVideoUrl = (res.outputVideoUrl as string | undefined) ?? undefined;
          const failureReason = (res.failureReason as string | undefined) ?? undefined;
          setDubTracks((prev) =>
            prev.map((t) =>
              t.jobId === track.jobId
                ? { ...t, status, outputAudioUrl, outputVideoUrl, failureReason }
                : t
            )
          );
        } catch (err) {
          console.error('[DubLipsyncPanel] status poll failed:', err);
        }
      }
    }, 6000);

    return () => clearInterval(handle);
  }, [dubTracks]);

  // E3: lipsync the editor's current video to a selected dub track
  const lipsyncMutation = useMutation({
    mutationFn: async () => {
      if (!videoUrl) throw new Error('Load a video first');
      if (!activeDubLang) throw new Error('Pick a dub track to lipsync against');
      const dub = dubTracks.find((t) => t.langCode === activeDubLang);
      if (!dub) throw new Error('Dub track not found');
      const audioUrl = dub.outputAudioUrl;
      if (!audioUrl) throw new Error('Dub track audio is not ready yet');

      const res = (await trpcClient.lipsync.sync.mutate({
        videoUrl,
        audioUrl,
        autoPublish: false,
      } as never)) as { videoUrl?: string };

      if (!res.videoUrl) throw new Error('Lipsync returned no video URL');
      return res.videoUrl;
    },
    onSuccess: (newVideoUrl) => {
      toast.success('Lipsync applied');
      onVideoReplaced(newVideoUrl);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Lipsync failed'),
  });

  function toggleLang(code: LangCode) {
    setSelectedLangs((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  return (
    <div className="space-y-3">
      {!videoUrl && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Load a video in the Input tab to dub it.
          </p>
        </Card>
      )}

      {/* E2: language picker */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <Globe className="w-3 h-3" />
          Dub to languages
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {LANGUAGES.map((l) => (
            <Button
              key={l.code}
              variant={selectedLangs.includes(l.code) ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-7"
              onClick={() => toggleLang(l.code)}
              disabled={!videoUrl || dubMutation.isPending}
            >
              {l.label}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          className="w-full mt-2"
          onClick={() => dubMutation.mutate()}
          disabled={!videoUrl || selectedLangs.length === 0 || dubMutation.isPending}
        >
          {dubMutation.isPending ? (
            <>
              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
              Starting…
            </>
          ) : (
            `Start dub (${selectedLangs.length})`
          )}
        </Button>
      </div>

      {/* Dub track list */}
      {dubTracks.length > 0 && (
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Dub tracks</label>
          <div className="flex flex-wrap gap-1.5">
            {dubTracks.map((t) => {
              const lang = LANGUAGES.find((l) => l.code === t.langCode);
              const ready = t.status === 'complete' && !!t.outputAudioUrl;
              const active = activeDubLang === t.langCode;
              return (
                <button
                  key={t.jobId}
                  onClick={() => ready && setActiveDubLang(active ? null : t.langCode)}
                  disabled={!ready}
                  title={t.failureReason}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors ${
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : ready
                        ? 'border-border/60 hover:border-border'
                        : t.status === 'failed'
                          ? 'border-red-500/40 text-red-400 cursor-not-allowed'
                          : 'border-border/30 text-muted-foreground cursor-not-allowed'
                  }`}
                >
                  {t.status === 'queued' || t.status === 'dubbing' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : t.status === 'complete' ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <AlertTriangle className="w-3 h-3" />
                  )}
                  {lang?.label ?? t.langCode}
                  {active && (
                    <Badge variant="secondary" className="text-[9px] h-3.5 px-1">
                      selected
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* E3: lipsync action */}
      {activeDubLang && (
        <div>
          <Button
            className="w-full"
            onClick={() => lipsyncMutation.mutate()}
            disabled={lipsyncMutation.isPending}
          >
            {lipsyncMutation.isPending ? (
              <>
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                Lipsyncing…
              </>
            ) : (
              <>
                <Mic2 className="w-3 h-3 mr-1.5" />
                Lipsync to {LANGUAGES.find((l) => l.code === activeDubLang)?.label} track
              </>
            )}
          </Button>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Replaces the editor's current video with the lipsynced result. Original is preserved in
            your gallery with lineage.
          </p>
        </div>
      )}
    </div>
  );
}
