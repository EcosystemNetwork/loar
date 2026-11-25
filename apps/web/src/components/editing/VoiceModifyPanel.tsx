/**
 * VoiceModifyPanel — apply ElevenLabs speech-to-speech to an existing
 * generated audio clip. Two tabs:
 *   Swap    — pick any voice from the user's ElevenLabs library
 *   Effects — curated preset grid mapped to voice IDs (configurable)
 *
 * Presets are resolved at render time against the loaded voice library:
 * if a preset's voice isn't in the library, the preset is hidden rather
 * than breaking the UI.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Wand2, Mic } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  description?: string;
}

interface VoiceModifyPanelProps {
  audioUrl: string | null;
  parentGenerationId?: string;
  entityId?: string;
  universeId?: string;
  onComplete: (newAudioUrl: string, newGenerationId: string, presetLabel: string) => void;
}

/**
 * Effect presets — label + matcher. The matcher resolves a voice from the
 * live library (by category/labels/name substring). This avoids hardcoding
 * voice IDs that may not exist on a user's account.
 */
type PresetMatcher = (v: ElevenLabsVoice) => boolean;

interface EffectPreset {
  id: string;
  label: string;
  hint: string;
  match: PresetMatcher;
}

const EFFECT_PRESETS: EffectPreset[] = [
  {
    id: 'narrator-deep',
    label: 'Deep Narrator',
    hint: 'Cinematic, low & resonant',
    match: (v) =>
      /narrat|trailer|deep|film/i.test(
        `${v.name} ${v.description ?? ''} ${Object.values(v.labels ?? {}).join(' ')}`
      ),
  },
  {
    id: 'villain',
    label: 'Villain',
    hint: 'Menacing, gravelly',
    match: (v) =>
      /villain|evil|dark|demon|monster|raspy/i.test(
        `${v.name} ${v.description ?? ''} ${Object.values(v.labels ?? {}).join(' ')}`
      ),
  },
  {
    id: 'child',
    label: 'Child',
    hint: 'Young, bright',
    match: (v) =>
      /child|young|kid|teen/i.test(
        `${v.name} ${v.description ?? ''} ${Object.values(v.labels ?? {}).join(' ')}`
      ),
  },
  {
    id: 'elder',
    label: 'Elder',
    hint: 'Weathered, wise',
    match: (v) =>
      /old|elder|aged|grandpa|grandma/i.test(
        `${v.name} ${v.description ?? ''} ${Object.values(v.labels ?? {}).join(' ')}`
      ),
  },
  {
    id: 'whisper',
    label: 'Whisper',
    hint: 'Intimate, soft',
    match: (v) =>
      /whisper|soft|intimate|asmr/i.test(
        `${v.name} ${v.description ?? ''} ${Object.values(v.labels ?? {}).join(' ')}`
      ),
  },
  {
    id: 'announcer',
    label: 'Announcer',
    hint: 'Bold, broadcast',
    match: (v) =>
      /announce|broadcast|news|bold|commercial/i.test(
        `${v.name} ${v.description ?? ''} ${Object.values(v.labels ?? {}).join(' ')}`
      ),
  },
];

