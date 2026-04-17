/**
 * UniverseStyleManager — Visual style lock for a universe.
 *
 * Lets universe owners define and lock a canonical visual style that is
 * injected into every AI generation within the universe. Non-owners see
 * the current style in read-only mode.
 */
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { trpc, queryClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Lock,
  Unlock,
  Save,
  Loader2,
  Palette,
  Sun,
  Image,
  RectangleHorizontal,
  Sparkles,
  X,
  Plus,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

interface UniverseStyleManagerProps {
  universeAddress: string;
  isOwner: boolean;
}

interface StyleConfig {
  visualStyle: string;
  cinematicStyle: string;
  colorPalette: string;
  lightingPreset: string;
  eraSetting: string;
  stylePrompt: string;
  negativePrompt: string;
  referenceImages: string[];
  defaultAspectRatio: string;
  locked: boolean;
}

const EMPTY_STYLE: StyleConfig = {
  visualStyle: '',
  cinematicStyle: '',
  colorPalette: '',
  lightingPreset: '',
  eraSetting: '',
  stylePrompt: '',
  negativePrompt: '',
  referenceImages: [],
  defaultAspectRatio: '16:9',
  locked: false,
};

const VISUAL_STYLES = [
  { label: 'Anime', value: 'anime' },
  { label: 'Photorealistic', value: 'photorealistic' },
  { label: 'Watercolor', value: 'watercolor' },
  { label: 'Noir', value: 'noir' },
  { label: 'Pixel Art', value: 'pixel art' },
  { label: 'Oil Painting', value: 'oil painting' },
  { label: 'Comic Book', value: 'comic book' },
  { label: '3D Render', value: '3D render' },
] as const;

const LIGHTING_PRESETS = [
  { label: 'Golden Hour', value: 'golden hour' },
  { label: 'Neon Noir', value: 'neon noir' },
  { label: 'Natural Daylight', value: 'natural daylight' },
  { label: 'Studio', value: 'studio' },
  { label: 'Candlelit', value: 'candlelit' },
  { label: 'Overcast', value: 'overcast' },
] as const;

const ASPECT_RATIOS = [
  { label: '16:9 (Landscape)', value: '16:9' },
  { label: '9:16 (Portrait)', value: '9:16' },
  { label: '1:1 (Square)', value: '1:1' },
  { label: '4:5 (Social)', value: '4:5' },
] as const;

const CINEMATIC_SUGGESTIONS = [
  'Wes Anderson',
  'Blade Runner',
  'Studio Ghibli',
  'Christopher Nolan',
  'David Lynch',
  'Akira Kurosawa',
  'Denis Villeneuve',
  'Ridley Scott',
  'Terrence Malick',
  'Wong Kar-wai',
];

const MAX_REFERENCE_IMAGES = 5;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function UniverseStyleManager({ universeAddress, isOwner }: UniverseStyleManagerProps) {
  const { data: fetchedStyle, isLoading } = useQuery(
    trpc.universeStyle.get.queryOptions({ universeAddress })
  );

  const [form, setForm] = useState<StyleConfig>(EMPTY_STYLE);
  const [showCinematicSuggestions, setShowCinematicSuggestions] = useState(false);

  // Seed form from fetched data
  useEffect(() => {
    if (fetchedStyle) {
      const s = fetchedStyle as any;
      setForm({
        visualStyle: s.visualStyle || '',
        cinematicStyle: s.cinematicStyle || '',
        colorPalette: s.colorPalette || '',
        lightingPreset: s.lightingPreset || '',
        eraSetting: s.eraSetting || '',
        stylePrompt: s.stylePrompt || '',
        negativePrompt: s.negativePrompt || '',
        referenceImages: s.referenceImages || [],
        defaultAspectRatio: s.defaultAspectRatio || '16:9',
        locked: s.locked ?? false,
      });
    }
  }, [fetchedStyle]);

  const saveMutation = useMutation(
    trpc.universeStyle.upsert.mutationOptions({
      onSuccess: () => {
        toast.success('Style saved');
        queryClient.invalidateQueries({
          queryKey: [['universeStyle', 'get'], { input: { universeAddress } }],
        });
      },
      onError: (err: any) => {
        toast.error(err.message || 'Failed to save style');
      },
    })
  );

  const handleSave = () => {
    saveMutation.mutate({
      universeAddress,
      ...form,
    });
  };

  const toggleLock = () => {
    setForm((prev) => ({ ...prev, locked: !prev.locked }));
  };

  // Build the composed prompt preview
  const composedPrompt = useMemo(() => {
    const parts: string[] = [];
    if (form.visualStyle) parts.push(`Style: ${form.visualStyle}`);
    if (form.cinematicStyle) parts.push(`Cinematic: ${form.cinematicStyle}`);
    if (form.colorPalette) parts.push(`Colors: ${form.colorPalette}`);
    if (form.lightingPreset) parts.push(`Lighting: ${form.lightingPreset}`);
    if (form.eraSetting) parts.push(`Era: ${form.eraSetting}`);
    if (form.stylePrompt) parts.push(form.stylePrompt);
    return parts.join('. ') || 'No style configured yet.';
  }, [form]);

  /* helper to update a single form field */
  const set = <K extends keyof StyleConfig>(key: K, value: StyleConfig[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /* reference image helpers */
  const addRefImage = () => {
    if (form.referenceImages.length >= MAX_REFERENCE_IMAGES) return;
    set('referenceImages', [...form.referenceImages, '']);
  };
  const updateRefImage = (idx: number, url: string) => {
    const next = [...form.referenceImages];
    next[idx] = url;
    set('referenceImages', next);
  };
  const removeRefImage = (idx: number) => {
    set(
      'referenceImages',
      form.referenceImages.filter((_, i) => i !== idx)
    );
  };

  /* cinematic autocomplete filter */
  const filteredCinematicSuggestions = form.cinematicStyle
    ? CINEMATIC_SUGGESTIONS.filter((s) =>
        s.toLowerCase().includes(form.cinematicStyle.toLowerCase())
      )
    : CINEMATIC_SUGGESTIONS;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
      {/* Header + lock toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Palette className="h-5 w-5 text-violet-400" />
          Universe Style
        </h2>
        {isOwner ? (
          <button
            type="button"
            onClick={toggleLock}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              form.locked
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            {form.locked ? (
              <>
                <Lock className="h-3.5 w-3.5" />
                Locked
              </>
            ) : (
              <>
                <Unlock className="h-3.5 w-3.5" />
                Unlocked
              </>
            )}
          </button>
        ) : (
          <Badge
            variant="secondary"
            className={
              form.locked
                ? 'bg-violet-600/20 text-violet-300 border-violet-500/40'
                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }
          >
            {form.locked ? (
              <>
                <Lock className="h-3 w-3 mr-1" /> Locked
              </>
            ) : (
              <>
                <Unlock className="h-3 w-3 mr-1" /> Unlocked
              </>
            )}
          </Badge>
        )}
      </div>

      {form.locked && !isOwner && (
        <p className="text-sm text-zinc-500">
          The universe owner has locked the visual style. All generations will use the settings
          below.
        </p>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: settings form */}
        <div className="space-y-5">
          {/* Visual Style */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Visual Style</Label>
            {isOwner ? (
              <Select value={form.visualStyle} onValueChange={(v) => set('visualStyle', v)}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue placeholder="Select a visual style" />
                </SelectTrigger>
                <SelectContent>
                  {VISUAL_STYLES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <ReadOnlyField value={form.visualStyle} />
            )}
          </div>

          {/* Cinematic Style */}
          <div className="space-y-1.5 relative">
            <Label className="text-zinc-300">Cinematic Style</Label>
            {isOwner ? (
              <>
                <Input
                  value={form.cinematicStyle}
                  onChange={(e) => set('cinematicStyle', e.target.value)}
                  onFocus={() => setShowCinematicSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowCinematicSuggestions(false), 150)}
                  placeholder="e.g. Wes Anderson, Blade Runner"
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                />
                {showCinematicSuggestions && filteredCinematicSuggestions.length > 0 && (
                  <div className="absolute z-20 top-full mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {filteredCinematicSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
                        onMouseDown={() => {
                          set('cinematicStyle', suggestion);
                          setShowCinematicSuggestions(false);
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <ReadOnlyField value={form.cinematicStyle} />
            )}
          </div>

          {/* Color Palette */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Color Palette</Label>
            {isOwner ? (
              <Input
                value={form.colorPalette}
                onChange={(e) => set('colorPalette', e.target.value)}
                placeholder="e.g. muted earth tones, neon cyan and magenta"
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
              />
            ) : (
              <ReadOnlyField value={form.colorPalette} />
            )}
          </div>

          {/* Lighting Preset */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Lighting Preset</Label>
            {isOwner ? (
              <Select value={form.lightingPreset} onValueChange={(v) => set('lightingPreset', v)}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue placeholder="Select lighting" />
                </SelectTrigger>
                <SelectContent>
                  {LIGHTING_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <ReadOnlyField value={form.lightingPreset} />
            )}
          </div>

          {/* Era / Setting */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Era / Setting</Label>
            {isOwner ? (
              <Input
                value={form.eraSetting}
                onChange={(e) => set('eraSetting', e.target.value)}
                placeholder="e.g. 1920s, cyberpunk 2077, medieval"
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
              />
            ) : (
              <ReadOnlyField value={form.eraSetting} />
            )}
          </div>

          {/* Style Prompt */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Style Prompt</Label>
            <p className="text-xs text-zinc-500">
              Custom text injected into every generation prompt.
            </p>
            {isOwner ? (
              <Textarea
                value={form.stylePrompt}
                onChange={(e) => set('stylePrompt', e.target.value)}
                placeholder="Detailed style instructions appended to all prompts..."
                rows={3}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
              />
            ) : (
              <ReadOnlyField value={form.stylePrompt} multiline />
            )}
          </div>

          {/* Negative Prompt */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Negative Prompt</Label>
            <p className="text-xs text-zinc-500">Terms to exclude from all generations.</p>
            {isOwner ? (
              <Textarea
                value={form.negativePrompt}
                onChange={(e) => set('negativePrompt', e.target.value)}
                placeholder="blur, low quality, watermark, text..."
                rows={2}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
              />
            ) : (
              <ReadOnlyField value={form.negativePrompt} multiline />
            )}
          </div>

          {/* Default Aspect Ratio */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Default Aspect Ratio</Label>
            {isOwner ? (
              <Select
                value={form.defaultAspectRatio}
                onValueChange={(v) => set('defaultAspectRatio', v)}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((ar) => (
                    <SelectItem key={ar.value} value={ar.value}>
                      {ar.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <ReadOnlyField value={form.defaultAspectRatio} />
            )}
          </div>

          {/* Reference Images */}
          <div className="space-y-2">
            <Label className="text-zinc-300">
              Reference Images ({form.referenceImages.length}/{MAX_REFERENCE_IMAGES})
            </Label>
            {form.referenceImages.map((url, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                {isOwner ? (
                  <>
                    <Input
                      value={url}
                      onChange={(e) => updateRefImage(idx, e.target.value)}
                      placeholder={`Reference image URL #${idx + 1}`}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-500 hover:text-red-400 flex-shrink-0"
                      onClick={() => removeRefImage(idx)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <ReadOnlyField value={url} />
                )}
                {/* Thumbnail preview */}
                {url && (
                  <div className="flex-shrink-0 w-10 h-10 rounded border border-zinc-700 overflow-hidden bg-zinc-800">
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
            {isOwner && form.referenceImages.length < MAX_REFERENCE_IMAGES && (
              <Button
                variant="outline"
                size="sm"
                className="border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                onClick={addRefImage}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Reference Image
              </Button>
            )}
          </div>
        </div>

        {/* Right column: preview + save */}
        <div className="space-y-5">
          {/* Composed prompt preview */}
          <Card className="bg-zinc-800/50 border-zinc-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Composed Style Prompt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-300 leading-relaxed min-h-[4rem]">
                {composedPrompt}
              </div>
              {form.negativePrompt && (
                <div className="mt-3">
                  <p className="text-xs text-zinc-500 mb-1">Negative:</p>
                  <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs text-red-300/70">
                    {form.negativePrompt}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reference image gallery */}
          {form.referenceImages.filter(Boolean).length > 0 && (
            <Card className="bg-zinc-800/50 border-zinc-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Image className="h-4 w-4" />
                  Reference Images
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {form.referenceImages.filter(Boolean).map((url, idx) => (
                    <div
                      key={idx}
                      className="aspect-square rounded-lg border border-zinc-700 overflow-hidden bg-zinc-900"
                    >
                      <img
                        src={url}
                        alt={`Reference ${idx + 1}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '';
                          (e.target as HTMLImageElement).alt = 'Failed to load';
                        }}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Aspect ratio preview */}
          <Card className="bg-zinc-800/50 border-zinc-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <RectangleHorizontal className="h-4 w-4" />
                Aspect Ratio Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center">
              <AspectRatioPreview ratio={form.defaultAspectRatio} />
            </CardContent>
          </Card>

          {/* Style summary badges */}
          <div className="flex flex-wrap gap-2">
            {form.visualStyle && (
              <Badge className="bg-violet-600/20 text-violet-300 border-violet-500/30">
                <Palette className="h-3 w-3 mr-1" />
                {form.visualStyle}
              </Badge>
            )}
            {form.lightingPreset && (
              <Badge className="bg-amber-600/20 text-amber-300 border-amber-500/30">
                <Sun className="h-3 w-3 mr-1" />
                {form.lightingPreset}
              </Badge>
            )}
            {form.defaultAspectRatio && (
              <Badge className="bg-sky-600/20 text-sky-300 border-sky-500/30">
                <RectangleHorizontal className="h-3 w-3 mr-1" />
                {form.defaultAspectRatio}
              </Badge>
            )}
            {form.eraSetting && (
              <Badge className="bg-emerald-600/20 text-emerald-300 border-emerald-500/30">
                {form.eraSetting}
              </Badge>
            )}
            {form.locked && (
              <Badge className="bg-violet-600/20 text-violet-300 border-violet-500/30">
                <Lock className="h-3 w-3 mr-1" />
                Style Locked
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Save button (owner only) */}
      {isOwner && (
        <div className="flex justify-end pt-2 border-t border-zinc-800">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="bg-violet-600 hover:bg-violet-700 text-white px-6"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-1.5" />
                Save Style
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function ReadOnlyField({ value, multiline }: { value: string; multiline?: boolean }) {
  if (!value) {
    return <p className="text-sm text-zinc-600 italic px-4 py-2">Not set</p>;
  }
  return multiline ? (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-300 whitespace-pre-wrap">
      {value}
    </div>
  ) : (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-300">
      {value}
    </div>
  );
}

function AspectRatioPreview({ ratio }: { ratio: string }) {
  const dims: Record<string, { w: number; h: number }> = {
    '16:9': { w: 128, h: 72 },
    '9:16': { w: 54, h: 96 },
    '1:1': { w: 80, h: 80 },
    '4:5': { w: 64, h: 80 },
  };
  const d = dims[ratio] || dims['16:9'];

  return (
    <div
      className="border-2 border-dashed border-zinc-600 rounded flex items-center justify-center text-xs text-zinc-500"
      style={{ width: d.w, height: d.h }}
    >
      {ratio}
    </div>
  );
}
