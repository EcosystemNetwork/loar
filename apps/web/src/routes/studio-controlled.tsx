/**
 * Studio — Controlled Generation (PRD 7)
 *
 * Pose / composition / angle / scene control workspace. Creators upload
 * up to 4 guide images (sketch, pose, style ref, depth, previous shot),
 * pick a control type and strength per guide, optionally pick a camera
 * angle preset, and generate via the Google nano-banana-pro-preview
 * multi-reference path. Shots can be saved as templates for reuse.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DirectUpload } from '@/components/DirectUpload';
import { toast } from 'sonner';
import { useState } from 'react';
import { Wand2, Trash2, Loader2, ImagePlus, Save, BookOpen, Sparkles } from 'lucide-react';

export const Route = createFileRoute('/studio-controlled')({
  component: StudioControlledPage,
});

// ── Client-side mirror of server enums ───────────────────────────────

type ControlType = 'subject' | 'style' | 'scribble' | 'pose' | 'depth' | 'canny' | 'shot_reference';

const CONTROL_TYPE_OPTIONS: { value: ControlType; label: string; hint: string }[] = [
  { value: 'subject', label: 'Subject / Character', hint: 'Match character identity' },
  { value: 'style', label: 'Style Reference', hint: 'Transfer visual style' },
  { value: 'scribble', label: 'Sketch / Scribble', hint: 'Rough composition guide' },
  { value: 'pose', label: 'Pose Guide', hint: 'Replicate pose skeleton' },
  { value: 'depth', label: 'Depth Layout', hint: 'Scene depth arrangement' },
  { value: 'canny', label: 'Edge / Line Art', hint: 'Follow line structure' },
  { value: 'shot_reference', label: 'Previous Shot', hint: 'Cross-shot continuity' },
];

const ANGLE_PRESET_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'No angle preset' },
  { value: 'low_angle', label: 'Low Angle' },
  { value: 'high_angle', label: 'High Angle' },
  { value: 'close_up', label: 'Close-Up' },
  { value: 'extreme_close_up', label: 'Extreme Close-Up' },
  { value: 'medium_shot', label: 'Medium Shot' },
  { value: 'wide_establishing', label: 'Wide Establishing' },
  { value: 'over_shoulder', label: 'Over the Shoulder' },
  { value: 'dutch_tilt', label: 'Dutch Tilt' },
  { value: 'birds_eye', label: "Bird's Eye" },
  { value: 'worms_eye', label: "Worm's Eye" },
  { value: 'two_shot', label: 'Two Shot' },
];

const IMAGE_SIZES = [
  { value: 'square_hd', label: '1:1 Square' },
  { value: 'portrait_16_9', label: '9:16 Portrait' },
  { value: 'landscape_16_9', label: '16:9 Landscape' },
  { value: 'portrait_4_3', label: '3:4 Portrait' },
  { value: 'landscape_4_3', label: '4:3 Landscape' },
] as const;

type ImageSize = (typeof IMAGE_SIZES)[number]['value'];

interface GuideSlot {
  id: string;
  controlType: ControlType;
  guideImageUrl: string | null;
  guideContentHash: string | null;
  strength: number;
}

function emptySlot(controlType: ControlType = 'scribble'): GuideSlot {
  return {
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    controlType,
    guideImageUrl: null,
    guideContentHash: null,
    strength: 0.65,
  };
}

function strengthLabel(s: number): string {
  if (s < 0.2) return 'loose inspiration';
  if (s < 0.45) return 'general cues';
  if (s < 0.65) return 'follow closely';
  if (s < 0.85) return 'match tightly';
  return 'strict replica';
}

function StudioControlledPage() {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [imageSize, setImageSize] = useState<ImageSize>('landscape_16_9');
  const [anglePreset, setAnglePreset] = useState<string>('none');
  const [slots, setSlots] = useState<GuideSlot[]>([emptySlot('scribble')]);
  const [numImages, setNumImages] = useState(1);

  const [result, setResult] = useState<{ imageUrls: string[]; generationId: string } | null>(null);

  // Save-as-template state
  const [templateName, setTemplateName] = useState('');
  const [universeId, setUniverseId] = useState('');

  const { data: templates } = useQuery({
    queryKey: ['shot-templates'],
    queryFn: () => trpcClient.shotTemplates.list.query({ limit: 25 }),
    enabled: isAuthenticated,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const controls = slots
        .filter((s) => s.guideImageUrl)
        .map((s) => ({
          controlType: s.controlType,
          guideImageUrl: s.guideImageUrl!,
          strength: s.strength,
        }));

      if (controls.length === 0) {
        throw new Error('Upload at least one guide image');
      }
      if (!prompt.trim()) {
        throw new Error('Enter a prompt');
      }

      return trpcClient.image.generateControlled.mutate({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        imageSize,
        numImages,
        anglePreset: anglePreset === 'none' ? null : anglePreset,
        controls,
        universeId: universeId.trim() || undefined,
      });
    },
    onSuccess: (data) => {
      setResult({ imageUrls: data.imageUrls, generationId: data.generationId });
      toast.success(`Generated ${data.imageUrls.length} image(s)`);
    },
    onError: (error: Error) => {
      toast.error('Generation failed', { description: error.message });
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!templateName.trim()) throw new Error('Template name required');
      const controls = slots
        .filter((s) => s.guideImageUrl)
        .map((s) => ({
          controlType: s.controlType,
          guideImageUrl: s.guideImageUrl!,
          guideContentHash: s.guideContentHash ?? '',
          strength: s.strength,
        }));
      return trpcClient.shotTemplates.create.mutate({
        name: templateName.trim(),
        anglePreset: anglePreset === 'none' ? null : anglePreset,
        controls,
        basePrompt: prompt,
        universeId: universeId.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Template saved');
      setTemplateName('');
      queryClient.invalidateQueries({ queryKey: ['shot-templates'] });
    },
    onError: (error: Error) => {
      toast.error('Save failed', { description: error.message });
    },
  });

  const loadTemplate = (t: NonNullable<typeof templates>[number]) => {
    setPrompt(t.basePrompt || '');
    setAnglePreset(t.anglePreset || 'none');
    if (t.universeId) setUniverseId(t.universeId);
    setSlots(
      (t.controls || []).map((c) => ({
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `slot-${Date.now()}`,
        controlType: c.controlType as ControlType,
        guideImageUrl: c.guideImageUrl,
        guideContentHash: c.guideContentHash || null,
        strength: c.strength,
      }))
    );
    toast.success(`Loaded template: ${t.name}`);
  };

  const updateSlot = (id: string, patch: Partial<GuideSlot>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addSlot = () => {
    if (slots.length >= 4) {
      toast.error('Maximum 4 guide images');
      return;
    }
    setSlots((prev) => [...prev, emptySlot()]);
  };

  const removeSlot = (id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto max-w-2xl py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Studio — Controlled Generation</h1>
        <p className="text-muted-foreground mb-6">
          Sign in to use pose, composition, and angle controls.
        </p>
        <WalletConnectButton />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl py-8 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6" />
          Controlled Generation
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Upload sketches, pose guides, or reference shots. Set strength sliders to control how
          tightly the output follows each guide. Save combinations as shot templates for reuse.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main generation panel */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <Label htmlFor="prompt">Prompt</Label>
                <Textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="A lone traveler approaches a ruined tower at dusk..."
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="negative">Negative Prompt (optional)</Label>
                <Input
                  id="negative"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="blurry, low quality, extra limbs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Camera Angle</Label>
                  <Select value={anglePreset} onValueChange={setAnglePreset}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ANGLE_PRESET_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Aspect</Label>
                  <Select value={imageSize} onValueChange={(v) => setImageSize(v as ImageSize)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_SIZES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Universe ID (optional)</Label>
                  <Input
                    value={universeId}
                    onChange={(e) => setUniverseId(e.target.value)}
                    placeholder="0x... (for wiki context)"
                  />
                </div>
                <div>
                  <Label>Images</Label>
                  <Select value={String(numImages)} onValueChange={(v) => setNumImages(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Guide slots */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Guide Images ({slots.length}/4)</h2>
              <Button variant="outline" size="sm" onClick={addSlot} disabled={slots.length >= 4}>
                <ImagePlus className="h-4 w-4 mr-1" /> Add guide
              </Button>
            </div>

            {slots.map((slot, idx) => (
              <Card key={slot.id}>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">Reference {idx + 1}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSlot(slot.id)}
                      disabled={slots.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div>
                    <Label>Control Type</Label>
                    <Select
                      value={slot.controlType}
                      onValueChange={(v) => updateSlot(slot.id, { controlType: v as ControlType })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTROL_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label} — <span className="opacity-60">{o.hint}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {slot.guideImageUrl ? (
                    <div className="space-y-2">
                      <img
                        src={slot.guideImageUrl}
                        alt={`Guide ${idx + 1}`}
                        className="w-full max-h-48 object-contain rounded border bg-muted"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateSlot(slot.id, {
                            guideImageUrl: null,
                            guideContentHash: null,
                          })
                        }
                      >
                        Replace
                      </Button>
                    </div>
                  ) : (
                    <DirectUpload
                      label="Drop a sketch, pose guide, or reference"
                      acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
                      maxSizeMB={10}
                      onUploadComplete={(manifest, previewUrl) => {
                        updateSlot(slot.id, {
                          guideImageUrl: manifest.uploads[0]?.url || previewUrl,
                          guideContentHash: manifest.contentHash,
                        });
                      }}
                    />
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label>Strength</Label>
                      <span className="text-xs text-muted-foreground">
                        {slot.strength.toFixed(2)} — {strengthLabel(slot.strength)}
                      </span>
                    </div>
                    <Slider
                      value={[slot.strength]}
                      onValueChange={(v) => updateSlot(slot.id, { strength: v[0] })}
                      min={0}
                      max={1}
                      step={0.05}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" /> Generate
              </>
            )}
          </Button>

          {/* Results */}
          {result && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <h3 className="font-semibold">Result</h3>
                <div
                  className={`grid gap-2 ${
                    result.imageUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                  }`}
                >
                  {result.imageUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={`Result ${i + 1}`} className="w-full rounded border" />
                    </a>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Generation ID: <code>{result.generationId}</code>
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar: save/load templates */}
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Save className="h-4 w-4" /> Save as Template
              </h3>
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template name"
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => saveTemplateMutation.mutate()}
                disabled={saveTemplateMutation.isPending || !templateName.trim()}
              >
                Save current setup
              </Button>
              <p className="text-xs text-muted-foreground">
                Saves angle, prompt, guides, and strengths.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <BookOpen className="h-4 w-4" /> Your Templates
              </h3>
              {templates && templates.length > 0 ? (
                <ul className="space-y-2">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => loadTemplate(t)}
                        className="w-full text-left p-2 rounded border hover:bg-accent transition"
                      >
                        <div className="font-medium text-sm">{t.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.controls.length} guide{t.controls.length !== 1 ? 's' : ''}
                          {t.anglePreset ? ` · ${t.anglePreset}` : ''}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No templates yet. Save one from your current setup.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
