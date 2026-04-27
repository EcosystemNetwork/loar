/**
 * /lab/zai — Z.AI integration playground.
 *
 * Single-page demo of every Z.AI surface wired into LOAR:
 *   • Worldbuild from prompt        (GLM-4.6 + structured output)
 *   • Worldbuild from URL            (Web Reader → entities)
 *   • Web Search                     (research panel)
 *   • CogView-4 image generation
 *   • Vidu Q1 video generation
 *   • Talking-scene (image + line)
 *   • Canon consistency vision check
 *   • Governance agent
 *   • Voice → episode draft (ASR)
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Sparkles,
  Globe,
  Search,
  Image as ImageIcon,
  Video,
  Mic,
  Vote,
  ShieldCheck,
  Wand2,
  ExternalLink,
  Clock,
  GitCompareArrows,
  Brain,
  ScrollText,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// All chat model ids confirmed live against api.z.ai paas/v4 on 2026-04-26.
const CHAT_MODELS = [
  { id: 'glm-4.5-air', label: 'GLM-4.5 Air — fastest / cheapest' },
  { id: 'glm-4.5', label: 'GLM-4.5' },
  { id: 'glm-4.5v', label: 'GLM-4.5V — vision' },
  { id: 'glm-4.6', label: 'GLM-4.6 — balanced' },
  { id: 'glm-4.6v', label: 'GLM-4.6V — vision' },
  { id: 'glm-4.7', label: 'GLM-4.7 — reasoning (default)' },
  { id: 'glm-4-plus', label: 'GLM-4 Plus' },
  { id: 'glm-zero-preview', label: 'GLM-Zero Preview' },
  { id: 'glm-5', label: 'GLM-5 — flagship' },
  { id: 'glm-5-turbo', label: 'GLM-5 Turbo — fast flagship' },
  { id: 'glm-5.1', label: 'GLM-5.1 — newest reasoning' },
  { id: 'glm-5v-turbo', label: 'GLM-5V Turbo — flagship vision' },
] as const;
type ChatModelId = (typeof CHAT_MODELS)[number]['id'];

const VIDEO_MODELS = [
  { id: 'viduq1-text', label: 'Vidu Q1 — text→video (fast)' },
  { id: 'viduq1-image', label: 'Vidu Q1 — image→video' },
  { id: 'cogvideox-3', label: 'CogVideoX-3 — premium (audio + 1080p)' },
] as const;
type VideoModelId = (typeof VIDEO_MODELS)[number]['id'];

export const Route = createFileRoute('/lab/zai')({
  component: ZaiLabPage,
});

function ZaiLabPage() {
  const { address } = useWalletAuth();

  const { data: status } = useQuery({
    queryKey: ['zai', 'status'],
    queryFn: () => trpcClient.zai.status.query(),
    refetchOnWindowFocus: false,
  });

  if (!address) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Z.AI Lab</h1>
        <p className="text-muted-foreground mt-2">Connect a wallet to use the Z.AI sandbox.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-10 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-violet-400" />
            Z.AI Lab
          </h1>
          <p className="text-muted-foreground text-sm mt-2 max-w-2xl">
            The full Z.AI devpack wired into LOAR — GLM-4.7 reasoning (with live chain-of-thought),
            GLM-5V vision, GLM-Image stills, Vidu Q1 motion, GLM-ASR speech, and Web Search / Web
            Reader. BYOK from{' '}
            <a className="underline" href="/settings/api-keys">
              /settings/api-keys
            </a>
            , or fall back to the platform key.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          {status?.platformKey ? (
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
              Platform key live
            </Badge>
          ) : (
            <Badge variant="secondary">Platform key absent — BYOK only</Badge>
          )}
          <a
            href="/lab/zai/diagnostic"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Diagnostic →
          </a>
          <a
            href="https://docs.z.ai/llms.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <Tabs defaultValue="worldbuild" className="w-full">
        <TabsList className="grid grid-cols-3 lg:grid-cols-10">
          <TabsTrigger value="worldbuild">
            <Wand2 className="h-3.5 w-3.5 mr-1" />
            Worldbuild
          </TabsTrigger>
          <TabsTrigger value="script">
            <ScrollText className="h-3.5 w-3.5 mr-1" />
            Script
          </TabsTrigger>
          <TabsTrigger value="compare">
            <GitCompareArrows className="h-3.5 w-3.5 mr-1" />
            Compare
          </TabsTrigger>
          <TabsTrigger value="seed">
            <Globe className="h-3.5 w-3.5 mr-1" />
            From URL
          </TabsTrigger>
          <TabsTrigger value="search">
            <Search className="h-3.5 w-3.5 mr-1" />
            Search
          </TabsTrigger>
          <TabsTrigger value="image">
            <ImageIcon className="h-3.5 w-3.5 mr-1" />
            Image
          </TabsTrigger>
          <TabsTrigger value="video">
            <Video className="h-3.5 w-3.5 mr-1" />
            Video
          </TabsTrigger>
          <TabsTrigger value="canon">
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            Canon
          </TabsTrigger>
          <TabsTrigger value="governance">
            <Vote className="h-3.5 w-3.5 mr-1" />
            DAO
          </TabsTrigger>
          <TabsTrigger value="voice">
            <Mic className="h-3.5 w-3.5 mr-1" />
            Voice
          </TabsTrigger>
        </TabsList>

        <TabsContent value="worldbuild">
          <WorldbuildCard />
        </TabsContent>
        <TabsContent value="script">
          <ScriptCard />
        </TabsContent>
        <TabsContent value="compare">
          <CompareCard />
        </TabsContent>
        <TabsContent value="seed">
          <SeedFromUrlCard />
        </TabsContent>
        <TabsContent value="search">
          <SearchCard />
        </TabsContent>
        <TabsContent value="image">
          <ImageCard />
        </TabsContent>
        <TabsContent value="video">
          <VideoCard />
        </TabsContent>
        <TabsContent value="canon">
          <CanonCard />
        </TabsContent>
        <TabsContent value="governance">
          <GovernanceCard />
        </TabsContent>
        <TabsContent value="voice">
          <VoiceCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Reasoning stream ──────────────────────────────────────────────────
// Reveals GLM's chain-of-thought as a typewriter so judges can watch the
// model think. Z.AI is one of the few providers that exposes
// `reasoning_content` — most LLM APIs hide it. This is the demo centerpiece.

function ReasoningStream({ text, model }: { text: string; model: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (!text) return;
    const id = window.setInterval(() => {
      setShown((s) => {
        const next = Math.min(s + 12, text.length);
        if (next >= text.length) window.clearInterval(id);
        return next;
      });
    }, 16);
    return () => window.clearInterval(id);
  }, [text]);

  const done = shown >= text.length;
  return (
    <div className="rounded border border-violet-500/40 bg-black/40 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-violet-500/20 bg-violet-500/10">
        <div className="flex items-center gap-2 text-xs font-mono text-violet-200">
          <Brain className="h-3.5 w-3.5" />
          {model} reasoning · {text.length.toLocaleString()} chars
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {done ? 'complete' : 'thinking…'}
        </Badge>
      </div>
      <pre className="text-xs font-mono text-violet-100/90 whitespace-pre-wrap p-3 max-h-72 overflow-y-auto leading-relaxed">
        {text.slice(0, shown)}
        {!done && <span className="inline-block animate-pulse text-violet-300">▌</span>}
      </pre>
    </div>
  );
}

// ── Worldbuild ────────────────────────────────────────────────────────

function WorldbuildCard() {
  const [prompt, setPrompt] = useState(
    'A neon-noir city built on the back of a sleeping leviathan, where rain is currency.'
  );
  const [persist, setPersist] = useState(true);
  const [model, setModel] = useState<ChatModelId>('glm-4.7');

  const mut = useMutation({
    mutationFn: () => trpcClient.zai.worldbuild.mutate({ prompt, persist, model }),
    onSuccess: (res) => toast.success(`Generated ${res.entityCount} entities`),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Worldbuild failed'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Worldbuild from prompt</CardTitle>
        <p className="text-sm text-muted-foreground">
          GLM-4.7 streams its reasoning live, then returns a typed JSON bundle (universe + 6–12
          entities) that auto-populates the worldbuilding wiki. Switch models to compare reasoning
          depth vs latency.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Concept</Label>
          <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Model</Label>
          <Select value={model} onValueChange={(v) => setModel(v as ChatModelId)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAT_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={persist}
              onChange={(e) => setPersist(e.target.checked)}
            />
            Persist to wiki
          </label>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="ml-auto">
            {mut.isPending ? 'Generating…' : 'Build universe'}
          </Button>
        </div>
        {mut.data && (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
            {mut.data.reasoning ? (
              <ReasoningStream text={mut.data.reasoning} model={model} />
            ) : (
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
                {model} did not surface chain-of-thought. Try GLM-4.7 or GLM-5.1 to see live model
                reasoning.
              </div>
            )}
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">
                {mut.data.universe.tone}
              </div>
              <div className="text-lg font-bold">{mut.data.universe.name}</div>
              <div className="text-sm text-muted-foreground">{mut.data.universe.logline}</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {mut.data.entities.map((e, i) => (
                <div key={i} className="rounded border border-white/10 p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {e.kind}
                    </Badge>
                    <span className="font-semibold">{e.name}</span>
                  </div>
                  <div className="text-muted-foreground text-xs mt-1">{e.description}</div>
                </div>
              ))}
            </div>
            {mut.data.entityIds.length > 0 && (
              <div className="text-xs text-emerald-300">
                Persisted {mut.data.entityIds.length} entities. View in{' '}
                <a className="underline" href="/wiki">
                  /wiki
                </a>
                .
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Compare ──────────────────────────────────────────────────────────
// A/B two chat models side-by-side on the same worldbuild prompt. Useful
// for picking the right model for a given universe (GLM-5.1's reasoning
// vs GLM-4.6's tighter prose vs GLM-5-Turbo's speed). Both calls fire in
// parallel and persist=false so the wiki isn't double-populated.

interface CompareSlotResult {
  model: ChatModelId;
  latencyMs: number;
  data: Awaited<ReturnType<typeof trpcClient.zai.worldbuild.mutate>>;
}

function CompareCard() {
  const [prompt, setPrompt] = useState(
    'A neon-noir city built on the back of a sleeping leviathan, where rain is currency.'
  );
  const [modelA, setModelA] = useState<ChatModelId>('glm-4.6');
  const [modelB, setModelB] = useState<ChatModelId>('glm-5.1');
  const [running, setRunning] = useState(false);
  const [resultA, setResultA] = useState<CompareSlotResult | null>(null);
  const [resultB, setResultB] = useState<CompareSlotResult | null>(null);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  const fire = async () => {
    setRunning(true);
    setResultA(null);
    setResultB(null);
    setErrorA(null);
    setErrorB(null);

    const run = async (model: ChatModelId) => {
      const t0 = Date.now();
      const data = await trpcClient.zai.worldbuild.mutate({
        prompt,
        persist: false,
        model,
      });
      return { model, latencyMs: Date.now() - t0, data };
    };

    // Fire both in parallel; settle independently so a single failure
    // doesn't tank the comparison.
    const [a, b] = await Promise.allSettled([run(modelA), run(modelB)]);
    if (a.status === 'fulfilled') setResultA(a.value);
    else setErrorA(a.reason instanceof Error ? a.reason.message : String(a.reason));
    if (b.status === 'fulfilled') setResultB(b.value);
    else setErrorB(b.reason instanceof Error ? b.reason.message : String(b.reason));
    setRunning(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompareArrows className="h-5 w-5 text-violet-400" />
          A/B compare chat models
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Same prompt, two GLM models, side-by-side. Both calls fire in parallel and stay in memory
          only — nothing persists to the wiki.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Prompt</Label>
          <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Model A</Label>
            <Select value={modelA} onValueChange={(v) => setModelA(v as ChatModelId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Model B</Label>
            <Select value={modelB} onValueChange={(v) => setModelB(v as ChatModelId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={fire} disabled={running || modelA === modelB}>
          {running ? 'Running both…' : 'Compare'}
        </Button>
        {modelA === modelB && (
          <p className="text-xs text-amber-400/80">Pick two different models to compare.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CompareSlot label="A" model={modelA} result={resultA} error={errorA} />
          <CompareSlot label="B" model={modelB} result={resultB} error={errorB} />
        </div>
      </CardContent>
    </Card>
  );
}

function CompareSlot({
  label,
  model,
  result,
  error,
}: {
  label: string;
  model: ChatModelId;
  result: CompareSlotResult | null;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-3 space-y-2 min-h-[200px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            {label}
          </Badge>
          <span className="text-xs font-mono">{model}</span>
        </div>
        {result && <span className="text-[10px] text-muted-foreground">{result.latencyMs}ms</span>}
      </div>
      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-200 font-mono">
          {error}
        </div>
      )}
      {result && (
        <div className="space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {result.data.universe.tone}
            </div>
            <div className="text-sm font-bold">{result.data.universe.name}</div>
            <div className="text-xs text-muted-foreground">{result.data.universe.logline}</div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {result.data.entityCount} entities returned
          </div>
          <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
            {result.data.entities.map((e, i) => (
              <div key={i} className="rounded border border-white/10 p-1.5 text-[11px]">
                <div className="flex items-center gap-1">
                  <Badge variant="secondary" className="text-[9px] py-0">
                    {e.kind}
                  </Badge>
                  <span className="font-semibold">{e.name}</span>
                </div>
                <div className="text-muted-foreground line-clamp-2">{e.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!result && !error && <p className="text-xs text-muted-foreground italic">No run yet.</p>}
    </div>
  );
}

// ── Seed from URL ──────────────────────────────────────────────────────

function SeedFromUrlCard() {
  const [url, setUrl] = useState('https://en.wikipedia.org/wiki/Roko%27s_basilisk');
  const mut = useMutation({
    mutationFn: () => trpcClient.zai.seedFromUrl.mutate({ url, persist: true }),
    onSuccess: (res) =>
      toast.success(`Seeded ${res.entityCount} entities from "${res.sourceTitle ?? url}"`),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Seed failed'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Seed from URL</CardTitle>
        <p className="text-sm text-muted-foreground">
          Z.AI Web Reader fetches the page, GLM-4.6 turns it into a worldbuild bundle.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'Reading…' : 'Seed universe'}
        </Button>
        {mut.data && (
          <pre className="text-xs bg-zinc-950/60 p-3 rounded border border-white/10 overflow-x-auto">
            {JSON.stringify(mut.data.universe, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

// ── Web Search ────────────────────────────────────────────────────────

function SearchCard() {
  const [query, setQuery] = useState('latest research on long-form video generation');
  const mut = useMutation({
    mutationFn: () => trpcClient.zai.webSearch.mutate({ query, count: 8 }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Search failed'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Web Search</CardTitle>
        <p className="text-sm text-muted-foreground">
          Z.AI's purpose-built search engine for LLMs. Surface real-world facts inside a creator's
          worldbuilding flow.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Searching…' : 'Search'}
          </Button>
        </div>
        <div className="space-y-2">
          {(mut.data ?? []).map((r, i) => (
            <a
              key={i}
              href={r.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded border border-white/10 p-3 hover:border-violet-500/40"
            >
              <div className="text-sm font-medium">{r.title}</div>
              <div className="text-xs text-muted-foreground mt-1">{r.snippet}</div>
              <div className="text-[10px] text-violet-400 mt-1 truncate">{r.link}</div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Image (CogView-4) ─────────────────────────────────────────────────

function ImageCard() {
  const [prompt, setPrompt] = useState(
    'A monk silhouette meditating in front of a glowing data shrine, ukiyo-e style'
  );
  const mut = useMutation({
    mutationFn: () =>
      trpcClient.zai.generateImage.mutate({
        prompt,
        model: 'glm-image',
        size: '1024x1024',
        rehost: true,
      }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Image gen failed'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Image (GLM-Image)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Generates and rehosts on the LOAR storage stack (Pinata / Lighthouse) for canonical URLs.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'Painting…' : 'Generate'}
        </Button>
        {mut.data?.images?.[0]?.url && (
          <img
            src={mut.data.images[0].url}
            alt={prompt}
            className="rounded-lg border border-white/10 max-w-md"
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── Video (Vidu Q1) ───────────────────────────────────────────────

function VideoCard() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState(
    'Aerial shot of a city of glass towers parting like water as a leviathan rises beneath'
  );
  const [imageUrl, setImageUrl] = useState('');
  // Default: smart-pick based on whether an image is supplied. User can
  // override to force CogVideoX-3 (premium tier with audio).
  const [model, setModel] = useState<VideoModelId | 'auto'>('auto');

  const resolvedModel: VideoModelId =
    model === 'auto' ? (imageUrl ? 'viduq1-image' : 'viduq1-text') : model;

  const start = useMutation({
    mutationFn: () =>
      trpcClient.zai.startVideo.mutate({
        prompt,
        model: resolvedModel,
        imageUrl: imageUrl || undefined,
        aspectRatio: '16:9',
        duration: 5,
      }),
    onSuccess: (res) => {
      toast.success('Job submitted — watching for completion');
      navigate({ to: '/lab/zai/video/$jobId', params: { jobId: res.taskId } });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Submit failed'),
  });

  const recent = useQuery({
    queryKey: ['zai', 'listVideoJobs'],
    queryFn: () => trpcClient.zai.listVideoJobs.query({ limit: 8 }),
    refetchInterval: 8000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Video (Vidu Q1)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Long-running async render. Submit kicks off the job and routes to a poller page that
          survives refreshes — Firestore caches every state transition.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <Input
          placeholder="Optional reference image URL (image-to-video)"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Model</Label>
          <Select value={model} onValueChange={(v) => setModel(v as VideoModelId | 'auto')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                Auto — picks Vidu Q1 (text or image based on input)
              </SelectItem>
              {VIDEO_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            Will fire as: <span className="font-mono">{resolvedModel}</span>
          </p>
        </div>
        <Button onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? 'Submitting…' : 'Start render'}
        </Button>

        {(recent.data ?? []).length > 0 && (
          <div className="pt-3 border-t border-white/10">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Recent jobs
            </div>
            <div className="space-y-1">
              {(recent.data as Array<Record<string, unknown>> | undefined)?.map((j) => {
                const id = j.taskId as string;
                const status = j.status as string;
                const promptText = (j.prompt as string) ?? '';
                return (
                  <button
                    key={id}
                    onClick={() => navigate({ to: '/lab/zai/video/$jobId', params: { jobId: id } })}
                    className="w-full text-left rounded border border-white/10 p-2 hover:border-violet-500/40 flex items-center gap-3"
                  >
                    <Badge
                      variant="secondary"
                      className={
                        status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : status === 'failed'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      }
                    >
                      {status}
                    </Badge>
                    <div className="text-xs truncate flex-1">{promptText}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {id.slice(0, 8)}…
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Canon check ───────────────────────────────────────────────────────

function CanonCard() {
  const [imageUrls, setImageUrls] = useState('');
  const [universeName, setUniverseName] = useState('Leviathan City');
  const [loreSummary, setLoreSummary] = useState(
    'A neon-noir city built on the back of a sleeping leviathan. Rain is currency. No firearms exist; combat is performed via tattoo-bound sigils.'
  );
  const mut = useMutation({
    mutationFn: () =>
      trpcClient.zai.canonCheck.mutate({
        imageUrls: imageUrls.split(/\s+/).filter(Boolean),
        universeName,
        loreSummary,
      }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Canon check failed'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Canon consistency check (GLM-5V)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Vision model scores frames against a universe's lore. Wire into the publish-to-canon
          gesture as a soft gate.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="Whitespace-separated image URLs"
          value={imageUrls}
          onChange={(e) => setImageUrls(e.target.value)}
        />
        <Input value={universeName} onChange={(e) => setUniverseName(e.target.value)} />
        <Textarea rows={3} value={loreSummary} onChange={(e) => setLoreSummary(e.target.value)} />
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'Reviewing…' : 'Score'}
        </Button>
        {mut.data && (
          <div className="rounded-lg border border-white/10 p-3 space-y-2">
            <div className="text-2xl font-bold">
              {mut.data.score}/100{' '}
              <Badge
                className={
                  mut.data.verdict === 'canonical'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : mut.data.verdict === 'borderline'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                }
              >
                {mut.data.verdict}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{mut.data.summary}</p>
            {mut.data.contradictions?.length > 0 && (
              <ul className="text-sm space-y-1">
                {mut.data.contradictions.map((c, i) => (
                  <li key={i}>
                    <Badge variant="secondary" className="text-[10px] mr-1">
                      {c.severity}
                    </Badge>
                    {c.note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Governance agent ──────────────────────────────────────────────────

function GovernanceCard() {
  const [title, setTitle] = useState('Reduce mint fee from 5% to 2%');
  const [body, setBody] = useState(
    'Proposal to reduce the platform mint fee from 5% to 2% to encourage more on-chain canon submissions. Fee reduction would be funded by treasury reserves for 6 months.'
  );
  const [charter, setCharter] = useState(
    'Universe is committed to maximizing creator revenue while sustaining infrastructure. Mint fees fund storage and audit.'
  );
  const mut = useMutation({
    mutationFn: () =>
      trpcClient.zai.governanceAgent.mutate({
        proposalTitle: title,
        proposalBody: body,
        charter,
      }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Agent failed'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>DAO Governance Agent (GLM-4.6 + thinking)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Track 4 demo: agent reads a proposal + universe charter, returns a recommended vote with
          rationale and risks.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Proposal title"
        />
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        <Textarea
          rows={2}
          value={charter}
          onChange={(e) => setCharter(e.target.value)}
          placeholder="Universe charter / mission"
        />
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'Reasoning…' : 'Recommend vote'}
        </Button>
        {mut.data && (
          <div className="rounded-lg border border-white/10 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Badge
                className={
                  mut.data.recommendation === 'for'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : mut.data.recommendation === 'against'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                      : 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30'
                }
              >
                {mut.data.recommendation.toUpperCase()}
              </Badge>
              <span className="text-xs text-muted-foreground">
                confidence {(mut.data.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-sm">{mut.data.rationale}</p>
            <div className="text-xs text-muted-foreground">
              <strong>Charter alignment:</strong> {mut.data.charterAlignment}
            </div>
            {mut.data.risks?.length > 0 && (
              <ul className="text-xs space-y-1 list-disc pl-5">
                {mut.data.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Script writer (A/B side-by-side) ─────────────────────────────────
// Two models, same logline, two full screenplays. Differs from the generic
// Compare tab in that it returns a richer structured-script shape (scenes
// with sluglines + dialogue blocks + parentheticals) and renders in proper
// screenplay format. The strongest "GLM model spread matters" demo.

type ScriptResult = Awaited<ReturnType<typeof trpcClient.zai.writeScript.mutate>>;

function ScriptCard() {
  const [prompt, setPrompt] = useState(
    "A retired AI ethicist is summoned to the colony at the edge of the Oort cloud after the station's only child goes missing. The child claims an entity in the dark spoke to her — and only she can hear it."
  );
  const [tone, setTone] = useState('cosmic horror, Tarkovsky-paced');
  const [characters, setCharacters] = useState('');
  const [sceneCount, setSceneCount] = useState(5);
  const [modelA, setModelA] = useState<ChatModelId>('glm-4.7');
  const [modelB, setModelB] = useState<ChatModelId>('glm-5.1');
  const [running, setRunning] = useState(false);
  const [resultA, setResultA] = useState<ScriptResult | null>(null);
  const [resultB, setResultB] = useState<ScriptResult | null>(null);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  const fire = async () => {
    setRunning(true);
    setResultA(null);
    setResultB(null);
    setErrorA(null);
    setErrorB(null);

    const run = (model: ChatModelId) =>
      trpcClient.zai.writeScript.mutate({
        prompt,
        model,
        sceneCount,
        tone: tone || undefined,
        characters: characters || undefined,
      });

    const [a, b] = await Promise.allSettled([run(modelA), run(modelB)]);
    if (a.status === 'fulfilled') setResultA(a.value);
    else setErrorA(a.reason instanceof Error ? a.reason.message : String(a.reason));
    if (b.status === 'fulfilled') setResultB(b.value);
    else setErrorB(b.reason instanceof Error ? b.reason.message : String(b.reason));
    setRunning(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-violet-400" />
          Script writer — A/B compare
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Same logline, two GLM models, two full screenplays in screenplay format. Output is
          ephemeral — promote a winner to a Notebook draft if you want to keep it.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Logline</Label>
          <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-2 md:col-span-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Tone (optional)
            </Label>
            <Input
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="e.g. cosmic horror, Tarkovsky-paced"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Scenes</Label>
            <Input
              type="number"
              min={2}
              max={12}
              value={sceneCount}
              onChange={(e) =>
                setSceneCount(Math.max(2, Math.min(12, Number(e.target.value) || 5)))
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Required characters (optional, comma-separated)
          </Label>
          <Input
            value={characters}
            onChange={(e) => setCharacters(e.target.value)}
            placeholder="e.g. Dr. Vance (the ethicist), Iris (the child), Captain Mei (station commander)"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Model A</Label>
            <Select value={modelA} onValueChange={(v) => setModelA(v as ChatModelId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Model B</Label>
            <Select value={modelB} onValueChange={(v) => setModelB(v as ChatModelId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={fire} disabled={running || modelA === modelB}>
          {running ? 'Writing both scripts (~30s)…' : 'Write both scripts'}
        </Button>
        {modelA === modelB && (
          <p className="text-xs text-amber-400/80">Pick two different models to compare.</p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ScriptSlot label="A" model={modelA} result={resultA} error={errorA} />
          <ScriptSlot label="B" model={modelB} result={resultB} error={errorB} />
        </div>
      </CardContent>
    </Card>
  );
}

function ScriptSlot({
  label,
  model,
  result,
  error,
}: {
  label: string;
  model: ChatModelId;
  result: ScriptResult | null;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-4 space-y-3 min-h-[300px]">
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            {label}
          </Badge>
          <span className="text-xs font-mono">{model}</span>
        </div>
        {result?.meta?.latencyMs && (
          <span className="text-[10px] text-muted-foreground">
            {(result.meta.latencyMs / 1000).toFixed(1)}s
            {result.meta.usage?.totalTokens ? ` · ${result.meta.usage.totalTokens} tok` : ''}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-200 font-mono break-words">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div>
            <h3 className="text-base font-bold uppercase tracking-wide">{result.title}</h3>
            <p className="text-xs text-muted-foreground italic mt-1">{result.logline}</p>
            {result.tone && (
              <Badge variant="secondary" className="text-[9px] mt-2">
                {result.tone}
              </Badge>
            )}
          </div>

          {result.characters?.length > 0 && (
            <div className="text-xs">
              <div className="uppercase tracking-wide text-muted-foreground mb-1">Cast</div>
              <ul className="space-y-0.5">
                {result.characters.map((c, i) => (
                  <li key={i}>
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-muted-foreground"> — {c.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1 font-mono text-xs leading-relaxed">
            {result.scenes.map((s, i) => (
              <div key={i} className="space-y-1.5">
                <div className="font-bold uppercase tracking-wider text-violet-300">
                  {s.heading}
                </div>
                {s.action && <p className="text-foreground/90 whitespace-pre-wrap">{s.action}</p>}
                {s.dialogue?.map((d, j) => (
                  <div key={j} className="ml-6 mt-1.5">
                    <div className="font-bold uppercase tracking-wider text-amber-200/90">
                      {d.character}
                    </div>
                    {d.parenthetical && (
                      <div className="text-muted-foreground italic ml-3">({d.parenthetical})</div>
                    )}
                    <div className="ml-3">{d.line}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !error && <p className="text-xs text-muted-foreground italic">No run yet.</p>}
    </div>
  );
}

// ── Voice → episode draft ─────────────────────────────────────────────

function VoiceCard() {
  const [audioUrl, setAudioUrl] = useState('');
  const mut = useMutation({
    mutationFn: () => trpcClient.zai.episodeFromVoice.mutate({ url: audioUrl, persistDraft: true }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Voice draft failed'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice → episode draft (GLM-ASR + GLM-4.6)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Drop a voice memo URL — the server transcribes it and turns it into a structured episode
          draft (title, logline, scene list).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="https://… mp3 or wav URL"
          value={audioUrl}
          onChange={(e) => setAudioUrl(e.target.value)}
        />
        <Button onClick={() => mut.mutate()} disabled={mut.isPending || !audioUrl}>
          {mut.isPending ? 'Transcribing…' : 'Draft episode'}
        </Button>
        {mut.data && (
          <div className="rounded-lg border border-white/10 p-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {mut.data.draft.tone}
            </div>
            <div className="text-lg font-bold">{mut.data.draft.title}</div>
            <p className="text-sm text-muted-foreground italic">{mut.data.draft.logline}</p>
            <div className="space-y-2 mt-3">
              {mut.data.draft.scenes.map((s, i) => (
                <div key={i} className="rounded border border-white/10 p-2 text-sm">
                  <div className="font-semibold">{s.heading}</div>
                  <div className="text-muted-foreground text-xs mt-1">{s.action}</div>
                  {s.dialogue && (
                    <div className="font-mono text-xs mt-1 whitespace-pre-wrap">{s.dialogue}</div>
                  )}
                </div>
              ))}
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Transcript</summary>
              <p className="mt-2">{mut.data.transcript}</p>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
