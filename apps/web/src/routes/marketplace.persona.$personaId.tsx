/**
 * /marketplace/persona/$personaId — Persona detail page.
 *
 * Shows the persona's bundled components (voice, likeness, 3D model),
 * personality block, origin classification, and any active listings.
 * Buying / leasing / licensing flows through the existing
 * /marketplace/likeness/$listingId page on a specific listing of this persona.
 */
import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { formatEther } from 'viem';
import {
  Loader2,
  ChevronLeft,
  Sparkles,
  AlertTriangle,
  UserCircle2,
  Mic2,
  ImageIcon,
  Box,
  Pencil,
  ExternalLink,
  ShieldAlert,
  CheckCircle2,
  Tag,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ModelViewer } from '@/components/ModelViewer';
import { ListPersonaForSaleDialog } from '@/components/likeness-marketplace/ListPersonaForSaleDialog';

export const Route = createFileRoute('/marketplace/persona/$personaId')({
  component: PersonaDetailPage,
});

interface PersonaMetadataShape {
  origin: 'self' | 'parody' | 'fictional';
  parodySubject?: string;
  parodyDisclaimer?: string;
  voiceEntityId?: string;
  likenessEntityId?: string;
  threeDAssetUrl?: string;
  threeDGenerationId?: string;
  moderationStatus: 'not_required' | 'pending_review' | 'approved' | 'rejected';
  moderationNotes?: string;
  activeVersionId: string;
  versionCount: number;
  profile: {
    bio: string;
    systemPrompt: string;
    tone: {
      warmth: number;
      formality: number;
      humor: number;
      confidence: number;
      energy: number;
    };
    exemplars: Array<{ userTurn: string; personaTurn: string; context?: string }>;
    tags: string[];
    catchphrases?: string[];
    redLines?: string[];
  };
}

interface PersonaListingShape {
  id: string;
  buyPriceWei: string;
  leasePricePerDayWei: string;
  licenseFeeWei: string;
  active: boolean;
}

function formatEthDisplay(wei: string): string {
  if (wei === '0') return '—';
  try {
    return `${formatEther(BigInt(wei))} ETH`;
  } catch {
    return '?';
  }
}

