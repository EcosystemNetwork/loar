/**
 * TalkingScenePanel — PRD 8 talking-character flow
 *
 * Image (portrait) + dialogue text + voice selection → talkingScene.create
 * combo endpoint runs TTS → image-to-video → lipsync → publishes a clip
 * with full source-ref lineage.
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Mic, Sparkles } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import { StylePresetPicker } from '@/components/StylePresetPicker';
import type { StylePresetId } from '@/components/style-presets';

interface TalkingScenePanelProps {
  imageUrl: string | null;
  onComplete: (videoUrl: string) => void;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
}

export function TalkingScenePanel({ imageUrl, onComplete }: TalkingScenePanelProps) {
  const [dialogue, setDialogue] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [voiceModelId, setVoiceModelId] = useState<
    'eleven_flash_v2_5' | 'eleven_v3' | 'eleven_turbo_v2' | 'eleven_multilingual_v2'
  >('eleven_v3');
  const [durationSec, setDurationSec] = useState(6);
  const [motionPrompt, setMotionPrompt] = useState('');
  // E4: style preset bias for the talking-scene clip
  const [stylePresetId, setStylePresetId] = useState<StylePresetId | null>(null);

  const voicesQuery = useQuery({
    queryKey: ['voices', 'list'],
    queryFn: async () => (await trpcClient.voice.listVoices.query()) as ElevenLabsVoice[],
    staleTime: 5 * 60_000,
  });

  // Pick the first voice as default once the list loads
  if (!voiceId && voicesQuery.data && voicesQuery.data.length > 0) {
    setVoiceId(voicesQuery.data[0].voice_id);
  }

  const costEstimate = useQuery({
    queryKey: ['talkingScene', 'estimate', dialogue.length],
    queryFn: async () =>
      dialogue.trim().length > 0
        ? await trpcClient.talkingScene.estimateCost.query({ dialogue })
        : null,
    enabled: dialogue.trim().length > 0,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!imageUrl) throw new Error('Load a portrait first');
      if (!voiceId) throw new Error('Pick a voice');
      if (!dialogue.trim()) throw new Error('Add some dialogue');
      return await trpcClient.talkingScene.create.mutate({
        imageUrl,
        dialogue,
        voiceId,
        voiceModelId,
        durationSec,
        motionPrompt: motionPrompt.trim() || undefined,
        // E4: forward style preset to the underlying generation
        stylePresetId: stylePresetId ?? undefined,
      } as any);
    },
    onSuccess: (r) => {
      const url = r?.videoUrl;
      if (!url) {
        toast.error('No talking-scene video returned');
        return;
      }
      toast.success('Talking scene ready');
      onComplete(url);
    },
    onError: (err: any) => toast.error(err?.message || 'Talking-scene generation failed'),
  });

  return (
    <div className="space-y-3">
      {!imageUrl && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-amber-400">
            Load a portrait image in the Input tab to bring it to life.
          </p>
        </Card>
      )}

      {/* Dialogue */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Dialogue ({dialogue.length}/2000)
        </label>
        <Textarea
          value={dialogue}
          onChange={(e) => setDialogue(e.target.value.slice(0, 2000))}
          placeholder="What does the character say? Keep it short — 1-3 sentences for a 6s clip."
          className="text-xs min-h-[90px]"
        />
      </div>

      {/* Voice picker */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Voice</label>
        <Select value={voiceId} onValueChange={setVoiceId} disabled={voicesQuery.isLoading}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue
              placeholder={voicesQuery.isLoading ? 'Loading voices...' : 'Pick a voice'}
            />
          </SelectTrigger>
          <SelectContent>
            {voicesQuery.data?.map((v) => (
              <SelectItem key={v.voice_id} value={v.voice_id}>
                <div className="flex items-center gap-2">
                  <Mic className="w-3 h-3 text-purple-400" />
                  <span>{v.name}</span>
                  {v.labels?.gender && (
                    <Badge variant="outline" className="text-[9px]">
                      {v.labels.gender}
                    </Badge>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* TTS quality */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Voice quality</label>
        <Select
          value={voiceModelId}
          onValueChange={(v) => setVoiceModelId(v as typeof voiceModelId)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="eleven_flash_v2_5">Flash (fast, cheap)</SelectItem>
            <SelectItem value="eleven_turbo_v2">Turbo (balanced)</SelectItem>
            <SelectItem value="eleven_multilingual_v2">Multilingual (29 languages)</SelectItem>
            <SelectItem value="eleven_v3">v3 (most expressive)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Duration */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Clip duration ({durationSec}s)
        </label>
        <Slider
          value={[durationSec]}
          onValueChange={([v]) => setDurationSec(v)}
          min={3}
          max={10}
          step={1}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Match dialogue length — too long and the character will be silent.
        </p>
      </div>

      {/* Optional motion prompt override */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Motion direction (optional)
        </label>
        <Textarea
          value={motionPrompt}
          onChange={(e) => setMotionPrompt(e.target.value)}
          placeholder="e.g. Character looks left then right while speaking, dramatic lighting"
          className="text-xs min-h-[50px]"
        />
      </div>

      {/* E4: Style preset */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Style</label>
        <StylePresetPicker value={stylePresetId} onChange={setStylePresetId} compact />
      </div>

      {/* Cost preview */}
      {costEstimate.data && (
        <Card className="p-2.5 bg-card/50">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Total cost
            </span>
            <span className="text-xs font-medium">{costEstimate.data.totalCredits} credits</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
            <div className="flex justify-between">
              <span>TTS</span>
              <span>{costEstimate.data.ttsCredits}</span>
            </div>
            <div className="flex justify-between">
              <span>Image-to-video</span>
              <span>{costEstimate.data.i2vCredits}</span>
            </div>
            <div className="flex justify-between">
              <span>Lip-sync</span>
              <span>{costEstimate.data.lipsyncCredits}</span>
            </div>
          </div>
        </Card>
      )}

      <Button
        className="w-full"
        disabled={!imageUrl || !voiceId || !dialogue.trim() || create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Generating talking scene (1-3 min)...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-2" />
            Create Talking Scene
          </>
        )}
      </Button>

      {create.data?.videoUrl && (
        <Card className="p-2 mt-2 border-green-500/20 bg-green-500/5">
          <Badge variant="secondary" className="text-[9px] mb-1">
            Linked: image + voice + animation
          </Badge>
          <video
            src={resolveIpfsUrl(create.data.videoUrl)}
            controls
            className="w-full rounded max-h-48"
          />
        </Card>
      )}
    </div>
  );
}
