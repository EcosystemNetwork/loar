/**
 * /dashboard/personas/$personaId/edit — Edit Persona.
 *
 * Editing a persona's profile or components creates a new immutable
 * `PersonaVersion`. Existing deals stay pinned to the version they bought;
 * new deals get the latest version.
 */
import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, ChevronLeft, CheckCircle2, History, AlertTriangle } from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

export const Route = createFileRoute('/dashboard/personas/$personaId/edit')({
  component: EditPersonaPage,
});

interface Tone {
  warmth: number;
  formality: number;
  humor: number;
  confidence: number;
  energy: number;
}

interface PersonaProfileShape {
  bio: string;
  systemPrompt: string;
  tone: Tone;
  exemplars: Array<{ userTurn: string; personaTurn: string; context?: string }>;
  tags: string[];
  catchphrases?: string[];
  redLines?: string[];
}

interface PersonaMetaShape {
  origin: 'self' | 'parody' | 'fictional';
  moderationStatus: 'not_required' | 'pending_review' | 'approved' | 'rejected';
  versionCount: number;
  voiceEntityId?: string;
  likenessEntityId?: string;
  threeDAssetUrl?: string;
  profile: PersonaProfileShape;
}

function EditPersonaPage() {
  const { personaId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, address } = useWalletAuth();

  const persona = useQuery({
    // M10: bucket cache by viewer wallet so user B never inherits A's payload.
    queryKey: ['persona', personaId, address ?? 'anonymous'],
    queryFn: () => trpcClient.persona.get.query({ personaEntityId: personaId }),
    enabled: isAuthenticated,
  });
  const versions = useQuery({
    queryKey: ['persona', 'versions', personaId, address ?? 'anonymous'],
    queryFn: () => trpcClient.persona.listVersions.query({ personaEntityId: personaId }),
    enabled: isAuthenticated,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bio, setBio] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [tone, setTone] = useState<Tone>({
    warmth: 50,
    formality: 50,
    humor: 50,
    confidence: 50,
    energy: 50,
  });
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [changeNote, setChangeNote] = useState('');

  // Seed form once persona loads.
  // L-1: guard with a didSeed ref so we only seed ONCE per mount. The
  // [persona.data] dep would otherwise re-fire whenever the cached query
  // identity flips — notably M10's per-viewer cache buckets in `wallet-auth`
  // (keyed by wallet address) which now change the React Query result
  // identity on auth events. Without this guard, an in-progress edit would
  // get silently stomped back to the server payload.
  const didSeed = useRef(false);
  useEffect(() => {
    if (didSeed.current) return;
    if (!persona.data) return;
    const meta = persona.data.metadata as unknown as PersonaMetaShape;
    setName(persona.data.name);
    setDescription(persona.data.description ?? '');
    setBio(meta.profile.bio);
    setSystemPrompt(meta.profile.systemPrompt);
    setTone(meta.profile.tone);
    setTags(meta.profile.tags ?? []);
    didSeed.current = true;
  }, [persona.data]);

  const save = useMutation({
    mutationFn: async () => {
      const meta = persona.data?.metadata as unknown as PersonaMetaShape | undefined;
      const profile = {
        bio,
        systemPrompt,
        tone,
        exemplars: meta?.profile.exemplars ?? [],
        tags,
        catchphrases: meta?.profile.catchphrases,
        redLines: meta?.profile.redLines,
      };
      return trpcClient.persona.update.mutate({
        personaEntityId: personaId,
        name,
        description,
        profile,
        changeNote: changeNote || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Persona updated — new version published');
      // Prefix-match all viewer buckets for this persona (key shape:
      // ['persona', personaId, walletAddress|'anonymous']).
      queryClient.invalidateQueries({ queryKey: ['persona', personaId] });
      queryClient.invalidateQueries({ queryKey: ['persona', 'versions', personaId] });
      queryClient.invalidateQueries({ queryKey: ['persona', 'mine'] });
      navigate({
        to: '/marketplace/persona/$personaId',
        params: { personaId },
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update persona');
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto max-w-2xl py-12 text-center text-muted-foreground">
        Connect your wallet to edit personas.
      </div>
    );
  }
  if (persona.isLoading) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!persona.data) {
    return (
      <div className="container mx-auto max-w-2xl py-12 text-center text-muted-foreground">
        Persona not found.
      </div>
    );
  }

  const meta = persona.data.metadata as unknown as PersonaMetaShape;
  const locked = meta.moderationStatus === 'pending_review';

  return (
    <div className="container mx-auto max-w-4xl space-y-6 py-8">
      <Link
        to="/dashboard/personas"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        My personas
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Edit {persona.data.name}</h1>
        <p className="text-sm text-muted-foreground">
          Saving creates a new immutable version (v{meta.versionCount + 1}). Existing deals stay
          pinned to the version they bought.
        </p>
      </div>

      {locked && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mr-1 inline h-4 w-4 text-amber-500" />
          This persona is awaiting moderation review — edits are locked until approval.
        </div>
      )}

      <Card>
        <CardContent className="space-y-5 p-6">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={locked}
              maxLength={80}
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={locked}
              maxLength={2000}
            />
          </div>
          <Separator />
          <div>
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              disabled={locked}
              maxLength={2000}
            />
          </div>
          <div>
            <Label htmlFor="sys">System prompt</Label>
            <Textarea
              id="sys"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={6}
              disabled={locked}
              maxLength={4000}
            />
          </div>
          <Separator />
          <div className="space-y-3">
            <Label>Tone profile</Label>
            {(Object.keys(tone) as (keyof Tone)[]).map((key) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="capitalize">{key}</span>
                  <span className="text-muted-foreground">{tone[key]}</span>
                </div>
                <Slider
                  value={[tone[key]]}
                  onValueChange={(v) => setTone((t) => ({ ...t, [key]: v[0] ?? 50 }))}
                  min={0}
                  max={100}
                  step={1}
                  disabled={locked}
                />
              </div>
            ))}
          </div>
          <Separator />
          <div>
            <Label>Tags</Label>
            <div className="mt-2 mb-2 flex flex-wrap gap-1">
              {tags.map((t, i) => (
                <Badge key={`${t}-${i}`} variant="secondary" className="gap-1">
                  {t}
                  <button
                    type="button"
                    className="ml-1 text-xs"
                    onClick={() => setTags(tags.filter((_, idx) => idx !== i))}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Add tag"
                disabled={locked}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = tagInput.trim();
                    if (!v || tags.includes(v) || tags.length >= 12) return;
                    setTags([...tags, v]);
                    setTagInput('');
                  }
                }}
              />
            </div>
          </div>

          <Separator />
          <div>
            <Label htmlFor="changeNote">Changelog note (optional)</Label>
            <Input
              id="changeNote"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder='e.g. "Cooler tone, added darker red lines"'
              maxLength={200}
              disabled={locked}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link to="/marketplace/persona/$personaId" params={{ personaId }}>
            Cancel
          </Link>
        </Button>
        <Button disabled={locked || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Publishing v{meta.versionCount + 1}…
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Save as v{meta.versionCount + 1}
            </>
          )}
        </Button>
      </div>

      {versions.data && versions.data.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4" />
              <h2 className="font-semibold">Version history</h2>
            </div>
            {versions.data.map((v) => (
              <div key={v.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={v.active ? 'default' : 'outline'}>v{v.version}</Badge>
                  {v.active && <span className="text-xs text-emerald-600">active</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(v.createdAt as unknown as string).toLocaleString()}
                  </span>
                </div>
                {v.changeNote && <div className="mt-1 text-muted-foreground">{v.changeNote}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