export function VoiceModifyPanel({
  audioUrl,
  parentGenerationId,
  entityId,
  universeId,
  onComplete,
}: VoiceModifyPanelProps) {
  const [targetVoiceId, setTargetVoiceId] = useState('');
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [removeNoise, setRemoveNoise] = useState(false);

  const voicesQuery = useQuery({
    queryKey: ['voices', 'list'],
    queryFn: async () => (await trpcClient.voice.listVoices.query()) as ElevenLabsVoice[],
    staleTime: 5 * 60_000,
  });

  const voices = voicesQuery.data ?? [];

  // Resolve presets against the live library. Hide presets with no match.
  const resolvedPresets = useMemo(() => {
    return EFFECT_PRESETS.map((p) => ({ ...p, voice: voices.find(p.match) })).filter(
      (p) => p.voice
    );
  }, [voices]);

  const costEstimate = useQuery({
    queryKey: ['voice', 'modify', 'estimate'],
    queryFn: async () => await trpcClient.voice.estimateCost.query({ type: 'voice_modify' }),
    staleTime: 60_000,
  });

  const modify = useMutation({
    mutationFn: async (opts: { voiceId: string; presetId?: string }) => {
      if (!audioUrl) throw new Error('No source audio to modify');
      return await trpcClient.voice.modify.mutate({
        audioUrl,
        targetVoiceId: opts.voiceId,
        modelId: 'eleven_multilingual_sts_v2',
        stability,
        similarityBoost,
        removeBackgroundNoise: removeNoise,
        ...(opts.presetId ? { presetId: opts.presetId } : {}),
        ...(parentGenerationId ? { parentGenerationId } : {}),
        ...(entityId ? { entityId } : {}),
        ...(universeId ? { universeId } : {}),
      });
    },
    onSuccess: (result, vars) => {
      if (result.status === 'completed' && result.audioUrl) {
        const label =
          vars.presetId ?? voices.find((v) => v.voice_id === vars.voiceId)?.name ?? 'modified';
        toast.success(`Voice modified (${result.creditsCharged} credits)`);
        onComplete(result.audioUrl, result.generationId, label);
      } else {
        toast.error('Modify did not return audio');
      }
    },
    onError: (err: Error) => toast.error(`Modify failed: ${err.message}`),
  });

  const disabled = !audioUrl || modify.isPending;

  if (!audioUrl) {
    return (
      <div className="text-center py-8 space-y-2">
        <Mic className="w-8 h-8 mx-auto text-muted-foreground/60" />
        <p className="text-xs text-muted-foreground">Load or generate audio to modify</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <audio src={audioUrl} controls className="w-full h-8" />
        <p className="text-[10px] text-muted-foreground mt-1">Source audio</p>
      </div>

      <Tabs defaultValue="swap" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="swap" className="flex-1 text-xs">
            Swap
          </TabsTrigger>
          <TabsTrigger value="effects" className="flex-1 text-xs">
            Effects
          </TabsTrigger>
        </TabsList>

        {/* Swap tab — pick any voice from the library */}
        <TabsContent value="swap" className="space-y-3 mt-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Target voice</label>
            <Select value={targetVoiceId} onValueChange={setTargetVoiceId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={voicesQuery.isLoading ? 'Loading…' : 'Choose a voice'} />
              </SelectTrigger>
              <SelectContent>
                {voices.map((v) => (
                  <SelectItem key={v.voice_id} value={v.voice_id} className="text-xs">
                    {v.name}
                    {v.category ? (
                      <span className="ml-2 text-muted-foreground">({v.category})</span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="w-full h-9"
            disabled={disabled || !targetVoiceId}
            onClick={() => modify.mutate({ voiceId: targetVoiceId })}
          >
            {modify.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4 mr-2" />
            )}
            Apply swap
          </Button>
        </TabsContent>

        {/* Effects tab — curated preset cards */}
        <TabsContent value="effects" className="space-y-3 mt-3">
          {voicesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Loading voices…</p>
          ) : resolvedPresets.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No effect presets resolved against your voice library. Use Swap instead.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {resolvedPresets.map((p) => (
                <Card
                  key={p.id}
                  className="p-2.5 cursor-pointer hover:bg-muted/20 transition-colors disabled:opacity-50"
                  onClick={() =>
                    !disabled && modify.mutate({ voiceId: p.voice!.voice_id, presetId: p.id })
                  }
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{p.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{p.hint}</p>
                    </div>
                    {modify.isPending && modify.variables?.presetId === p.id ? (
                      <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0 ml-1 mt-0.5" />
                    ) : null}
                  </div>
                  <Badge variant="secondary" className="mt-1.5 text-[9px]">
                    {p.voice!.name}
                  </Badge>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Shared settings */}
      <div className="space-y-3 pt-3 border-t border-border/40">
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="text-xs text-muted-foreground">Stability</label>
            <span className="text-xs tabular-nums">{stability.toFixed(2)}</span>
          </div>
          <Slider
            value={[stability]}
            onValueChange={([v]) => setStability(v)}
            min={0}
            max={1}
            step={0.05}
          />
        </div>
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="text-xs text-muted-foreground">Similarity boost</label>
            <span className="text-xs tabular-nums">{similarityBoost.toFixed(2)}</span>
          </div>
          <Slider
            value={[similarityBoost]}
            onValueChange={([v]) => setSimilarityBoost(v)}
            min={0}
            max={1}
            step={0.05}
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={removeNoise}
            onChange={(e) => setRemoveNoise(e.target.checked)}
            className="h-3 w-3"
          />
          Remove background noise
        </label>
        {costEstimate.data && (
          <p className="text-[10px] text-muted-foreground">
            Cost per modify: {costEstimate.data.credits} credits ($
            {costEstimate.data.fiatPriceUsd.toFixed(2)})
          </p>
        )}
      </div>
    </div>
  );
}
