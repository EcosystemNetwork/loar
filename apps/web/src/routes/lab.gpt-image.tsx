/**
 * /lab/gpt-image — OpenAI gpt-image-1 reference + storyboard generator.
 *
 * Two panels:
 *   • Reference Image — single high-fidelity render for character / location
 *     concepting. Optional reference image upload flips the call to
 *     image_to_image so gpt-image-1.5 transforms an existing asset.
 *   • Storyboard — N shot prompts, one image per shot, generated in sequence
 *     with three "director" features:
 *        1. Style lock (shared style + character notes prepended to every shot)
 *        2. Reference character sheet (image carried as img2img conditioning)
 *        3. Director mode (logline → expanded shot list via OpenAI structured
 *           output)
 *     Per-shot regen lets the user retry a single tile. The full board can be
 *     saved to the wiki as an Event entity carrying the shot list, the style
 *     lock, and the reference image — unless the chosen universe is private.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Sparkles,
  ImageIcon,
  Film,
  Download,
  BookOpen,
  Lock,
  X,
  Wand2,
  RefreshCw,
  UserCircle2,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DirectUpload } from '@/components/DirectUpload';

export const Route = createFileRoute('/lab/gpt-image')({
  component: GptImageLabPage,
});

type ImageSize =
  | 'square_hd'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9';

const SIZE_OPTIONS: Array<{ value: ImageSize; label: string }> = [
  { value: 'square_hd', label: 'Square 1:1' },
  { value: 'landscape_16_9', label: 'Landscape 16:9 (cinematic)' },
  { value: 'landscape_4_3', label: 'Landscape 4:3' },
  { value: 'portrait_16_9', label: 'Portrait 9:16 (vertical)' },
  { value: 'portrait_4_3', label: 'Portrait 3:4' },
];

const MODEL_OPTIONS = [
  { id: 'gpt-image-15', label: 'GPT Image 1.5 — flagship' },
  { id: 'gpt-image-1', label: 'GPT Image 1 — fast premium' },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini — budget' },
] as const;
type GptImageModelId = (typeof MODEL_OPTIONS)[number]['id'];

function newClientToken(): string {
  const raw =
    globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, '');
}

/** Merge style lock + character notes into a shot prompt. */
function composePrompt(shot: string, style: string, character: string): string {
  const parts = [
    style.trim() ? `Style: ${style.trim()}` : '',
    character.trim() ? `Character: ${character.trim()}` : '',
    shot.trim(),
  ].filter(Boolean);
  return parts.join('\n\n');
}

