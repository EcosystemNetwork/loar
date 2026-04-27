/**
 * Create Hub — entry point for all worldbuilding creation.
 *
 * Shows a grid of entity type cards. Universe creation (on-chain deploy)
 * is one option among many, not the only entry point.
 */
import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { z } from 'zod';
import {
  Users,
  MapPin,
  Package,
  Swords,
  Zap,
  BookOpen,
  Globe,
  Upload,
  Layers,
  Cpu,
  Building2,
  Dna,
  GitBranch,
  Eye,
  Box,
  Hexagon,
  Castle,
  Crown,
  Palette,
  Images,
  NotebookPen,
} from 'lucide-react';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface EntityTypeCard {
  kind: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const ENTITY_TYPES: EntityTypeCard[] = [
  {
    kind: 'notebook',
    label: 'Notebook',
    description: 'Private scratch for raw ideas. Promote drafts to canon when ready.',
    icon: NotebookPen,
    color: 'from-yellow-500/20 to-amber-500/20 border-yellow-500/30',
  },
  {
    kind: 'universe',
    label: 'Universe',
    description: 'Deploy a narrative universe on-chain with governance token and treasury.',
    icon: Globe,
    color: 'from-violet-500/20 to-purple-500/20 border-violet-500/30',
  },
  {
    kind: 'person',
    label: 'Person',
    description: 'Characters, heroes, villains, NPCs, historical figures.',
    icon: Users,
    color: 'from-blue-500/20 to-cyan-500/20 border-blue-500/30',
  },
  {
    kind: 'place',
    label: 'Place',
    description: 'Cities, planets, dungeons, kingdoms, districts, taverns.',
    icon: MapPin,
    color: 'from-green-500/20 to-emerald-500/20 border-green-500/30',
  },
  {
    kind: 'thing',
    label: 'Thing / Artifact',
    description: 'Weapons, relics, books, tools, MacGuffins, cursed objects.',
    icon: Package,
    color: 'from-amber-500/20 to-yellow-500/20 border-amber-500/30',
  },
  {
    kind: 'faction',
    label: 'Faction',
    description: 'Guilds, houses, empires, cults, corporations, alliances.',
    icon: Swords,
    color: 'from-red-500/20 to-rose-500/20 border-red-500/30',
  },
  {
    kind: 'event',
    label: 'Event / Scene',
    description: 'Battles, discoveries, betrayals, turning points, episodes.',
    icon: Zap,
    color: 'from-orange-500/20 to-amber-500/20 border-orange-500/30',
  },
  {
    kind: 'lore',
    label: 'Lore Page',
    description: 'Magic systems, prophecies, religions, laws, histories.',
    icon: BookOpen,
    color: 'from-teal-500/20 to-cyan-500/20 border-teal-500/30',
  },
  {
    kind: 'species',
    label: 'Species',
    description: 'Races, creatures, monsters, alien life forms.',
    icon: Dna,
    color: 'from-lime-500/20 to-green-500/20 border-lime-500/30',
  },
  {
    kind: 'organization',
    label: 'Organization',
    description: 'Governments, institutions, secret societies, orders.',
    icon: Building2,
    color: 'from-indigo-500/20 to-blue-500/20 border-indigo-500/30',
  },
  {
    kind: 'vehicle',
    label: 'Vehicle',
    description: 'Ships, mechs, mounts, legendary transports.',
    icon: Layers,
    color: 'from-slate-500/20 to-zinc-500/20 border-slate-500/30',
  },
  {
    kind: 'technology',
    label: 'Technology',
    description: 'Inventions, magical systems, devices, artifacts of power.',
    icon: Cpu,
    color: 'from-sky-500/20 to-blue-500/20 border-sky-500/30',
  },
  // Visual-language kinds — PRD 5 (Retexture, Moodboards, House Style Packs)
  {
    kind: 'moodboard',
    label: 'Moodboard',
    description: 'Curate reference images and tags that describe a universe aesthetic.',
    icon: Images,
    color: 'from-pink-500/20 to-rose-500/20 border-pink-500/30',
  },
  {
    kind: 'style_pack',
    label: 'Style Pack',
    description:
      'Save a reusable look — anime, gritty sci-fi, clay, painterly, VHS — for retexture.',
    icon: Palette,
    color: 'from-fuchsia-500/20 to-purple-500/20 border-fuchsia-500/30',
  },
  // Structural / ontology kinds
  {
    kind: 'timeline',
    label: 'Timeline',
    description: 'Branching narrative threads, alternate histories, story arcs.',
    icon: GitBranch,
    color: 'from-fuchsia-500/20 to-pink-500/20 border-fuchsia-500/30',
  },
  {
    kind: 'reality',
    label: 'Reality',
    description: 'Parallel worlds, alternate realities, multiversal branches.',
    icon: Eye,
    color: 'from-violet-500/20 to-fuchsia-500/20 border-violet-500/30',
  },
  {
    kind: 'dimension',
    label: 'Dimension',
    description: 'Planes of existence, pocket dimensions, astral layers.',
    icon: Box,
    color: 'from-purple-500/20 to-violet-500/20 border-purple-500/30',
  },
  {
    kind: 'plane',
    label: 'Plane',
    description: 'Elemental planes, spirit worlds, underworlds, heavens.',
    icon: Hexagon,
    color: 'from-cyan-500/20 to-teal-500/20 border-cyan-500/30',
  },
  {
    kind: 'realm',
    label: 'Realm',
    description: 'Kingdoms, empires, sovereign territories within a dimension.',
    icon: Castle,
    color: 'from-amber-500/20 to-orange-500/20 border-amber-500/30',
  },
  {
    kind: 'domain',
    label: 'Domain',
    description: 'Sub-regions, districts, estates, controlled zones within a realm.',
    icon: Crown,
    color: 'from-rose-500/20 to-red-500/20 border-rose-500/30',
  },
];

function CreateHub() {
  const { universe: universeAddress } = useSearch({ from: '/create/' });
  const { address } = useWalletAuth();

  const { data: universeResult } = useQuery({
    queryKey: ['universe', universeAddress],
    queryFn: () => trpcClient.universes.get.query({ id: universeAddress! }),
    enabled: !!universeAddress,
  });
  const universeInfo = universeResult?.data as
    | { id: string; name?: string; image_url?: string }
    | undefined;

  const { data: myUniverses } = useQuery({
    queryKey: ['create', 'editable-universes', address],
    queryFn: () => trpcClient.universes.getEditableByMe.query(),
    enabled: !!address && !universeAddress,
    staleTime: 30_000,
  });
  const myUniverseList = ((myUniverses as any)?.data ?? []) as Array<{
    id: string;
    name?: string;
    description?: string;
    image_url?: string;
    imageURL?: string;
    portrait_image_url?: string;
    isPrivate?: boolean;
    roles?: Array<'creator' | 'safe_signer' | 'team_member'>;
  }>;

  const roleLabel = (roles: string[] | undefined): string | null => {
    if (!roles || roles.length === 0) return null;
    if (roles.includes('creator')) return null; // implicit — no badge needed
    if (roles.includes('safe_signer')) return 'Multi-sig';
    if (roles.includes('team_member')) return 'Team';
    return null;
  };

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      {universeInfo && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-purple-500/10 p-4">
          {universeInfo.image_url && (
            <img
              src={resolveIpfsUrl(universeInfo.image_url)}
              alt=""
              className="h-12 w-12 rounded-lg object-cover flex-shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Building in
            </p>
            <p className="text-lg font-bold truncate">{universeInfo.name}</p>
          </div>
          <div className="flex flex-wrap gap-2 ml-auto">
            <Link
              to="/universe/$id"
              params={{ id: universeInfo.id }}
              className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-sm font-medium text-violet-100 hover:bg-violet-500/25 hover:border-violet-500/60 transition-colors"
            >
              <GitBranch className="h-3.5 w-3.5" />
              Open editor
            </Link>
            <Link
              to="/universe/$id/watch"
              params={{ id: universeInfo.id }}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
            >
              Watch
            </Link>
            <Link
              to="/universe/$id/gallery"
              params={{ id: universeInfo.id }}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
            >
              Gallery
            </Link>
          </div>
        </div>
      )}

      <div className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-3">Create</h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            {universeInfo
              ? `Add people, places, factions, lore, and more to ${universeInfo.name}.`
              : 'Anything in your universe is a first-class object. Build people, places, factions, and lore — or deploy a new universe on-chain.'}
          </p>
        </div>
        {address && !universeAddress && (
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/20 hover:border-violet-500/50 transition-colors flex-shrink-0"
          >
            <Globe className="h-4 w-4" />
            Manage Universes
          </Link>
        )}
      </div>

      {!universeAddress && address && myUniverseList.length > 0 && (
        <div className="mb-10">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Your Universes</h2>
              <p className="text-sm text-muted-foreground">
                Pick one to author entities into, or start something new below.
              </p>
            </div>
            <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              Manage all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {myUniverseList.map((u) => {
              const img = u.image_url || u.imageURL || u.portrait_image_url || '';
              const role = roleLabel(u.roles);
              return (
                <div
                  key={u.id}
                  className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-violet-500/40 transition-all overflow-hidden"
                >
                  <Link
                    to="/create"
                    search={{ universe: u.id }}
                    className="flex items-center gap-3 p-3"
                  >
                    {img ? (
                      <img
                        src={resolveIpfsUrl(img)}
                        alt=""
                        loading="lazy"
                        className="h-12 w-12 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-violet-500/40 to-purple-500/40 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold truncate">{u.name || 'Untitled universe'}</p>
                        {u.isPrivate && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Private
                          </span>
                        )}
                        {role && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                            {role}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {u.description || `${u.id.slice(0, 6)}…${u.id.slice(-4)}`}
                      </p>
                    </div>
                  </Link>
                  <div className="flex items-stretch gap-px bg-white/5 border-t border-white/5 text-xs">
                    <Link
                      to="/universe/$id"
                      params={{ id: u.id }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 transition-colors"
                      title="Open the timeline / video-node editor"
                    >
                      <GitBranch className="h-3 w-3" />
                      Editor
                    </Link>
                    <Link
                      to="/universe/$id/watch"
                      params={{ id: u.id }}
                      className="flex-1 inline-flex items-center justify-center px-2 py-2 hover:bg-white/10 transition-colors"
                    >
                      Watch
                    </Link>
                    <Link
                      to="/universe/$id/gallery"
                      params={{ id: u.id }}
                      className="flex-1 inline-flex items-center justify-center px-2 py-2 hover:bg-white/10 transition-colors"
                    >
                      Gallery
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ENTITY_TYPES.filter(({ kind }) => (universeAddress ? kind !== 'universe' : true)).map(
          ({ kind, label, description, icon: Icon, color }) => {
            const href =
              kind === 'universe'
                ? '/cinematicUniverseCreate'
                : kind === 'notebook'
                  ? '/notebook'
                  : `/create/${kind}`;
            const search =
              kind !== 'universe' && kind !== 'notebook' && universeAddress
                ? { universe: universeAddress }
                : undefined;
            return (
              <Link
                key={kind}
                to={href as any}
                search={search as any}
                className={`group relative flex flex-col gap-3 p-6 rounded-xl border bg-gradient-to-br ${color} hover:scale-[1.02] transition-all duration-200 hover:shadow-lg`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-background/50">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-semibold">{label}</h2>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </Link>
            );
          }
        )}

        {/* Upload Media — separate card */}
        <Link
          to="/upload"
          search={{}}
          className="group relative flex flex-col gap-3 p-6 rounded-xl border bg-gradient-to-br from-pink-500/20 to-rose-500/20 border-pink-500/30 hover:scale-[1.02] transition-all duration-200 hover:shadow-lg"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-background/50">
              <Upload className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold">Upload Media</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Publish videos, images, and AI-generated content with IP classification.
          </p>
        </Link>
      </div>
    </div>
  );
}

const createHubSearchSchema = z.object({
  universe: z.string().optional(),
});

export const Route = createFileRoute('/create/')({
  component: CreateHub,
  validateSearch: createHubSearchSchema,
});
