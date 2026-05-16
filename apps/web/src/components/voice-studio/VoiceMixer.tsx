/**
 * Voice Studio — Mix tab.
 *
 * Cross-cast a performance from one voice into the timbre of another. Restricted
 * to voices the user owns (cloned/designed) or has licensed (saved from the
 * platform catalog), so the output is always commercially safe to ship.
 *
 * Pipeline (STS chain — ElevenLabs has no embedding-blend endpoint):
 *   1. voice.synthesize(text, performanceVoiceId)  → rendered audioUrl
 *   2. voice.modify(audioUrl, targetVoiceId=styleVoiceId, model=multilingual_sts_v2)
 *                                                  → final audioUrl in the style voice's timbre
 *
 * The remix output auto-publishes to the gallery (via voice.modify's existing
 * publishToGallery call). We surface both renders inline so the user can A/B.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Shuffle,
  Loader2,
  Play,
  Pause,
  Lock,
  ArrowRight,
  Wand2,
  Mic,
  BookOpen,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import type { MyVoice } from './voice-studio.types';

interface MixResult {
  performanceAudioUrl: string;
  performanceGenerationId: string;
  remixAudioUrl: string;
  remixGenerationId: string;
  totalCredits: number;
}

const SOURCE_ICON = {
  library: BookOpen,
  clone: Mic,
  design: Wand2,
};

export function VoiceMixer() {
  const [performanceVoiceId, setPerformanceVoiceId] = useState<string | null>(null);
  const [styleVoiceId, setStyleVoiceId] = useState<string | null>(null);
  const [script, setScript] = useState(
    'Some lines were never written for me — and yet, here I am, saying them anyway.'
  );
  const [styleStrength, setStyleStrength] = useState(0.6);
  const [stability, setStability] = useState(0.45);
  const [result, setResult] = useState<MixResult | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const { data: voicesRaw, isLoading } = useQuery({
    queryKey: ['voiceLibrary', 'myVoices', 'mixer'],
    queryFn: () =>
      trpcClient.voiceLibrary.myVoices.query({
        rightsClass: ['owned', 'licensed'],
      }),
  });
  const voices = (voicesRaw ?? []) as MyVoice[];

  const performanceVoice = useMemo(
    () => voices.find((v) => v.voiceId === performanceVoiceId) ?? null,
    [voices, performanceVoiceId]
  );
  const styleVoice = useMemo(
    () => voices.find((v) => v.voiceId === styleVoiceId) ?? null,
    [voices, styleVoiceId]
  );

  const mixMutation = useMutation({
    mutationFn: async (): Promise<MixResult> => {
      if (!performanceVoice || !styleVoice) {
        throw new Error('Pick a performance voice and a style voice');
      }
      if (performanceVoice.voiceId === styleVoice.voiceId) {
        throw new Error('Performance and style voices must differ');
      }
      // Step 1 — render the performance with voice A
      const perf = await trpcClient.voice.synthesize.mutate({
        text: script.trim(),
        voiceId: performanceVoice.voiceId,
        modelId: 'eleven_flash_v2_5',
        stability,
      });
      if (!perf.audioUrl) {
        throw new Error('Performance render failed silently');
      }
      // Step 2 — restyle through voice B (STS)
      const remix = await trpcClient.voice.modify.mutate({
        audioUrl: perf.audioUrl,
        targetVoiceId: styleVoice.voiceId,
        modelId: 'eleven_multilingual_sts_v2',
        stability,
        style: styleStrength,
        parentGenerationId: perf.generationId,
        presetId: 'voice-mixer',
      });
      if (!remix.audioUrl) {
        throw new Error('Restyle step failed silently');
      }
      return {
        performanceAudioUrl: perf.audioUrl,
        performanceGenerationId: perf.generationId,
        remixAudioUrl: remix.audioUrl,
        remixGenerationId: remix.generationId,
        totalCredits: perf.creditsCharged + remix.creditsCharged,
      };
    },
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Remix ready — ⟁ ${r.totalCredits} credits`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function play(id: string, url: string) {
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    if (playingId === id) {
      setPlayingId(null);
      return;
    }
    const a = new Audio(url);
    a.onended = () => setPlayingId(null);
    a.play().catch((e) => toast.error(`Playback failed: ${e.message}`));
    setAudioEl(a);
    setPlayingId(id);
  }

  const canMix =
    performanceVoiceId &&
    styleVoiceId &&
    performanceVoiceId !== styleVoiceId &&
    script.trim().length >= 4 &&
    !mixMutation.isPending;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading your voices…</p>;
  }

  if (voices.length < 2) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Lock className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="mb-1 text-sm font-semibold">Need at least two voices to mix</p>
          <p className="mx-auto max-w-md text-xs text-muted-foreground">
            The mixer is gated to voices you own (cloned/designed) or have licensed from the
            Library. Save a few voices from the Library tab, clone your own, or design new ones in
            the Create tab.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shuffle className="size-4 text-sky-400" /> Cross-cast a performance
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pick a <strong>performance</strong> voice (what reads the script) and a{' '}
            <strong>style</strong> voice (whose timbre to imitate). We render with the first, then
            restyle into the second. Both must be voices you own or have licensed.
          </p>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <VoicePicker
          title="Performance voice"
          subtitle="Reads the script — drives cadence and emotion."
          voices={voices}
          selectedVoiceId={performanceVoiceId}
          onSelect={setPerformanceVoiceId}
          excludeVoiceId={styleVoiceId ?? undefined}
        />
        <VoicePicker
          title="Style voice"
          subtitle="Lends timbre — final output sounds like this voice."
          voices={voices}
          selectedVoiceId={styleVoiceId}
          onSelect={setStyleVoiceId}
          excludeVoiceId={performanceVoiceId ?? undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Script & controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label htmlFor="mix-script">Line to perform</Label>
            <Textarea
              id="mix-script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={3}
              maxLength={1000}
            />
            <p className="mt-1 text-xs text-muted-foreground">{script.length}/1000</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-baseline justify-between">
                <Label>Style match</Label>
                <span className="text-xs text-muted-foreground">{styleStrength.toFixed(2)}</span>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[styleStrength]}
                onValueChange={([v]) => setStyleStrength(v ?? 0.6)}
                className="mt-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Higher = closer to the style voice's timbre (may flatten the performance).
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <Label>Stability</Label>
                <span className="text-xs text-muted-foreground">{stability.toFixed(2)}</span>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[stability]}
                onValueChange={([v]) => setStability(v ?? 0.45)}
                className="mt-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Lower = more expressive · Higher = more consistent
              </p>
            </div>
          </div>

          <Button onClick={() => mixMutation.mutate()} disabled={!canMix}>
            {mixMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Mixing…
              </>
            ) : (
              <>
                <Shuffle className="mr-1.5 size-3.5" />
                Mix voices
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Output</CardTitle>
            <p className="text-xs text-muted-foreground">
              The remix has been published to your gallery. ⟁ {result.totalCredits} total credits.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  1. Performance ({performanceVoice?.name})
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => play('perf', result.performanceAudioUrl)}
                >
                  {playingId === 'perf' ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </Button>
              </div>
              <audio
                src={result.performanceAudioUrl}
                controls
                className="w-full"
                preload="metadata"
              />
            </div>
            <div className="rounded border border-sky-500/40 bg-sky-500/5 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-sky-300">
                  2. Remix (in {styleVoice?.name})
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => play('remix', result.remixAudioUrl)}
                >
                  {playingId === 'remix' ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </Button>
              </div>
              <audio src={result.remixAudioUrl} controls className="w-full" preload="metadata" />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function VoicePicker({
  title,
  subtitle,
  voices,
  selectedVoiceId,
  onSelect,
  excludeVoiceId,
}: {
  title: string;
  subtitle: string;
  voices: MyVoice[];
  selectedVoiceId: string | null;
  onSelect: (voiceId: string) => void;
  excludeVoiceId?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {title}
          {selectedVoiceId ? <ArrowRight className="ml-1 inline size-3.5 text-sky-400" /> : null}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {voices.map((voice) => {
            const Icon = SOURCE_ICON[voice.source] ?? Mic;
            const selected = voice.voiceId === selectedVoiceId;
            const disabled = voice.voiceId === excludeVoiceId;
            return (
              <button
                key={voice.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(voice.voiceId)}
                className={`flex w-full items-start justify-between gap-2 rounded border px-3 py-2 text-left transition-colors ${
                  selected
                    ? 'border-sky-500 bg-sky-500/10'
                    : disabled
                      ? 'border-border opacity-40'
                      : 'border-border hover:border-sky-500/50 hover:bg-sky-500/5'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon className="size-3.5 text-muted-foreground" />
                    <span className="truncate text-sm font-semibold">{voice.name}</span>
                  </div>
                  {voice.description ? (
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {voice.description}
                    </p>
                  ) : null}
                </div>
                <Badge
                  variant={voice.rightsClass === 'owned' ? 'default' : 'outline'}
                  className="shrink-0 text-[10px] capitalize"
                >
                  {voice.rightsClass}
                </Badge>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
