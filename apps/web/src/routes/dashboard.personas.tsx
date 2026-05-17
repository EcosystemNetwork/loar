/**
 * /dashboard/personas — Manage Personas.
 *
 * Lists the caller's personas with their moderation status, version count,
 * and quick actions: open detail, edit (creates a new version), list for
 * sale (jumps into the existing likenessMarketplace listing flow).
 */
import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  UserCircle2,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  Pencil,
  ExternalLink,
  Tag,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ListPersonaForSaleDialog } from '@/components/likeness-marketplace/ListPersonaForSaleDialog';

export const Route = createFileRoute('/dashboard/personas')({
  component: DashboardPersonasPage,
});

interface PersonaMetadataShape {
  origin: 'self' | 'parody' | 'fictional';
  moderationStatus: 'not_required' | 'pending_review' | 'approved' | 'rejected';
  versionCount: number;
  voiceEntityId?: string;
  likenessEntityId?: string;
  threeDAssetUrl?: string;
}

function DashboardPersonasPage() {
  const { isAuthenticated, address } = useWalletAuth();
  const [listDialogFor, setListDialogFor] = useState<null | {
    id: string;
    name: string;
    description?: string | null;
    imageUrl?: string | null;
    metadata: Record<string, unknown>;
  }>(null);

  const personas = useQuery({
    // M10: bucket by wallet so a previous user's personas are never shown
    // to the next signed-in user from cache.
    queryKey: ['persona', 'mine', address ?? 'anonymous'],
    queryFn: () => trpcClient.persona.listMine.query(),
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto max-w-2xl py-12">
        <Card>
          <CardContent className="p-8 text-center">
            <UserCircle2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Connect your wallet to manage personas.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Personas</h1>
          <p className="mt-1 text-muted-foreground">
            Bundles of voice + looks + 3D + personality that you can sell, lease, or license.
          </p>
        </div>
        <Button asChild>
          <Link to="/create/persona">
            <Plus className="mr-1 h-4 w-4" />
            New persona
          </Link>
        </Button>
      </div>

      {personas.isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {personas.data && personas.data.length === 0 && (
        <Card>
          <CardContent className="space-y-3 p-12 text-center">
            <UserCircle2 className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">No personas yet</h2>
            <p className="text-sm text-muted-foreground">
              Bundle a voice, likeness, 3D model, and personality into a single sellable identity.
            </p>
            <Button asChild>
              <Link to="/create/persona">Create your first persona</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {personas.data && personas.data.length > 0 && (
        <div className="space-y-3">
          {personas.data.map((p) => {
            const meta = p.metadata as unknown as PersonaMetadataShape;
            return (
              <Card key={p.id}>
                <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <UserCircle2 className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <OriginBadge origin={meta.origin} />
                      <Badge variant="outline" className="text-xs">
                        v{meta.versionCount}
                      </Badge>
                      <ModerationBadge status={meta.moderationStatus} />
                    </div>
                    {p.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1">{p.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 pt-1 text-xs text-muted-foreground">
                      {meta.voiceEntityId && <Badge variant="secondary">voice</Badge>}
                      {meta.likenessEntityId && <Badge variant="secondary">likeness</Badge>}
                      {meta.threeDAssetUrl && <Badge variant="secondary">3D</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
                    <Button asChild variant="outline" size="sm">
                      <Link to="/marketplace/persona/$personaId" params={{ personaId: p.id }}>
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        View
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/dashboard/personas/$personaId/edit" params={{ personaId: p.id }}>
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Edit
                      </Link>
                    </Button>
                    {meta.moderationStatus !== 'pending_review' &&
                      meta.moderationStatus !== 'rejected' && (
                        <Button
                          size="sm"
                          onClick={() =>
                            setListDialogFor({
                              id: p.id,
                              name: p.name,
                              description: p.description,
                              imageUrl: p.imageUrl,
                              metadata: p.metadata,
                            })
                          }
                        >
                          <Tag className="mr-1 h-3.5 w-3.5" />
                          List
                        </Button>
                      )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {listDialogFor && (
        <ListPersonaForSaleDialog
          persona={listDialogFor}
          onClose={() => setListDialogFor(null)}
          onSuccess={() => setListDialogFor(null)}
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

function ModerationBadge({
  status,
}: {
  status: 'not_required' | 'pending_review' | 'approved' | 'rejected';
}) {
  if (status === 'pending_review') {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700">
        Pending review
      </Badge>
    );
  }
  if (status === 'rejected') {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        Rejected
      </Badge>
    );
  }
  return null;
}
