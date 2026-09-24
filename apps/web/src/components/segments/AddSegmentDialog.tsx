/**
 * AddSegmentDialog Component
 *
 * Dialog for adding new video segments to an event.
 * Supports both text-to-video and image-to-video generation modes.
 */

import { useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { useCreditCheck } from '@/hooks/useCreditCheck';
import { aspectRatioToImageSize } from '@/lib/segmentModels';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Zap, Image, Video, Sparkles, Check } from 'lucide-react';
import type { GenerationMode, VideoModel, AspectRatio } from '@/types/segments';
import { cn } from '@/lib/utils';

interface AddSegmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: SegmentGenerationConfig) => Promise<void>;
  isGenerating: boolean;
  eventDescription?: string;
  /** Universe characters available for image-to-video (from `wiki.characters`). */
  characters?: SegmentCharacter[];
}

export interface SegmentCharacter {
  id: string;
  character_name: string;
  image_url?: string;
}

/** `image.imageToImage` accepts at most two reference images. */
const MAX_FRAME_CHARACTERS = 2;

export interface SegmentGenerationConfig {
  mode: GenerationMode;
  prompt: string;
  model: VideoModel;
  duration: number;
  aspectRatio: AspectRatio;
  negativePrompt?: string;
  /** image-to-video only: the generated starting frame + the characters in it. */
  imageUrl?: string;
  characterIds?: string[];
  characterNames?: string[];
}

