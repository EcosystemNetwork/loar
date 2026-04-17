/**
 * MusicGenerationPanel — AI music/audio generation UI.
 *
 * Provides prompt input, model selection, duration picker, genre presets,
 * cost estimate, and playback of generated audio.
 */
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Music, Loader2, Sparkles, Clock, Coins } from 'lucide-react';
import { AudioPlayer } from '@/components/AudioPlayer';
import { useAudioGeneration, type AudioMode } from '@/hooks/useAudioGeneration';

const GENRE_PRESETS = [
  { label: 'Cinematic', value: 'cinematic orchestral' },
  { label: 'Ambient', value: 'ambient electronic' },
  { label: 'Epic', value: 'epic dramatic orchestral' },
  { label: 'Lo-Fi', value: 'lo-fi chill beats' },
  { label: 'Dark', value: 'dark atmospheric' },
  { label: 'Fantasy', value: 'fantasy adventure orchestral' },
  { label: 'Sci-Fi', value: 'sci-fi electronic synthwave' },
  { label: 'Horror', value: 'horror tension suspense' },
  { label: 'Action', value: 'action intense percussion' },
  { label: 'Peaceful', value: 'peaceful calm nature' },
];

const DURATION_OPTIONS = [
  { label: '5s', value: 5 },
  { label: '10s', value: 10 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '47s', value: 47 },
];

interface MusicGenerationPanelProps {
  entityId?: string;
  universeId?: string;
  entityName?: string;
  entityKind?: string;
  onGenerated?: (audioUrl: string) => void;
}

export function MusicGenerationPanel({
  entityId,
  universeId,
  entityName,
  entityKind,
  onGenerated,
}: MusicGenerationPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<AudioMode>('text_to_music');
  const [durationSec, setDurationSec] = useState(15);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [genre, setGenre] = useState('');
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [costEstimate, setCostEstimate] = useState<{
    credits: number;
    fiatPriceUsd: number;
    modelName: string;
  } | null>(null);

  const { models, isGenerating, generateMusic, estimateCost } = useAudioGeneration({
    entityId,
    universeId,
  });

  // Auto-fill prompt hint based on entity
  useEffect(() => {
    if (entityName && entityKind && !prompt) {
      const hints: Record<string, string> = {
        person: `Character theme music for ${entityName}`,
        place: `Ambient soundscape for ${entityName}`,
        faction: `Faction anthem for ${entityName}`,
        event: `Dramatic score for the event: ${entityName}`,
        vehicle: `Engine and motion sounds for ${entityName}`,
        species: `Nature sounds and theme for ${entityName}`,
      };
      setPrompt(hints[entityKind] || `Theme music for ${entityName}`);
    }
  }, [entityName, entityKind, prompt]);

  // Update cost estimate on param changes
  useEffect(() => {
    const updateEstimate = async () => {
      try {
        const est = await estimateCost({
          mode,
          durationSec,
          modelId: selectedModelId || undefined,
        });
        setCostEstimate(est);
      } catch {
        // Ignore estimate errors
      }
    };
    updateEstimate();
  }, [mode, durationSec, selectedModelId, estimateCost]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    const result = await generateMusic({
      prompt: prompt.trim(),
      mode,
      durationSec,
      routingMode: selectedModelId ? 'manual' : 'auto',
      selectedModelId: selectedModelId || undefined,
      genre: genre || undefined,
    });

    if (result?.audioUrl) {
      setGeneratedAudioUrl(result.audioUrl);
      onGenerated?.(result.audioUrl);
    }
  };

  const handleGenreSelect = (genreValue: string) => {
    setGenre(genreValue);
    if (!prompt.trim() || prompt === genre) {
      setPrompt(genreValue);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Music className="h-4 w-4" />
          Generate Music
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Genre presets */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Genre / Mood</Label>
          <div className="flex flex-wrap gap-1.5">
            {GENRE_PRESETS.map((g) => (
              <Badge
                key={g.value}
                variant={genre === g.value ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => handleGenreSelect(g.value)}
              >
                {g.label}
              </Badge>
            ))}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <Label htmlFor="music-prompt" className="text-xs text-muted-foreground mb-1.5 block">
            Describe the music
          </Label>
          <Textarea
            id="music-prompt"
            placeholder="Epic orchestral battle theme with rising tension and triumphant brass..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            maxLength={2000}
          />
        </div>

        {/* Mode + Duration row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Type</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as AudioMode)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text_to_music">Music</SelectItem>
                <SelectItem value="text_to_sound">Sound Design</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Duration</Label>
            <div className="flex gap-1">
              {DURATION_OPTIONS.map((d) => (
                <Button
                  key={d.value}
                  variant={durationSec === d.value ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs flex-1 px-1"
                  onClick={() => setDurationSec(d.value)}
                >
                  {d.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Model selection */}
        {models.length > 0 && (
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Model</Label>
            <Select value={selectedModelId} onValueChange={setSelectedModelId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Auto (smart routing)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Auto (smart routing)</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.displayName} — {m.bestFor}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Cost estimate */}
        {costEstimate && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            <span className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              {costEstimate.credits} credits
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {durationSec}s
            </span>
            <span className="text-muted-foreground/60">
              ${costEstimate.fiatPriceUsd.toFixed(2)} · {costEstimate.modelName}
            </span>
          </div>
        )}

        {/* Generate button */}
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Music
            </>
          )}
        </Button>

        {/* Generated audio playback */}
        {generatedAudioUrl && <AudioPlayer src={generatedAudioUrl} title={prompt.slice(0, 80)} />}
      </CardContent>
    </Card>
  );
}
