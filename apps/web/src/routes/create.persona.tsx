/**
 * /create/persona — Create a Persona Package (PRD 9).
 *
 * A persona bundles voice + likeness + 3D + personality into one sellable
 * identity. Three origin classes (self / parody / fictional) gate verification
 * and moderation paths.
 *
 * Flow (linear, persisted to local state):
 *   1. Basics        — name, description, image, origin
 *   2. Components    — pick existing voice + likeness entities, optional 3D
 *                       (upload or generate via Meshy)
 *   3. Personality   — bio, system prompt, tone sliders, exemplars, tags
 *   4. Origin attest — parody acknowledgement OR fictional affirmation (skipped for self)
 *   5. Review + Publish — POST persona.create. On success, route to detail page.
 *
 * Listing the persona for sale/lease/license is a follow-up step on the
 * dashboard (uses the existing likenessMarketplace consent+listing flow).
 */
import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  Mic2,
  ImageIcon,
  Box,
  AlertTriangle,
  UserCircle2,
  ShieldAlert,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { PersonaMeshy3DGenerator } from '@/components/persona/PersonaMeshy3DGenerator';
import { ModelViewer } from '@/components/ModelViewer';

export const Route = createFileRoute('/create/persona')({
  component: CreatePersonaPage,
});

const STAGES = ['basics', 'components', 'personality', 'attest', 'review'] as const;
type Stage = (typeof STAGES)[number];

type Origin = 'self' | 'parody' | 'fictional';

interface Tone {
  warmth: number;
  formality: number;
  humor: number;
  confidence: number;
  energy: number;
}

interface Exemplar {
  userTurn: string;
  personaTurn: string;
  context?: string;
}

const DEFAULT_TONE: Tone = {
  warmth: 50,
  formality: 50,
  humor: 50,
  confidence: 50,
  energy: 50,
};

const STAGE_LABELS: Record<Stage, string> = {
  basics: 'Basics',
  components: 'Components',
  personality: 'Personality',
  attest: 'Attest',
  review: 'Review',
};

function CreatePersonaPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, address } = useWalletAuth();

  const [stage, setStage] = useState<Stage>('basics');

  // ── Basics ───────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [origin, setOrigin] = useState<Origin>('self');

  // Parody / fictional fields
  const [parodySubject, setParodySubject] = useState('');
  const [parodyDisclaimer, setParodyDisclaimer] = useState(
    'This is a parody intended as commentary/satire. It is not endorsed by or affiliated with the depicted person.'
  );
  const [parodyAck, setParodyAck] = useState(false);
  const [fictionalAffirmed, setFictionalAffirmed] = useState(false);

  // ── Components ──────────────────────────────────────────────────────
  const [voiceEntityId, setVoiceEntityId] = useState<string | null>(null);
  const [likenessEntityId, setLikenessEntityId] = useState<string | null>(null);
  const [threeDAssetUrl, setThreeDAssetUrl] = useState<string | null>(null);
  const [threeDGenerationId, setThreeDGenerationId] = useState<string | null>(null);
  const [threeDThumbnail, setThreeDThumbnail] = useState<string | null>(null);

  // ── Personality ─────────────────────────────────────────────────────
  const [bio, setBio] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [tone, setTone] = useState<Tone>(DEFAULT_TONE);
  const [exemplars, setExemplars] = useState<Exemplar[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [catchphrases, setCatchphrases] = useState<string[]>([]);
  const [catchphraseInput, setCatchphraseInput] = useState('');
  const [redLines, setRedLines] = useState<string[]>([]);
  const [redLineInput, setRedLineInput] = useState('');

  // ── Server-pinned attestation texts ─────────────────────────────────
  const attestationTexts = useQuery({
    queryKey: ['persona', 'attestationTexts'],
    queryFn: () => trpcClient.persona.attestationTexts.query(),
  });

  // ── Owned voice + likeness entities for the component picker ────────
  const myVoices = useQuery({
    queryKey: ['entities', 'voice', 'mine', address ?? ''],
    queryFn: async () => {
      if (!address) return { entities: [], total: 0 };
      return trpcClient.entities.listByCreator.query({
        creator: address.toLowerCase(),
        kind: 'voice',
        limit: 100,
      });
    },
    enabled: isAuthenticated && !!address,
  });
  const myLikenesses = useQuery({
    queryKey: ['entities', 'likeness', 'mine', address ?? ''],
    queryFn: async () => {
      if (!address) return { entities: [], total: 0 };
      return trpcClient.entities.listByCreator.query({
        creator: address.toLowerCase(),
        kind: 'likeness',
        limit: 100,
      });
    },
    enabled: isAuthenticated && !!address,
  });

  const stageIndex = STAGES.indexOf(stage);
  const canGoNext = useMemo(() => {
    if (stage === 'basics') {
      if (!name.trim()) return false;
      if (origin === 'parody' && !parodySubject.trim()) return false;
      return true;
    }
    if (stage === 'components') {
      // Allow personas with no components (pure personality) — but warn in UI.
      return true;
    }
    if (stage === 'personality') {
      return bio.trim().length > 0 || systemPrompt.trim().length > 0;
    }
    if (stage === 'attest') {
      if (origin === 'parody') return parodyAck;
      if (origin === 'fictional') return fictionalAffirmed;
      return true; // self — no attestation needed at this stage
    }
    return true;
  }, [stage, name, origin, parodySubject, bio, systemPrompt, parodyAck, fictionalAffirmed]);

  // ── Publish ─────────────────────────────────────────────────────────
  const publish = useMutation({
    mutationFn: async () => {
      if (!attestationTexts.data) throw new Error('Attestation text not loaded');
      const profile = {
        bio,
        systemPrompt,
        tone,
        exemplars,
        tags,
        catchphrases: catchphrases.length > 0 ? catchphrases : undefined,
        redLines: redLines.length > 0 ? redLines : undefined,
      };
      return trpcClient.persona.create.mutate({
        name,
        description,
        imageUrl: imageUrl || null,
        origin,
        parodySubject: origin === 'parody' ? parodySubject : undefined,
        parodyDisclaimer: origin === 'parody' ? parodyDisclaimer : undefined,
        parodyAcknowledgement: origin === 'parody' ? attestationTexts.data.parody : undefined,
        fictionalAffirmation: origin === 'fictional' ? attestationTexts.data.fictional : undefined,
        voiceEntityId: voiceEntityId ?? undefined,
        likenessEntityId: likenessEntityId ?? undefined,
        threeDAssetUrl: threeDAssetUrl ?? undefined,
        threeDGenerationId: threeDGenerationId ?? undefined,
        profile,
      });
    },
    onSuccess: (entity) => {
      toast.success('Persona created');
      queryClient.invalidateQueries({ queryKey: ['entities', 'persona'] });
      navigate({
        to: '/marketplace/persona/$personaId' as never,
        params: { personaId: entity.id } as never,
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create persona');
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto max-w-2xl py-12">
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Sign in to create a persona</h2>
            <p className="text-sm text-muted-foreground">
              Connect your wallet to bundle your voice, looks, 3D model, and personality into a
              sellable persona.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Create a Persona</h1>
        <p className="mt-1 text-muted-foreground">
          Bundle voice, looks, 3D model, and personality into one sellable identity.
        </p>
      </div>

      {/* Stage indicator */}
      <div className="mb-6 flex items-center gap-1 overflow-x-auto">
        {STAGES.map((s, i) => {
          const isPast = i < stageIndex;
          const isActive = s === stage;
          return (
            <button
              key={s}
              type="button"
              onClick={() => (isPast || isActive) && setStage(s)}
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isPast
                    ? 'bg-muted text-foreground cursor-pointer hover:bg-muted/80'
                    : 'bg-muted/50 text-muted-foreground'
              }`}
            >
              {isPast && <CheckCircle2 className="h-3.5 w-3.5" />}
              <span>
                {i + 1}. {STAGE_LABELS[s]}
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-6">
          {/* ── Basics ─────────────────────────────────────────────── */}
          {stage === 'basics' && (
            <div className="space-y-5">
              <div>
                <Label htmlFor="name">Persona name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Captain Brio, Neon Detective, Lady Lunarstone"
                  maxLength={80}
                />
              </div>
              <div>
                <Label htmlFor="description">Short description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One paragraph summary surfaced on the marketplace card."
                  rows={3}
                  maxLength={2000}
                />
              </div>
              <div>
                <Label htmlFor="image">Cover image URL (optional)</Label>
                <Input
                  id="image"
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://… (uses linked likeness thumbnail if omitted)"
                />
              </div>

              <Separator />

              <div>
                <Label>Origin *</Label>
                <p className="mb-3 text-sm text-muted-foreground">
                  Parody routes the persona to admin moderation before going live. Fictional
                  requires affirming no real-person basis. Self is the default for your own
                  likeness.
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  <OriginCard
                    selected={origin === 'self'}
                    onClick={() => setOrigin('self')}
                    title="Self"
                    body="Real me. KYC and consent gates apply."
                    icon={<UserCircle2 className="h-5 w-5" />}
                  />
                  <OriginCard
                    selected={origin === 'parody'}
                    onClick={() => setOrigin('parody')}
                    title="Parody"
                    body="Parody of a public figure. Goes through moderation review."
                    icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
                  />
                  <OriginCard
                    selected={origin === 'fictional'}
                    onClick={() => setOrigin('fictional')}
                    title="Fictional"
                    body="Original character. You affirm no real person is depicted."
                    icon={<Sparkles className="h-5 w-5" />}
                  />
                </div>
              </div>

              {origin === 'parody' && (
                <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
                  <div>
                    <Label htmlFor="parody-subject">Parody subject *</Label>
                    <Input
                      id="parody-subject"
                      value={parodySubject}
                      onChange={(e) => setParodySubject(e.target.value)}
                      placeholder="The public figure being parodied"
                      maxLength={120}
                    />
                  </div>
                  <div>
                    <Label htmlFor="parody-disclaimer">Disclaimer shown on every listing</Label>
                    <Textarea
                      id="parody-disclaimer"
                      value={parodyDisclaimer}
                      onChange={(e) => setParodyDisclaimer(e.target.value)}
                      rows={2}
                      maxLength={500}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Components ─────────────────────────────────────────── */}
          {stage === 'components' && (
            <div className="space-y-6">
              {/* Voice picker */}
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <Mic2 className="h-4 w-4" />
                  <Label>Voice component (optional)</Label>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  Link an existing voice entity. Buyers who license the persona will get access to
                  this voice for their licensed use cases.
                </p>
                {myVoices.isLoading && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {myVoices.data && myVoices.data.entities.length === 0 && (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No voice entities yet.{' '}
                    <Link to="/lab/voice-studio" className="text-primary underline">
                      Create one in Voice Studio
                    </Link>
                    .
                  </div>
                )}
                {myVoices.data && myVoices.data.entities.length > 0 && (
                  <div className="grid gap-2 md:grid-cols-2">
                    {myVoices.data.entities.map((v) => (
                      <PickCard
                        key={v.id}
                        selected={voiceEntityId === v.id}
                        onClick={() => setVoiceEntityId(voiceEntityId === v.id ? null : v.id)}
                        title={v.name}
                        subtitle={v.description || 'Voice entity'}
                        imageUrl={v.imageUrl}
                      />
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              {/* Likeness picker */}
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  <Label>Looks component (optional)</Label>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  Link an existing likeness entity for face / body / video references.
                </p>
                {myLikenesses.isLoading && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {myLikenesses.data && myLikenesses.data.entities.length === 0 && (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No likeness entities yet.{' '}
                    <Link to="/create/likeness" className="text-primary underline">
                      Create one
                    </Link>
                    .
                  </div>
                )}
                {myLikenesses.data && myLikenesses.data.entities.length > 0 && (
                  <div className="grid gap-2 md:grid-cols-2">
                    {myLikenesses.data.entities.map((l) => (
                      <PickCard
                        key={l.id}
                        selected={likenessEntityId === l.id}
                        onClick={() => setLikenessEntityId(likenessEntityId === l.id ? null : l.id)}
                        title={l.name}
                        subtitle={l.description || 'Likeness entity'}
                        imageUrl={l.imageUrl}
                      />
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              {/* 3D model — Meshy generator */}
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <Box className="h-4 w-4" />
                  <Label>3D model (optional)</Label>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  Generate a 3D model via Meshy — from text, or from a reference image (e.g., your
                  linked likeness portrait).
                </p>
                {threeDAssetUrl ? (
                  <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                    <div className="overflow-hidden rounded-md">
                      <ModelViewer
                        src={threeDAssetUrl}
                        poster={threeDThumbnail ?? undefined}
                        alt="Persona 3D model"
                        className="h-64 w-full"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setThreeDAssetUrl(null);
                          setThreeDGenerationId(null);
                          setThreeDThumbnail(null);
                        }}
                      >
                        Replace
                      </Button>
                    </div>
                  </div>
                ) : (
                  <PersonaMeshy3DGenerator
                    initialImageUrl={imageUrl || null}
                    onGenerated={(r) => {
                      setThreeDAssetUrl(r.glbUrl);
                      setThreeDGenerationId(r.generationId);
                      setThreeDThumbnail(r.thumbnailUrl);
                      toast.success('3D model attached to persona');
                    }}
                  />
                )}
              </section>

              {!voiceEntityId && !likenessEntityId && !threeDAssetUrl && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <AlertTriangle className="mr-1 inline h-4 w-4 text-amber-500" />
                  No components attached. The persona will be personality-only (bio + system
                  prompt). You can always add components in an edit later.
                </div>
              )}
            </div>
          )}

          {/* ── Personality ───────────────────────────────────────── */}
          {stage === 'personality' && (
            <div className="space-y-6">
              <div>
                <Label htmlFor="bio">Bio / character sheet</Label>
                <p className="mb-1 text-sm text-muted-foreground">
                  Public-facing description on the marketplace card.
                </p>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="A weather-beaten ex-pilot with a soft spot for stray cats and stronger opinions about hyperdrives…"
                />
              </div>
              <div>
                <Label htmlFor="sysprompt">System prompt</Label>
                <p className="mb-1 text-sm text-muted-foreground">
                  Read by chat / scene AI when buyers generate with the persona. Plain text, ≤4000
                  chars.
                </p>
                <Textarea
                  id="sysprompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={6}
                  maxLength={4000}
                  placeholder="You are Captain Brio — a retired starfighter pilot now running a noodle bar on Titan. You speak in clipped, dry sentences. You distrust politicians and love good ramen. Never break character."
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <div>
                  <Label>Tone profile</Label>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Sliders feed prompt weighting. 50 = neutral.
                  </p>
                </div>
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
                    />
                  </div>
                ))}
              </div>

              <Separator />

              <ExemplarsEditor exemplars={exemplars} setExemplars={setExemplars} />

              <Separator />

              <TagsEditor
                label="Tags (≤12)"
                helper="Browse filters — femme, noir-detective, shounen-hero, etc."
                values={tags}
                input={tagInput}
                setInput={setTagInput}
                onAdd={() => {
                  const v = tagInput.trim();
                  if (!v || tags.includes(v) || tags.length >= 12) return;
                  setTags([...tags, v]);
                  setTagInput('');
                }}
                onRemove={(i) => setTags(tags.filter((_, idx) => idx !== i))}
              />
              <TagsEditor
                label="Catchphrases (optional)"
                helper="Signature lines the persona drops in naturally."
                values={catchphrases}
                input={catchphraseInput}
                setInput={setCatchphraseInput}
                onAdd={() => {
                  const v = catchphraseInput.trim();
                  if (!v || catchphrases.includes(v) || catchphrases.length >= 12) return;
                  setCatchphrases([...catchphrases, v]);
                  setCatchphraseInput('');
                }}
                onRemove={(i) => setCatchphrases(catchphrases.filter((_, idx) => idx !== i))}
              />
              <TagsEditor
                label="Red lines (optional)"
                helper={`Hard "do not say / do not do" rules above the global prohibitions.`}
                values={redLines}
                input={redLineInput}
                setInput={setRedLineInput}
                onAdd={() => {
                  const v = redLineInput.trim();
                  if (!v || redLines.includes(v) || redLines.length >= 12) return;
                  setRedLines([...redLines, v]);
                  setRedLineInput('');
                }}
                onRemove={(i) => setRedLines(redLines.filter((_, idx) => idx !== i))}
              />
            </div>
          )}

          {/* ── Attest ────────────────────────────────────────────── */}
          {stage === 'attest' && (
            <div className="space-y-4">
              {origin === 'self' && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                  <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-500" />
                  Self-origin personas use the existing consent attestation flow when listing for
                  sale/lease/license. No additional affirmation needed here.
                </div>
              )}
              {origin === 'parody' && attestationTexts.data && (
                <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                    <div>
                      <div className="font-medium">Parody acknowledgement</div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Your persona will be held in moderation until reviewed by an admin. Listings
                        on it cannot go live during review.
                      </p>
                    </div>
                  </div>
                  <p className="whitespace-pre-line text-sm">{attestationTexts.data.parody}</p>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={parodyAck}
                      onCheckedChange={(c) => setParodyAck(c === true)}
                    />
                    <span>I have read and acknowledge the parody attestation.</span>
                  </label>
                </div>
              )}
              {origin === 'fictional' && attestationTexts.data && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <div className="font-medium">Fictional character affirmation</div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Confirm this persona is not based on any real person.
                      </p>
                    </div>
                  </div>
                  <p className="whitespace-pre-line text-sm">{attestationTexts.data.fictional}</p>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={fictionalAffirmed}
                      onCheckedChange={(c) => setFictionalAffirmed(c === true)}
                    />
                    <span>I affirm the statement above is true.</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* ── Review ────────────────────────────────────────────── */}
          {stage === 'review' && (
            <div className="space-y-4">
              <SummaryRow label="Name" value={name} />
              <SummaryRow label="Origin" value={origin} />
              {origin === 'parody' && (
                <>
                  <SummaryRow label="Parody subject" value={parodySubject} />
                  <SummaryRow label="Disclaimer" value={parodyDisclaimer} multi />
                </>
              )}
              <SummaryRow
                label="Voice"
                value={voiceEntityId ? `Linked (${voiceEntityId.slice(0, 8)}…)` : '—'}
              />
              <SummaryRow
                label="Likeness"
                value={likenessEntityId ? `Linked (${likenessEntityId.slice(0, 8)}…)` : '—'}
              />
              <SummaryRow label="3D model" value={threeDAssetUrl ? 'Attached (GLB)' : '—'} />
              <SummaryRow label="Bio" value={bio || '—'} multi />
              <SummaryRow label="System prompt" value={systemPrompt || '—'} multi />
              <SummaryRow
                label="Tone"
                value={`warmth ${tone.warmth} · formality ${tone.formality} · humor ${tone.humor} · confidence ${tone.confidence} · energy ${tone.energy}`}
              />
              <SummaryRow label="Exemplars" value={`${exemplars.length} entries`} />
              <SummaryRow label="Tags" value={tags.join(', ') || '—'} />
              {origin === 'parody' && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  After submission, this persona will sit in admin moderation. Listings cannot go
                  live until approval.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Nav buttons */}
      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="outline"
          disabled={stageIndex === 0 || publish.isPending}
          onClick={() => setStage(STAGES[stageIndex - 1])}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        {stage !== 'review' ? (
          <Button disabled={!canGoNext} onClick={() => setStage(STAGES[stageIndex + 1])}>
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button
            disabled={publish.isPending || !attestationTexts.data}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Publishing…
              </>
            ) : (
              <>
                Publish persona
                <CheckCircle2 className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function OriginCard({
  selected,
  onClick,
  title,
  body,
  icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-2 rounded-md border p-3 text-left transition ${
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{body}</p>
    </button>
  );
}

function PickCard({
  selected,
  onClick,
  title,
  subtitle,
  imageUrl,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  imageUrl: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-md border p-2 text-left transition ${
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
      }`}
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <UserCircle2 className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      {selected && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" />}
    </button>
  );
}

function ExemplarsEditor({
  exemplars,
  setExemplars,
}: {
  exemplars: Exemplar[];
  setExemplars: (next: Exemplar[]) => void;
}) {
  const [draftUser, setDraftUser] = useState('');
  const [draftPersona, setDraftPersona] = useState('');
  return (
    <div className="space-y-3">
      <div>
        <Label>Few-shot dialogue exemplars (≤8)</Label>
        <p className="text-sm text-muted-foreground">
          Short example turns the runtime feeds before the user's message. They calibrate voice
          better than any tone slider.
        </p>
      </div>
      {exemplars.map((ex, i) => (
        <div key={i} className="rounded-md border p-3 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
            Turn {i + 1}
          </div>
          <div>
            <span className="font-medium">User:</span> {ex.userTurn}
          </div>
          <div>
            <span className="font-medium">Persona:</span> {ex.personaTurn}
          </div>
          <div className="mt-2 text-right">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExemplars(exemplars.filter((_, idx) => idx !== i))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      {exemplars.length < 8 && (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <Input
            value={draftUser}
            onChange={(e) => setDraftUser(e.target.value)}
            placeholder="User says…"
            maxLength={400}
          />
          <Textarea
            value={draftPersona}
            onChange={(e) => setDraftPersona(e.target.value)}
            placeholder="Persona replies (in voice)…"
            rows={2}
            maxLength={800}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!draftUser.trim() || !draftPersona.trim()) return;
              setExemplars([
                ...exemplars,
                { userTurn: draftUser.trim(), personaTurn: draftPersona.trim() },
              ]);
              setDraftUser('');
              setDraftPersona('');
            }}
          >
            Add exemplar
          </Button>
        </div>
      )}
    </div>
  );
}

function TagsEditor({
  label,
  helper,
  values,
  input,
  setInput,
  onAdd,
  onRemove,
}: {
  label: string;
  helper: string;
  values: string[];
  input: string;
  setInput: (v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mb-2 text-sm text-muted-foreground">{helper}</p>
      <div className="mb-2 flex flex-wrap gap-1">
        {values.map((v, i) => (
          <Badge key={`${v}-${i}`} variant="secondary" className="gap-1">
            {v}
            <button
              type="button"
              className="ml-1 text-xs hover:text-destructive"
              onClick={() => onRemove(i)}
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add and press Enter"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAdd();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={onAdd}>
          Add
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, multi }: { label: string; value: string; multi?: boolean }) {
  return (
    <div className={`${multi ? 'block' : 'flex items-start gap-3'} text-sm`}>
      <div className="w-32 shrink-0 text-muted-foreground">{label}</div>
      <div className={multi ? 'mt-1 whitespace-pre-line' : 'flex-1'}>{value}</div>
    </div>
  );
}