export function AddSegmentDialog({
  isOpen,
  onClose,
  onGenerate,
  isGenerating,
  eventDescription = '',
  characters = [],
}: AddSegmentDialogProps) {
  const [mode, setMode] = useState<GenerationMode>('text-to-video');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<VideoModel>('fal-veo3');
  const [duration, setDuration] = useState(8);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [negativePrompt, setNegativePrompt] = useState('');

  // image-to-video: characters → generated frame → video
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [isGeneratingFrame, setIsGeneratingFrame] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const { checkCredits, checkGenerationEnabled, invalidateBalance } = useCreditCheck();

  const selectedCharacters = characters.filter((c) => selectedCharacterIds.includes(c.id));

  const toggleCharacter = (id: string) => {
    setFrameUrl(null); // the frame no longer matches the selection
    setSelectedCharacterIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_FRAME_CHARACTERS
          ? [...prev.slice(1), id]
          : [...prev, id]
    );
  };

  const handleAspectChange = (v: string) => {
    setAspectRatio(v as AspectRatio);
    setFrameUrl(null); // the frame was sized for the previous ratio
  };

  const handleGenerateFrame = async () => {
    const refUrls = selectedCharacters
      .map((c) => c.image_url?.trim())
      .filter((u): u is string => !!u);
    if (!prompt.trim() || refUrls.length === 0) return;
    if (!checkGenerationEnabled()) return;
    if (!checkCredits('image')) return;

    setFrameError(null);
    setIsGeneratingFrame(true);
    try {
      const names = selectedCharacters.map((c) => c.character_name).join(' and ');
      const result = await trpcClient.image.imageToImage.mutate({
        prompt: `Create a cinematic frame: ${names} ${prompt.trim()}, cinematic scene, high quality, detailed environment. Professional photography, detailed environment, high quality composition`,
        imageUrls: refUrls,
        imageSize: aspectRatioToImageSize(aspectRatio),
        numImages: 1,
      });
      if (result.status !== 'completed' || !result.imageUrl) {
        throw new Error(result.error || 'Frame generation failed');
      }
      setFrameUrl(result.imageUrl);
      invalidateBalance();
    } catch (err) {
      setFrameError(err instanceof Error ? err.message : 'Frame generation failed');
    } finally {
      setIsGeneratingFrame(false);
    }
  };

  const resetForm = () => {
    setPrompt('');
    setNegativePrompt('');
    setFrameUrl(null);
    setFrameError(null);
    setSelectedCharacterIds([]);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    const isImageMode = mode === 'image-to-video';
    if (isImageMode && !frameUrl) return;

    await onGenerate({
      mode,
      prompt,
      model,
      duration,
      aspectRatio,
      negativePrompt: negativePrompt.trim() || undefined,
      ...(isImageMode
        ? {
            imageUrl: frameUrl!,
            characterIds: selectedCharacters.map((c) => c.id),
            characterNames: selectedCharacters.map((c) => c.character_name),
          }
        : {}),
    });

    resetForm();
  };

  const handleClose = () => {
    if (!isGenerating) {
      onClose();
    }
  };

  // Get available durations based on model
  const getAvailableDurations = (selectedModel: VideoModel): number[] => {
    switch (selectedModel) {
      case 'fal-kling':
      case 'fal-wan25':
        return [5, 10];
      case 'fal-sora':
        return [4, 8, 12];
      case 'seedance':
      case 'seedance-fast':
        return [5, 8, 10];
      case 'veo-31-preview-google':
      case 'veo-31-fast-preview-google':
      case 'veo-31-lite-preview-google':
      case 'veo-30-google':
      case 'veo-30-fast-google':
        // Google-direct Veo supports a fixed set; the server snaps anything else.
        return [4, 6, 8];
      case 'fal-veo3':
      default:
        return [4, 5, 8, 10];
    }
  };

  const availableDurations = getAvailableDurations(model);

  // Ensure selected duration is valid for model
  if (!availableDurations.includes(duration)) {
    setDuration(availableDurations[0]);
  }

  // Shared by both modes — rendered after the prompt (t2v) or once a frame exists (i2v).
  const settingsFields = (
    <>
      {/* Model Selection */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="model">AI Model</Label>
          <Select value={model} onValueChange={(v) => setModel(v as VideoModel)}>
            <SelectTrigger id="model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="veo-31-preview-google">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-sky-400" />
                  Veo 3.1 (Google)
                </div>
              </SelectItem>
              <SelectItem value="veo-31-fast-preview-google">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-sky-400" />
                  Veo 3.1 Fast (Google)
                </div>
              </SelectItem>
              <SelectItem value="veo-31-lite-preview-google">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-sky-400" />
                  Veo 3.1 Lite (Google)
                </div>
              </SelectItem>
              <SelectItem value="veo-30-google">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-sky-400" />
                  Veo 3.0 (Google)
                </div>
              </SelectItem>
              <SelectItem value="veo-30-fast-google">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-sky-400" />
                  Veo 3.0 Fast (Google)
                </div>
              </SelectItem>
              <SelectItem value="fal-veo3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  Veo 3.1 (via FAL)
                </div>
              </SelectItem>
              <SelectItem value="fal-kling">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  Kling 2.5
                </div>
              </SelectItem>
              <SelectItem value="fal-wan25">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  Wan 2.5
                </div>
              </SelectItem>
              <SelectItem value="fal-sora">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-orange-500" />
                  Sora 2
                </div>
              </SelectItem>
              <SelectItem value="seedance">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  Seedance
                </div>
              </SelectItem>
              <SelectItem value="seedance-fast">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-teal-500" />
                  Seedance Fast
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="duration">Duration</Label>
          <Select value={duration.toString()} onValueChange={(v) => setDuration(Number(v))}>
            <SelectTrigger id="duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableDurations.map((d) => (
                <SelectItem key={d} value={d.toString()}>
                  {d} seconds
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Aspect Ratio */}
      <div className="space-y-2">
        <Label htmlFor="aspectRatio">Aspect Ratio</Label>
        <Select value={aspectRatio} onValueChange={handleAspectChange}>
          <SelectTrigger id="aspectRatio">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Negative Prompt (Optional) */}
      <div className="space-y-2">
        <Label htmlFor="negativePrompt">Negative Prompt (Optional)</Label>
        <Textarea
          id="negativePrompt"
          placeholder="Things to avoid in the video (e.g., 'blur, low quality, distorted')"
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          rows={2}
          className="resize-none"
        />
      </div>
    </>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Video Segment</DialogTitle>
          <DialogDescription>
            Create a new video segment for this event using AI generation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Generation Mode Selection */}
          <div className="space-y-3">
            <Label>Generation Mode</Label>
            <div className="space-y-3">
              <Card
                className={cn(
                  'p-4 cursor-pointer transition-all hover:shadow-md',
                  mode === 'text-to-video' ? 'ring-2 ring-primary shadow-sm' : ''
                )}
                onClick={() => setMode('text-to-video')}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'h-5 w-5 rounded-full border-2 flex items-center justify-center mt-0.5 flex-shrink-0',
                      mode === 'text-to-video'
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground'
                    )}
                  >
                    {mode === 'text-to-video' && (
                      <Check className="h-3 w-3 text-primary-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="h-4 w-4 text-primary" />
                      <span className="font-semibold">Text-to-Video</span>
                      <Badge variant="secondary" className="ml-auto">
                        Faster
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Generate video directly from text prompt. Faster generation, ideal for scenes
                      without specific characters.
                    </p>
                  </div>
                </div>
              </Card>

              <Card
                className={cn(
                  'p-4 cursor-pointer transition-all hover:shadow-md',
                  mode === 'image-to-video' ? 'ring-2 ring-primary shadow-sm' : ''
                )}
                onClick={() => setMode('image-to-video')}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'h-5 w-5 rounded-full border-2 flex items-center justify-center mt-0.5 flex-shrink-0',
                      mode === 'image-to-video'
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground'
                    )}
                  >
                    {mode === 'image-to-video' && (
                      <Check className="h-3 w-3 text-primary-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Image className="h-4 w-4 text-primary" />
                      <span className="font-semibold">Image-to-Video</span>
                      <Badge variant="secondary" className="ml-auto">
                        With Characters
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Create image first with characters, then animate. More control over
                      composition and character placement.
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {mode === 'text-to-video' ? (
            /* Text-to-Video Form */
            <div className="space-y-4">
              {/* Prompt */}
              <div className="space-y-2">
                <Label htmlFor="prompt">Video Prompt</Label>
                <Textarea
                  id="prompt"
                  placeholder="Describe the video segment you want to create..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Be specific about the action, camera movement, and scene details
                </p>
              </div>

              {settingsFields}
            </div>
          ) : (
            /* Image-to-Video Form */
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Characters (pick up to {MAX_FRAME_CHARACTERS})</Label>
                {characters.length === 0 ? (
                  <Card className="p-4 bg-muted/50 border-dashed">
                    <p className="text-sm text-muted-foreground">
                      This universe has no characters yet. Add characters to the universe wiki, or
                      use Text-to-Video mode.
                    </p>
                  </Card>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                    {characters.map((c) => {
                      const selected = selectedCharacterIds.includes(c.id);
                      const usable = !!c.image_url?.trim();
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!usable || isGenerating || isGeneratingFrame}
                          onClick={() => toggleCharacter(c.id)}
                          aria-pressed={selected}
                          title={usable ? c.character_name : `${c.character_name} has no image`}
                          className={cn(
                            'relative rounded-md border overflow-hidden text-left transition-all',
                            selected ? 'ring-2 ring-primary' : 'hover:shadow-md',
                            !usable && 'opacity-40 cursor-not-allowed'
                          )}
                        >
                          {usable ? (
                            <img
                              src={c.image_url}
                              alt={c.character_name}
                              className="aspect-square w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="aspect-square w-full bg-muted" />
                          )}
                          <span className="block truncate px-1.5 py-1 text-xs">
                            {c.character_name}
                          </span>
                          {selected && (
                            <Check className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary p-0.5 text-primary-foreground" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="i2v-prompt">Scene &amp; Action Prompt</Label>
                <Textarea
                  id="i2v-prompt"
                  placeholder="Describe the scene and what happens (e.g., 'walks through a neon-lit market as rain starts to fall')..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Starting Frame</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateFrame}
                    disabled={
                      isGeneratingFrame ||
                      isGenerating ||
                      !prompt.trim() ||
                      selectedCharacterIds.length === 0
                    }
                  >
                    {isGeneratingFrame ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating frame...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        {frameUrl ? 'Regenerate Frame' : 'Generate Frame'}
                      </>
                    )}
                  </Button>
                </div>
                {frameUrl ? (
                  <img
                    src={frameUrl}
                    alt="Generated starting frame"
                    className="w-full max-h-64 rounded-md border object-contain bg-muted"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Generate a frame with your characters first, then animate it into a video.
                  </p>
                )}
                {frameError && (
                  <p className="text-xs text-destructive" role="alert">
                    {frameError}
                  </p>
                )}
              </div>

              {frameUrl && settingsFields}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={
              !prompt.trim() ||
              isGenerating ||
              isGeneratingFrame ||
              (mode === 'image-to-video' && !frameUrl)
            }
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Video className="h-4 w-4 mr-2" />
                Generate Segment
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
