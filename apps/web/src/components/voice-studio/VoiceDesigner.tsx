/**
 * Voice Studio — Create tab.
 *
 * Parametric voice synthesis: describe a voice in words + pick gender/age/accent,
 * we hit ElevenLabs Voice Design to mint a brand-new voice from scratch, render
 * a preview line, then let the user save it into My Voices as `source='design'`,
 * `rightsClass='owned'`.
 *
 * Pipeline:
 *   voice.designVoice           → returns { voiceId, audioUrl, generationId }
 *   voiceLibrary.registerDesign → persists into userVoices, idempotent on genId
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wand2, Loader2, Sparkles, Save, Play, Pause, RotateCcw } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Gender = 'male' | 'female' | 'neutral';
type AgeBand = 'young' | 'middle_aged' | 'old';

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'neutral', label: 'Neutral / androgynous' },
];

const AGES: { value: AgeBand; label: string }[] = [
  { value: 'young', label: 'Young (18–30)' },
  { value: 'middle_aged', label: 'Middle-aged (30–55)' },
  { value: 'old', label: 'Older (55+)' },
];

// ElevenLabs Voice Design accent labels — accepts free-text, these are the
// most reliable values.
const ACCENTS = [
  'american',
  'british',
  'australian',
  'indian',
  'irish',
  'scottish',
  'south african',
  'canadian',
  'african',
  'french',
  'german',
  'italian',
  'spanish',
  'mexican',
  'brazilian',
  'russian',
  'middle eastern',
  'east asian',
  'southeast asian',
];

interface PreviewResult {
  generationId: string;
  voiceId: string;
  audioUrl: string;
  name: string;
  creditsCharged: number;
}

const DEFAULT_PREVIEW =
  'The lighthouse keeper struck a match, watched the wick catch, and stepped into the dark.';

export function VoiceDesigner() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gender, setGender] = useState<Gender>('female');
  const [age, setAge] = useState<AgeBand>('middle_aged');
  const [accent, setAccent] = useState('american');
  const [accentStrength, setAccentStrength] = useState(1.0);
  const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const designMutation = useMutation({
    mutationFn: () =>
      trpcClient.voice.designVoice.mutate({
        name: name.trim(),
        description: description.trim(),
        previewText: previewText.trim(),
        gender,
        age,
        accent,
        accentStrength,
      }),
    onSuccess: (r) => {
      setResult({
        generationId: r.generationId,
        voiceId: r.voiceId,
        audioUrl: r.audioUrl,
        name: r.name,
        creditsCharged: r.creditsCharged,
      });
      toast.success('Voice designed — preview ready');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!result) throw new Error('Design a voice first');
      return trpcClient.voiceLibrary.registerDesign.mutate({
        voiceId: result.voiceId,
        name: name.trim(),
        description: description.trim() || undefined,
        previewUrl: result.audioUrl,
        tags: [accent, gender, age],
        designGenerationId: result.generationId,
      });
    },
    onSuccess: () => {
      toast.success('Saved to My Voices');
      queryClient.invalidateQueries({ queryKey: ['voiceLibrary', 'myVoices'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function togglePreview() {
    if (!result?.audioUrl) return;
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    if (playing) {
      setPlaying(false);
      return;
    }
    const a = new Audio(result.audioUrl);
    a.onended = () => setPlaying(false);
    a.play().catch((e) => toast.error(`Preview failed: ${e.message}`));
    setAudioEl(a);
    setPlaying(true);
  }

  function reset() {
    setResult(null);
    if (audioEl) {
      audioEl.pause();
      setPlaying(false);
    }
  }

  const canDesign =
    name.trim().length > 0 &&
    description.trim().length >= 10 &&
    previewText.trim().length >= 10 &&
    !designMutation.isPending;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wand2 className="size-4 text-sky-400" /> Design a new voice
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Describe a voice in plain English. We synthesize a brand-new vocal identity from scratch
            — no samples needed. You own everything you design.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label htmlFor="design-name">Name</Label>
            <Input
              id="design-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Vesper Halloran"
              maxLength={80}
            />
          </div>

          <div>
            <Label htmlFor="design-desc">Voice description</Label>
            <Textarea
              id="design-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A raspy, weathered narrator in his fifties — like a noir detective who's seen too much. Smoky, deliberate, low register."
              rows={4}
              maxLength={500}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {description.length}/500 · Be specific about timbre, pace, and emotional register.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Gender</Label>
              <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENDERS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Age</Label>
              <Select value={age} onValueChange={(v) => setAge(v as AgeBand)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Accent</Label>
            <Select value={accent} onValueChange={setAccent}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCENTS.map((a) => (
                  <SelectItem key={a} value={a} className="capitalize">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <Label>Accent strength</Label>
              <span className="text-xs text-muted-foreground">{accentStrength.toFixed(1)}</span>
            </div>
            <Slider
              min={0.3}
              max={2.0}
              step={0.1}
              value={[accentStrength]}
              onValueChange={([v]) => setAccentStrength(v ?? 1.0)}
              className="mt-2"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              0.3 = subtle hint · 2.0 = pronounced
            </p>
          </div>

          <div>
            <Label htmlFor="design-preview">Preview line</Label>
            <Textarea
              id="design-preview"
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              rows={2}
              maxLength={300}
            />
          </div>

          <Button onClick={() => designMutation.mutate()} disabled={!canDesign}>
            {designMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Designing voice…
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 size-3.5" />
                Design voice
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {result ? (
            <>
              <div className="rounded border border-border p-3">
                <p className="text-sm font-semibold">{result.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Voice ID <span className="font-mono">{result.voiceId.slice(0, 12)}…</span> · ⟁{' '}
                  {result.creditsCharged} credits
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={togglePreview}>
                    {playing ? (
                      <>
                        <Pause className="mr-1.5 size-3.5" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="mr-1.5 size-3.5" /> Play preview
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={reset}
                    title="Discard this design and start over"
                  >
                    <RotateCcw className="mr-1.5 size-3.5" /> Try again
                  </Button>
                </div>
              </div>

              <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
                <p className="text-xs font-semibold text-emerald-300">
                  You own this voice (rightsClass: owned)
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Designed voices are 100% original IP — usable in the Voice Mixer, mintable as
                  episode audio, and licensable to other creators.
                </p>
              </div>

              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || saveMutation.isSuccess}
              >
                {saveMutation.isSuccess ? (
                  'Saved'
                ) : saveMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="mr-1.5 size-3.5" />
                    Save to My Voices
                  </>
                )}
              </Button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Wand2 className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Fill the form on the left, then click <strong>Design voice</strong>. We'll
                synthesize a brand-new vocal identity and let you preview it before saving.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