function GptImageLabPage() {
  const { address } = useWalletAuth();

  if (!address) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">GPT Image Lab</h1>
        <p className="text-muted-foreground mt-2">Connect a wallet to use the GPT Image lab.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-10 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-emerald-400" />
            GPT Image Lab
          </h1>
          <p className="text-muted-foreground text-sm mt-2 max-w-2xl">
            OpenAI's gpt-image-1.5 for reference art and storyboards. Director mode expands a
            logline into a shot list; style lock + character sheet hold the look consistent across
            the board. Outputs flow through LOAR storage (provenance-signed, rehosted on Pinata /
            Lighthouse) and auto-publish to the gallery. Needs an OpenAI key in{' '}
            <a className="underline" href="/settings/api-keys">
              /settings/api-keys
            </a>
            .
          </p>
        </div>
        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 shrink-0">
          OpenAI direct
        </Badge>
      </div>

      <Tabs defaultValue="reference">
        <TabsList>
          <TabsTrigger value="reference">
            <ImageIcon className="h-3.5 w-3.5 mr-1" />
            Reference Image
          </TabsTrigger>
          <TabsTrigger value="storyboard">
            <Film className="h-3.5 w-3.5 mr-1" />
            Storyboard
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reference">
          <ReferenceCard />
        </TabsContent>
        <TabsContent value="storyboard">
          <StoryboardCard creator={address} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Reference Image ──────────────────────────────────────────────────────

function ReferenceCard() {
  const [prompt, setPrompt] = useState(
    'A grizzled cartographer in a rain-soaked greatcoat, lantern in hand, standing at the edge of a cliff overlooking a sea of clouds. Painterly concept art, warm rim light, 35mm.'
  );
  const [model, setModel] = useState<GptImageModelId>('gpt-image-15');
  const [size, setSize] = useState<ImageSize>('square_hd');
  const [numImages, setNumImages] = useState(1);
  const [refImage, setRefImage] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      trpcClient.image.generate.mutate({
        prompt,
        task: refImage ? 'image_to_image' : 'text_to_image',
        imageUrls: refImage ? [refImage] : undefined,
        imageSize: size,
        numImages,
        routingMode: 'manual',
        selectedModelId: model,
        allowFallback: false,
        clientToken: newClientToken(),
      }),
    onSuccess: (res) => {
      if (res.status !== 'completed' || !res.imageUrls?.length) {
        toast.error('Generation returned no images');
        return;
      }
      toast.success(
        `Generated ${res.imageUrls.length} image${res.imageUrls.length === 1 ? '' : 's'}`
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Generation failed'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reference Image</CardTitle>
        <p className="text-sm text-muted-foreground">
          Single hero render for character sheets, location concept art, or prop design. Drop a
          reference image to switch into transform mode (img2img).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the subject, lighting, framing, medium…"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Model</Label>
            <Select value={model} onValueChange={(v) => setModel(v as GptImageModelId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Aspect ratio
            </Label>
            <Select value={size} onValueChange={(v) => setSize(v as ImageSize)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Variations
            </Label>
            <Input
              type="number"
              min={1}
              max={4}
              value={numImages}
              onChange={(e) => setNumImages(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Reference image (optional — turns this into a transformation)
          </Label>
          {refImage ? (
            <div className="flex items-start gap-3 rounded border border-white/10 p-2">
              <img src={refImage} alt="reference" className="h-20 w-20 object-cover rounded" />
              <div className="flex-1 text-xs text-muted-foreground break-all">{refImage}</div>
              <Button size="sm" variant="ghost" onClick={() => setRefImage(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <DirectUpload
              acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
              maxSizeMB={20}
              label="Drop a reference image to transform it (img2img)"
              onUploadComplete={(manifest) => {
                const url = manifest.uploads[0]?.url;
                if (url) setRefImage(url);
              }}
            />
          )}
        </div>

        <Button onClick={() => mut.mutate()} disabled={mut.isPending || !prompt.trim()}>
          {mut.isPending ? 'Painting…' : refImage ? 'Transform image' : 'Generate'}
        </Button>

        {mut.data?.imageUrls?.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-white/10">
            {mut.data.imageUrls.map((url, i) => (
              <a
                key={`${url}-${i}`}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="group block rounded-lg border border-white/10 overflow-hidden hover:border-emerald-500/40 transition-colors"
              >
                <img src={url} alt={`gpt-image ${i + 1}`} className="w-full h-auto" />
                <div className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground flex items-center gap-1 group-hover:text-foreground">
                  <Download className="h-3 w-3" /> Open original
                </div>
              </a>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Storyboard ───────────────────────────────────────────────────────────

interface ShotResult {
  prompt: string;
  imageUrl: string | null;
  error?: string;
  pending?: boolean;
}

function StoryboardCard({ creator }: { creator: string }) {
  const [title, setTitle] = useState('Cold open');
  const [logline, setLogline] = useState(
    'A retired detective gets pulled into one last case when a flickering neon sign in Kowloon starts spelling out the names of the dead.'
  );
  const [targetShotCount, setTargetShotCount] = useState(6);
  const [shotsRaw, setShotsRaw] = useState(
    [
      'Wide establishing shot — rain-slick neon street at 3 AM, steam curling from a manhole.',
      'Medium shot — detective lights a cigarette under the awning of a noodle stall.',
      'Close-up — her eyes catch the reflection of a billboard suddenly flickering out.',
      'Low angle — silhouette of a figure stepping into frame at the far end of the alley.',
    ].join('\n')
  );
  const [styleLock, setStyleLock] = useState(
    'Neo-noir, painterly, 35mm grain, low-key warm/cool palette, cinematic lens flares.'
  );
  const [characterNotes, setCharacterNotes] = useState('');
  const [characterRef, setCharacterRef] = useState<string | null>(null);
  const [model, setModel] = useState<GptImageModelId>('gpt-image-15');
  const [size, setSize] = useState<ImageSize>('landscape_16_9');
  const [universeAddress, setUniverseAddress] = useState<string>('');
  const [saveToWikiPref, setSaveToWikiPref] = useState(true);
  const [results, setResults] = useState<ShotResult[]>([]);

  const universesQuery = useQuery({
    queryKey: ['gpt-image-lab', 'universes', creator],
    queryFn: async () => {
      const r = (await trpcClient.universes.getByCreator.query({ creator })) as any;
      const items = (r?.data ?? r ?? []) as Array<{
        id: string;
        name?: string;
        isPrivate?: boolean;
      }>;
      return items;
    },
  });

  const selectedUniverse = useMemo(
    () => universesQuery.data?.find((u) => u.id === universeAddress) ?? null,
    [universesQuery.data, universeAddress]
  );
  const isPrivateUniverse = !!selectedUniverse?.isPrivate;
  const willSaveToWiki = saveToWikiPref && !isPrivateUniverse;

  const shots = useMemo(
    () =>
      shotsRaw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    [shotsRaw]
  );

  // Render a single shot — used by both bulk generation and per-shot regen.
  async function renderShot(shotPrompt: string): Promise<string> {
    const finalPrompt = composePrompt(shotPrompt, styleLock, characterNotes);
    const r = await trpcClient.image.generate.mutate({
      prompt: finalPrompt,
      task: characterRef ? 'image_to_image' : 'text_to_image',
      imageUrls: characterRef ? [characterRef] : undefined,
      imageSize: size,
      numImages: 1,
      routingMode: 'manual',
      selectedModelId: model,
      allowFallback: false,
      universeId: universeAddress || undefined,
      useWikiContext: !!universeAddress,
      clientToken: newClientToken(),
    });
    const url = r.imageUrls?.[0];
    if (!url) throw new Error('No image returned');
    return url;
  }

  const expand = useMutation({
    mutationFn: async () => {
      const r = await trpcClient.wiki.expandStoryboard.mutate({
        logline,
        shotCount: targetShotCount,
        styleNotes: styleLock || undefined,
        characterNotes: characterNotes || undefined,
      });
      return r.shots;
    },
    onSuccess: (newShots) => {
      const lines = newShots
        .map((s) => (s.framing ? `${s.framing} — ${s.prompt}` : s.prompt))
        .filter(Boolean);
      setShotsRaw(lines.join('\n'));
      setResults([]);
      toast.success(`Director expanded into ${lines.length} shots`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Expansion failed'),
  });

  const generateAll = useMutation({
    mutationFn: async () => {
      if (shots.length === 0) throw new Error('Add at least one shot description');
      if (shots.length > 12) throw new Error('Cap is 12 shots per storyboard');
      const out: ShotResult[] = [];
      for (let i = 0; i < shots.length; i++) {
        const shotPrompt = shots[i];
        setResults((prev) => {
          const next = [...prev];
          next[i] = { prompt: shotPrompt, imageUrl: null, pending: true };
          return next;
        });
        try {
          const url = await renderShot(shotPrompt);
          out.push({ prompt: shotPrompt, imageUrl: url });
          setResults((prev) => {
            const next = [...prev];
            next[i] = { prompt: shotPrompt, imageUrl: url };
            return next;
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'failed';
          out.push({ prompt: shotPrompt, imageUrl: null, error: message });
          setResults((prev) => {
            const next = [...prev];
            next[i] = { prompt: shotPrompt, imageUrl: null, error: message };
            return next;
          });
          throw err;
        }
      }
      return out;
    },
    onSuccess: () => toast.success(`Generated ${shots.length} shots`),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Storyboard failed'),
  });

  const regenShot = useMutation({
    mutationFn: async (index: number) => {
      const shotPrompt = results[index]?.prompt ?? shots[index];
      if (!shotPrompt) throw new Error('Missing prompt for shot');
      setResults((prev) => {
        const next = [...prev];
        next[index] = { prompt: shotPrompt, imageUrl: null, pending: true };
        return next;
      });
      try {
        const url = await renderShot(shotPrompt);
        setResults((prev) => {
          const next = [...prev];
          next[index] = { prompt: shotPrompt, imageUrl: url };
          return next;
        });
        return url;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'failed';
        setResults((prev) => {
          const next = [...prev];
          next[index] = { prompt: shotPrompt, imageUrl: null, error: message };
          return next;
        });
        throw err;
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Regen failed'),
  });

  const completedShots = results.filter((r) => r?.imageUrl);
  const saveToWiki = useMutation({
    mutationFn: async () => {
      if (completedShots.length === 0) throw new Error('Nothing to save yet');
      const firstImage = completedShots[0].imageUrl!;
      return trpcClient.entities.create.mutate({
        name: `Storyboard — ${title.trim() || 'Untitled'}`,
        description: `${completedShots.length}-shot storyboard generated with ${model}.`,
        kind: 'event',
        universeAddress: universeAddress || undefined,
        imageUrl: firstImage,
        metadata: {
          storyboard: true,
          model,
          aspectRatio: size,
          logline: logline || null,
          styleLock: styleLock || null,
          characterNotes: characterNotes || null,
          characterReference: characterRef || null,
          shots: completedShots.map((s) => ({
            prompt: s.prompt,
            imageUrl: s.imageUrl,
          })),
        },
      });
    },
    onSuccess: (res: any) => {
      const entityId = res?.id ?? res?.entityId;
      toast.success('Saved to wiki');
      if (entityId) window.open(`/wiki/entity/${entityId}`, '_blank', 'noopener');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storyboard</CardTitle>
        <p className="text-sm text-muted-foreground">
          Sequential render with shared style lock + optional character reference. Use Director mode
          to expand a logline into a shot list. Boards attached to a{' '}
          <span className="text-rose-300">private universe</span> stay off the public wiki.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Storyboard title
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Pilot — cold open"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Model</Label>
            <Select value={model} onValueChange={(v) => setModel(v as GptImageModelId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Aspect ratio
            </Label>
            <Select value={size} onValueChange={(v) => setSize(v as ImageSize)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Attach to universe (optional)
            </Label>
            <Select
              value={universeAddress || 'none'}
              onValueChange={(v) => setUniverseAddress(v === 'none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Standalone (no universe)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Standalone (no universe)</SelectItem>
                {(universesQuery.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name || u.id.slice(0, 10)}
                    {u.isPrivate ? ' · private' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Director mode */}
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-violet-300">
            <Wand2 className="h-4 w-4" />
            Director mode
          </div>
          <p className="text-xs text-muted-foreground">
            Logline → shot list. GPT-4.1-mini structures the breakdown using your style lock and
            character notes as guidance. Overwrites the shot list below.
          </p>
          <Textarea
            rows={2}
            value={logline}
            onChange={(e) => setLogline(e.target.value)}
            placeholder="One-paragraph scene description…"
          />
          <div className="flex items-center gap-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Shots</Label>
            <Input
              type="number"
              min={2}
              max={12}
              value={targetShotCount}
              onChange={(e) =>
                setTargetShotCount(Math.max(2, Math.min(12, Number(e.target.value) || 6)))
              }
              className="w-20"
            />
            <Button
              onClick={() => expand.mutate()}
              disabled={expand.isPending || !logline.trim()}
              variant="outline"
              size="sm"
            >
              {expand.isPending ? 'Directing…' : 'Expand into shots'}
            </Button>
          </div>
        </div>

        {/* Style lock */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
            <UserCircle2 className="h-4 w-4" />
            Style lock
          </div>
          <p className="text-xs text-muted-foreground">
            Prepended to every shot so the look stays consistent. Empty fields are skipped.
          </p>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Shared style
            </Label>
            <Textarea
              rows={2}
              value={styleLock}
              onChange={(e) => setStyleLock(e.target.value)}
              placeholder="e.g. neo-noir, painterly, 35mm grain, warm/cool palette"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Character notes
            </Label>
            <Textarea
              rows={2}
              value={characterNotes}
              onChange={(e) => setCharacterNotes(e.target.value)}
              placeholder="e.g. female, late 50s, silver bob, scarred left cheek, wears a forest-green trench"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Character reference image (optional — img2img anchor for every shot)
            </Label>
            {characterRef ? (
              <div className="flex items-start gap-3 rounded border border-white/10 p-2">
                <img
                  src={characterRef}
                  alt="character reference"
                  className="h-20 w-20 object-cover rounded"
                />
                <div className="flex-1 text-xs text-muted-foreground break-all">{characterRef}</div>
                <Button size="sm" variant="ghost" onClick={() => setCharacterRef(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <DirectUpload
                acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
                maxSizeMB={20}
                label="Drop a character sheet — every shot will img2img off it"
                onUploadComplete={(manifest) => {
                  const url = manifest.uploads[0]?.url;
                  if (url) setCharacterRef(url);
                }}
              />
            )}
          </div>
        </div>

        {/* Shot list */}
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Shot list (one per line)
          </Label>
          <Textarea
            rows={6}
            value={shotsRaw}
            onChange={(e) => setShotsRaw(e.target.value)}
            placeholder={'Wide — establishing shot of …\nMedium — character reacts to …'}
          />
          <div className="text-[10px] text-muted-foreground">
            {shots.length} shot{shots.length === 1 ? '' : 's'} · max 12
          </div>
        </div>

        <div className="flex items-center gap-2 rounded border border-white/10 p-3">
          <Checkbox
            id="save-wiki"
            checked={willSaveToWiki}
            disabled={isPrivateUniverse}
            onCheckedChange={(v) => setSaveToWikiPref(v === true)}
          />
          <Label
            htmlFor="save-wiki"
            className={`text-sm flex items-center gap-1.5 cursor-pointer ${isPrivateUniverse ? 'text-muted-foreground' : ''}`}
          >
            {isPrivateUniverse ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <BookOpen className="h-3.5 w-3.5" />
            )}
            {isPrivateUniverse
              ? 'Universe is private — storyboard will not be published to the wiki'
              : 'Save the finished storyboard to the wiki as an Event entity'}
          </Label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setResults(shots.map((s) => ({ prompt: s, imageUrl: null, pending: true })));
              generateAll.mutate();
            }}
            disabled={generateAll.isPending || shots.length === 0}
          >
            {generateAll.isPending ? 'Rendering shots…' : `Generate ${shots.length || ''} shots`}
          </Button>
          {completedShots.length > 0 && willSaveToWiki && !generateAll.isPending ? (
            <Button
              variant="outline"
              onClick={() => saveToWiki.mutate()}
              disabled={saveToWiki.isPending}
            >
              {saveToWiki.isPending ? 'Saving…' : 'Save storyboard to wiki'}
            </Button>
          ) : null}
        </div>

        {results.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3 border-t border-white/10">
            {results.map((shot, i) => {
              const isRegenning = regenShot.isPending && regenShot.variables === i;
              const pending = shot?.pending || isRegenning;
              return (
                <div
                  key={`shot-${i}`}
                  className="rounded-lg border border-white/10 overflow-hidden bg-black/20"
                >
                  <div className="aspect-video bg-black/40 flex items-center justify-center relative">
                    {shot?.imageUrl ? (
                      <a href={shot.imageUrl} target="_blank" rel="noreferrer">
                        <img
                          src={shot.imageUrl}
                          alt={`Shot ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </a>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {pending ? 'painting…' : shot?.error ? `failed — ${shot.error}` : 'queued'}
                      </div>
                    )}
                    {(shot?.imageUrl || shot?.error) && !pending ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="absolute top-1 right-1 h-7 px-2 text-[10px]"
                        onClick={() => regenShot.mutate(i)}
                        disabled={generateAll.isPending}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Regen
                      </Button>
                    ) : null}
                  </div>
                  <div className="px-2 py-2 text-xs space-y-1">
                    <div className="font-mono text-[10px] text-muted-foreground">Shot {i + 1}</div>
                    <div className="line-clamp-3">{shot?.prompt ?? shots[i]}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