function PersonaDetailPage() {
  const { personaId } = Route.useParams();
  const { address } = useWalletAuth();
  const [listDialogOpen, setListDialogOpen] = useState(false);

  const persona = useQuery({
    // Cache-bucket by viewer wallet so a logged-out (or different) viewer
    // never sees the previous user's persona payload (which can include
    // owner-only fields like `systemPrompt`). M10.
    queryKey: ['persona', personaId, address ?? 'anonymous'],
    queryFn: () => trpcClient.persona.get.query({ personaEntityId: personaId }),
  });

  const meta = (persona.data?.metadata ?? null) as PersonaMetadataShape | null;
  const isOwner =
    !!address &&
    !!persona.data &&
    (persona.data.creator || '').toLowerCase() === address.toLowerCase();

  // Linked components (read public entity records).
  const voice = useQuery({
    queryKey: ['entities', 'one', meta?.voiceEntityId ?? null],
    queryFn: async () =>
      meta?.voiceEntityId ? trpcClient.entities.get.query({ entityId: meta.voiceEntityId }) : null,
    enabled: !!meta?.voiceEntityId,
  });
  const likeness = useQuery({
    queryKey: ['entities', 'one', meta?.likenessEntityId ?? null],
    queryFn: async () =>
      meta?.likenessEntityId
        ? trpcClient.entities.get.query({ entityId: meta.likenessEntityId })
        : null,
    enabled: !!meta?.likenessEntityId,
  });

  // Active listings on this persona (cheap fetch — browse with no filter, then
  // post-filter by entityId).
  const listings = useQuery({
    queryKey: ['listings', 'persona', personaId],
    queryFn: async () => {
      const all = await trpcClient.likenessMarketplace.browse.query({
        kind: 'persona',
        limit: 50,
        sortBy: 'newest',
      });
      return all.listings.filter((l) => l.entityId === personaId) as PersonaListingShape[];
    },
  });

  if (persona.isLoading) {
    return (
      <div className="container mx-auto max-w-4xl py-12 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!persona.data || !meta) {
    return (
      <div className="container mx-auto max-w-2xl py-12">
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Persona not found</h2>
            <p className="text-sm text-muted-foreground">
              It may have been removed, rejected in moderation, or you do not have access.
            </p>
            <Link to="/marketplace/likeness" className="text-primary underline">
              Back to marketplace
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 py-8">
      <div>
        <Link
          to="/marketplace/likeness"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          All listings
        </Link>
      </div>

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="h-32 w-32 shrink-0 overflow-hidden rounded-xl bg-muted">
          {persona.data.imageUrl ? (
            <img
              src={persona.data.imageUrl}
              alt={persona.data.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <UserCircle2 className="h-12 w-12" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">{persona.data.name}</h1>
            <OriginBadge origin={meta.origin} />
            <Badge variant="outline">v{meta.versionCount}</Badge>
          </div>
          {meta.origin === 'parody' && meta.parodySubject && (
            <div className="text-sm text-muted-foreground">
              Parody of <span className="font-medium">{meta.parodySubject}</span>
            </div>
          )}
          {persona.data.description && (
            <p className="text-muted-foreground">{persona.data.description}</p>
          )}
          {meta.profile.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {meta.profile.tags.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {isOwner && (
          <div className="flex flex-col gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/personas/$personaId/edit" params={{ personaId }}>
                <Pencil className="mr-1 h-4 w-4" />
                Edit persona
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* ── Parody disclaimer banner ──────────────────────────────── */}
      {meta.origin === 'parody' && meta.parodyDisclaimer && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mr-1 inline h-4 w-4 text-amber-500" />
          {meta.parodyDisclaimer}
        </div>
      )}
      {meta.moderationStatus === 'pending_review' && isOwner && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <Loader2 className="mr-1 inline h-4 w-4 animate-spin text-amber-500" />
          This persona is awaiting admin moderation. Listings cannot go live yet.
        </div>
      )}
      {meta.moderationStatus === 'rejected' && isOwner && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mr-1 inline h-4 w-4 text-destructive" />
          This persona was rejected in moderation review.
          {meta.moderationNotes && <span> Notes: {meta.moderationNotes}</span>}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {/* ── 3D viewer (full width on mobile, 2 cols on desktop) ── */}
        <div className="md:col-span-2 space-y-6">
          {meta.threeDAssetUrl && (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-hidden rounded-md">
                  <ModelViewer
                    src={meta.threeDAssetUrl}
                    alt={`${persona.data.name} 3D model`}
                    className="h-96 w-full"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bio */}
          {meta.profile.bio && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  <h2 className="font-semibold">About</h2>
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {meta.profile.bio}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Tone profile */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Tone profile</h2>
              <div className="space-y-2">
                {(Object.keys(meta.profile.tone) as (keyof typeof meta.profile.tone)[]).map((k) => (
                  <ToneBar key={k} label={k} value={meta.profile.tone[k]} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Exemplars (public — surfaces persona voice) */}
          {meta.profile.exemplars.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <h2 className="font-semibold">Sample dialogue</h2>
                {meta.profile.exemplars.map((ex, i) => (
                  <div key={i} className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="text-muted-foreground">User: {ex.userTurn}</div>
                    <div className="mt-1">
                      {persona.data?.name}: {ex.personaTurn}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* System prompt — owner only */}
          {isOwner && meta.profile.systemPrompt && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <h2 className="font-semibold">System prompt (private)</h2>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                  {meta.profile.systemPrompt}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Sidebar: components + listings ───────────────────── */}
        <div className="space-y-4">
          {/* Components */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Components</h2>
              <ComponentRow
                icon={<Mic2 className="h-4 w-4" />}
                label="Voice"
                value={voice.data ? voice.data.name : meta.voiceEntityId ? 'Linked' : '—'}
                href={voice.data ? `/wiki/entity/${voice.data.id}` : undefined}
              />
              <ComponentRow
                icon={<ImageIcon className="h-4 w-4" />}
                label="Looks"
                value={likeness.data ? likeness.data.name : meta.likenessEntityId ? 'Linked' : '—'}
                href={likeness.data ? `/wiki/entity/${likeness.data.id}` : undefined}
              />
              <ComponentRow
                icon={<Box className="h-4 w-4" />}
                label="3D model"
                value={meta.threeDAssetUrl ? 'Attached (GLB)' : '—'}
              />
            </CardContent>
          </Card>

          {/* Listings */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Listings</h2>
              {listings.isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {listings.data && listings.data.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {isOwner
                    ? 'No active listings. Open the listing flow from your dashboard to make this persona sellable.'
                    : 'Not listed for sale right now.'}
                </p>
              )}
              {listings.data && listings.data.map((l) => <ListingRow key={l.id} listing={l} />)}
              {isOwner &&
                meta.moderationStatus !== 'pending_review' &&
                meta.moderationStatus !== 'rejected' && (
                  <Button className="w-full" size="sm" onClick={() => setListDialogOpen(true)}>
                    <Tag className="mr-1 h-4 w-4" />
                    List for sale / lease / license
                  </Button>
                )}
              {isOwner && meta.moderationStatus === 'pending_review' && (
                <Button className="w-full" variant="outline" size="sm" disabled>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Listing locked — awaiting review
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {listDialogOpen && persona.data && (
        <ListPersonaForSaleDialog
          persona={{
            id: persona.data.id,
            name: persona.data.name,
            description: persona.data.description,
            imageUrl: persona.data.imageUrl,
            metadata: persona.data.metadata,
          }}
          onClose={() => setListDialogOpen(false)}
          onSuccess={() => setListDialogOpen(false)}
        />
      )}
    </div>
  );
}

function OriginBadge({ origin }: { origin: 'self' | 'parody' | 'fictional' }) {
  if (origin === 'parody') {
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700">
        <AlertTriangle className="mr-1 h-3 w-3" />
        Parody
      </Badge>
    );
  }
  if (origin === 'fictional') {
    return (
      <Badge variant="outline">
        <Sparkles className="mr-1 h-3 w-3" />
        Fictional
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <CheckCircle2 className="mr-1 h-3 w-3" />
      Self
    </Badge>
  );
}

function ToneBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="capitalize">{label}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ComponentRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={href ? 'text-primary underline' : ''}>{value}</span>
    </div>
  );
  return href ? <Link to={href}>{content}</Link> : content;
}

function ListingRow({ listing }: { listing: PersonaListingShape }) {
  return (
    <div className="space-y-1 rounded-md border p-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Buy</span>
        <span>{formatEthDisplay(listing.buyPriceWei)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Lease / day</span>
        <span>{formatEthDisplay(listing.leasePricePerDayWei)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">License</span>
        <span>{formatEthDisplay(listing.licenseFeeWei)}</span>
      </div>
      <Separator />
      <Button asChild size="sm" variant="outline" className="w-full">
        <Link to="/marketplace/likeness/$listingId" params={{ listingId: listing.id }}>
          View deal terms
          <ExternalLink className="ml-1 h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}
