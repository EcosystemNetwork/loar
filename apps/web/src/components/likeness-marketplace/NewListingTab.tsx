/**
 * NewListingTab — the "create something to sell" hub on My Listings.
 *
 * Three sources, one place:
 *   - My likeness   → the full upload flow (CreateLikenessFlow, embedded)
 *   - My characters → original-character personas the seller created, listed
 *                     through ListPersonaForSaleDialog; plus a deep link into
 *                     /create/persona for making a new one
 *   - My voices     → cloned/designed voices from Voice Studio
 *
 * Personas that already have a live/paused listing are shown as "Listed"
 * (managed from the Listings tab) so a seller can't double-list.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Camera,
  CheckCircle2,
  Loader2,
  Mic,
  Plus,
  Sparkles,
  Tag,
  UserCircle2,
  ShieldAlert,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MyVoice } from '@/components/voice-studio/voice-studio.types';
import { CreateLikenessFlow } from './CreateLikenessFlow';
import { ListPersonaForSaleDialog } from './ListPersonaForSaleDialog';
import { ListVoiceForSaleDialog } from './ListVoiceForSaleDialog';

interface PersonaRow {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  metadata: Record<string, unknown>;
}

interface PersonaMetaShape {
  origin?: 'self' | 'parody' | 'fictional';
  moderationStatus?: 'not_required' | 'pending_review' | 'approved' | 'rejected';
}

const ORIGIN_LABEL: Record<NonNullable<PersonaMetaShape['origin']>, string> = {
  self: 'Based on me',
  parody: 'Parody',
  fictional: 'Original character',
};

interface NewListingTabProps {
  /** Entity ids that already have a listing (active or paused). */
  listedEntityIds: ReadonlySet<string>;
  /** Called after any listing is created so the parent can refresh + switch tabs. */
  onListed: () => void;
}

export function NewListingTab({ listedEntityIds, onListed }: NewListingTabProps) {
  const [uploading, setUploading] = useState(false);

  if (uploading) {
    return (
      <div className="mt-4">
        <CreateLikenessFlow
          embedded
          onExit={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            onListed();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-8">
      <section>
        <SectionHeading
          icon={<Camera className="size-4" />}
          title="Your likeness"
          blurb="Upload photos, clips or a 3D scan of yourself. Raw files stay private — buyers only ever see the stylized thumbnail until they hold a license."
        />
        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="text-sm text-muted-foreground">
              Five quick steps: upload → optional AI renders → profile → consent → pricing. Listings
              that claim to be a real person go live after a one-time identity check.
            </div>
            <Button onClick={() => setUploading(true)} className="shrink-0">
              <Plus className="size-4 mr-1.5" />
              Upload my likeness
            </Button>
          </CardContent>
        </Card>
      </section>

      <CharactersSection listedEntityIds={listedEntityIds} onListed={onListed} />
      <VoicesSection onListed={onListed} />
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  blurb,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div>
        <h2 className="font-semibold flex items-center gap-1.5">
          {icon}
          {title}
        </h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-xl">{blurb}</p>
      </div>
      {action}
    </div>
  );
}

function CharactersSection({ listedEntityIds, onListed }: NewListingTabProps) {
  const { address } = useWalletAuth();
  const [listing, setListing] = useState<PersonaRow | null>(null);

  const personas = useQuery({
    // Keyed by wallet so a previous user's personas never leak from cache.
    queryKey: ['persona', 'mine', address ?? 'anonymous'],
    queryFn: () => trpcClient.persona.listMine.query(),
  });
  const rows = (personas.data ?? []) as unknown as PersonaRow[];

  return (
    <section>
      <SectionHeading
        icon={<Sparkles className="size-4" />}
        title="Your characters"
        blurb="Turn characters you created into licensable IP — sell them outright, lease them by the day, or license them with a royalty. Original characters publish immediately."
        action={
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/create/persona" search={{ origin: 'fictional' }}>
              <Plus className="size-3.5 mr-1.5" />
              New character
            </Link>
          </Button>
        }
      />

      {personas.isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : personas.isError ? (
        <p className="text-sm text-destructive">
          Couldn't load your characters —{' '}
          {personas.error instanceof Error ? personas.error.message : 'unknown error'}.
        </p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <UserCircle2 className="size-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-3">
              You haven't created a character yet. Bundle a look, voice, 3D model and personality,
              then list it here.
            </p>
            <Button asChild size="sm">
              <Link to="/create/persona" search={{ origin: 'fictional' }}>
                Create your first character
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => {
            const meta = (p.metadata ?? {}) as PersonaMetaShape;
            const blocked =
              meta.moderationStatus === 'pending_review' || meta.moderationStatus === 'rejected';
            return (
              <EntityRow
                key={p.id}
                thumb={p.imageUrl}
                fallback={<UserCircle2 className="size-5" />}
                title={p.name}
                badges={
                  <>
                    {meta.origin && (
                      <Badge variant="outline" className="text-[10px]">
                        {ORIGIN_LABEL[meta.origin]}
                      </Badge>
                    )}
                    {meta.moderationStatus === 'pending_review' && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-500 text-amber-600"
                      >
                        <ShieldAlert className="size-2.5 mr-1" />
                        In review
                      </Badge>
                    )}
                    {meta.moderationStatus === 'rejected' && (
                      <Badge variant="destructive" className="text-[10px]">
                        Rejected
                      </Badge>
                    )}
                  </>
                }
                subtitle={p.description ?? undefined}
                listed={listedEntityIds.has(p.id)}
                blocked={blocked}
                onList={() => setListing(p)}
              />
            );
          })}
        </div>
      )}

      {listing && (
        <ListPersonaForSaleDialog
          persona={listing}
          onClose={() => setListing(null)}
          onSuccess={() => {
            toast.success('Listing created — manage it below');
            setListing(null);
            onListed();
          }}
        />
      )}
    </section>
  );
}

