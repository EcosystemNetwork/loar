/**
 * Z.AI script + compare cards — shared between /lab/zai and /create.
 *
 * Pulled out of lab.zai.tsx so the same A/B demo can be embedded inside
 * the Create hub without duplicating logic. Keep this file dependency-free
 * of route components.
 */
import { useState } from 'react';
import { GitCompareArrows, ScrollText } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// All chat model ids confirmed live against api.z.ai paas/v4 on 2026-04-26.
export const CHAT_MODELS = [
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
export type ChatModelId = (typeof CHAT_MODELS)[number]['id'];

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

export function CompareCard() {
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

// ── Script writer (A/B side-by-side) ─────────────────────────────────
// Two models, same logline, two full screenplays. Differs from the generic
// Compare card in that it returns a richer structured-script shape (scenes
// with sluglines + dialogue blocks + parentheticals) and renders in proper
// screenplay format. The strongest "GLM model spread matters" demo.

type ScriptResult = Awaited<ReturnType<typeof trpcClient.zai.writeScript.mutate>>;

export function ScriptCard() {
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
