/**
 * RelightPanel — Transform an existing image into a new lighting / time of
 * day / backdrop / color mood while preserving subject identity.
 *
 * Stacks zero or more presets (lighting, time, backdrop, mood), an optional
 * universe "house look" tone pack, and free-text refinements, then submits
 * to the `editing.relight` mutation. Renders the new variant inline once
 * the job completes.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpc } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sun, Clock, Image as ImageIcon, Palette, Loader2, Wand2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type PresetKind = 'lighting' | 'time' | 'backdrop' | 'mood';
interface PresetSummary {
  id: string;
  kind: PresetKind;
  label: string;
  description: string;
}
interface PresetGroups {
  lighting: PresetSummary[];
  time: PresetSummary[];
  backdrop: PresetSummary[];
  mood: PresetSummary[];
}

const KIND_META: Record<PresetKind, { label: string; Icon: typeof Sun }> = {
  lighting: { label: 'Lighting', Icon: Sun },
  time: { label: 'Time of Day', Icon: Clock },
  backdrop: { label: 'Backdrop', Icon: ImageIcon },
  mood: { label: 'Color Mood', Icon: Palette },
};

interface RelightPanelProps {
  /** Source image URL (HTTPS or Pinata). Required. */
  imageUrl: string;
  /** Optional universe address — surfaces tone packs and tags the gallery doc. */
  universeAddress?: string;
  /** Optional source attachment ID — chains the new image as a media variant. */
  sourceAttachmentId?: string;
  /** Optional source generation ID — links the editing job back to its origin. */
  sourceGenerationId?: string;
  /** Called once the relight job completes successfully. */
  onSuccess?: (output: { jobId: string; imageUrl: string; images: string[] }) => void;
}

export function RelightPanel({
  imageUrl,
  universeAddress,
  sourceAttachmentId,
  sourceGenerationId,
  onSuccess,
}: RelightPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState('');
  const [tonePackId, setTonePackId] = useState<string | undefined>(undefined);
  const [numImages, setNumImages] = useState(1);
  const [results, setResults] = useState<string[]>([]);

  const presetsQuery = useQuery(trpc.editing.relightPresets.queryOptions());
  const presets = (presetsQuery.data ?? {
    lighting: [],
    time: [],
    backdrop: [],
    mood: [],
  }) as PresetGroups;

  const tonePacksQuery = useQuery({
    ...trpc.universeTonePacks.list.queryOptions({ universeAddress: universeAddress ?? '' }),
    enabled: Boolean(universeAddress),
  });

  const relightMutation = useMutation(
    trpc.editing.relight.mutationOptions({
      onSuccess: (data: any) => {
        const imgs: string[] = data.images ?? (data.imageUrl ? [data.imageUrl] : []);
        setResults(imgs);
        toast.success(`Relight complete · ${data.creditsCharged} credits`);
        onSuccess?.({ jobId: data.jobId, imageUrl: data.imageUrl, images: imgs });
      },
      onError: (err: any) => {
        toast.error(err.message || 'Relight failed');
      },
    })
  );

  const togglePreset = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 8) next.add(id);
      else toast.error('Stack at most 8 presets');
      return next;
    });
  };

  const canSubmit = useMemo(
    () => Boolean(imageUrl) && (selected.size > 0 || freeText.trim().length > 0),
    [imageUrl, selected.size, freeText]
  );

  const handleSubmit = () => {
    if (!canSubmit || relightMutation.isPending) return;
    relightMutation.mutate({
      imageUrl,
      presetIds: Array.from(selected),
      freeText: freeText.trim() || undefined,
      tonePackId: tonePackId || undefined,
      universeAddress,
      sourceGenerationId,
      sourceAttachmentId,
      numImages,
      publishToGallery: true,
    });
  };

  const renderGroup = (kind: PresetKind, items: PresetSummary[]) => {
    if (items.length === 0) return null;
    const { label, Icon } = KIND_META[kind];
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map((p) => {
            const active = selected.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePreset(p.id)}
                title={p.description}
                className={
                  'rounded-full border px-3 py-1 text-xs transition ' +
                  (active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-muted')
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4" />
            Source Image
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="aspect-square overflow-hidden rounded-md border bg-muted">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Source"
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No source image
              </div>
            )}
          </div>
          {results.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-sm font-medium">Output{results.length > 1 ? 's' : ''}</div>
              <div className={results.length > 1 ? 'grid grid-cols-2 gap-2' : ''}>
                {results.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="block aspect-square overflow-hidden rounded-md border"
                  >
                    <img
                      src={url}
                      alt="Relit"
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Relight Recipe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {presetsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading presets…
            </div>
          ) : (
            <>
              {renderGroup('lighting', presets.lighting)}
              {renderGroup('time', presets.time)}
              {renderGroup('backdrop', presets.backdrop)}
              {renderGroup('mood', presets.mood)}
            </>
          )}

          {universeAddress && (tonePacksQuery.data?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <Label>House Look (Tone Pack)</Label>
              <Select
                value={tonePackId ?? '__none__'}
                onValueChange={(v) => setTonePackId(v === '__none__' ? undefined : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {(tonePacksQuery.data ?? []).map((pack: any) => (
                    <SelectItem key={pack.id} value={pack.id}>
                      {pack.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="relight-freetext">Free-Text Refinement (optional)</Label>
            <Textarea
              id="relight-freetext"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value.slice(0, 500))}
              placeholder="e.g. add a soft fog, slightly tilt key light, push contrast on midtones"
              rows={3}
            />
            <div className="text-right text-xs text-muted-foreground">{freeText.length}/500</div>
          </div>

          <div className="space-y-2">
            <Label>Variations</Label>
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

          {selected.size > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Stacked presets ({selected.size})</div>
              <div className="flex flex-wrap gap-1">
                {Array.from(selected).map((id) => (
                  <Badge
                    key={id}
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => togglePreset(id)}
                  >
                    {id} ×
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || relightMutation.isPending}
            className="w-full"
          >
            {relightMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Relighting…
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" /> Apply Relight
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