function VoicesSection({ onListed }: Pick<NewListingTabProps, 'onListed'>) {
  const [listing, setListing] = useState<MyVoice | null>(null);

  const voices = useQuery({
    queryKey: ['voiceLibrary', 'myVoices'],
    queryFn: () => trpcClient.voiceLibrary.myVoices.query({}),
  });
  // Curated catalog voices are LOAR-owned; only clones/designs are the seller's to list.
  const rows = ((voices.data ?? []) as MyVoice[]).filter((v) => v.source !== 'library');

  return (
    <section>
      <SectionHeading
        icon={<Mic className="size-4" />}
        title="Your voices"
        blurb="Cloned or designed voices from Voice Studio."
        action={
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/lab/voice-studio">
              <Plus className="size-3.5 mr-1.5" />
              Voice Studio
            </Link>
          </Button>
        }
      />
      {voices.isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : voices.isError ? (
        <p className="text-sm text-destructive">
          Couldn't load your voices —{' '}
          {voices.error instanceof Error ? voices.error.message : 'unknown error'}.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cloned or designed voices yet. Create one in Voice Studio to list it.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((v) => (
            <EntityRow
              key={v.id}
              fallback={<Mic className="size-5" />}
              title={v.name}
              subtitle={v.description}
              badges={
                <Badge variant="outline" className="text-[10px]">
                  {v.source === 'clone' ? 'Cloned' : 'Designed'}
                </Badge>
              }
              onList={() => setListing(v)}
            />
          ))}
        </div>
      )}

      {listing && (
        <ListVoiceForSaleDialog
          voice={listing}
          onClose={() => setListing(null)}
          onSuccess={() => {
            toast.success('Listing created — manage it below');
            setListing(null);
            onListed();
          }}
        />
      )}
    </section>
  );
}

function EntityRow({
  thumb,
  fallback,
  title,
  subtitle,
  badges,
  listed,
  blocked,
  onList,
}: {
  thumb?: string | null;
  fallback: React.ReactNode;
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
  listed?: boolean;
  blocked?: boolean;
  onList: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="size-12 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center text-muted-foreground">
          {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : fallback}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-sm truncate">{title}</span>
            {badges}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{subtitle}</p>
          )}
        </div>
        {listed ? (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            <CheckCircle2 className="size-2.5 mr-1" />
            Listed
          </Badge>
        ) : (
          <Button size="sm" onClick={onList} disabled={blocked} className="shrink-0">
            <Tag className="size-3.5 mr-1.5" />
            List
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
