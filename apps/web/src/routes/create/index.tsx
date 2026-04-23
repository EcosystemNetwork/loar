/**
 * Create Hub — entry point for all worldbuilding creation.
 *
 * Shows a grid of entity type cards. Universe creation (on-chain deploy)
 * is one option among many, not the only entry point.
 */
import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
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

  const { data: universeResult } = useQuery({
    queryKey: ['universe', universeAddress],
    queryFn: () => trpcClient.universes.get.query({ id: universeAddress! }),
    enabled: !!universeAddress,
  });
  const universeInfo = universeResult?.data as
    | { id: string; name?: string; image_url?: string }
    | undefined;

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      {universeInfo && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-purple-500/10 p-4">
          {universeInfo.image_url && (
            <img
              src={resolveIpfsUrl(universeInfo.image_url)}
              alt=""
              className="h-12 w-12 rounded-lg object-cover flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Building in
            </p>
            <p className="text-lg font-bold truncate">{universeInfo.name}</p>
          </div>
        </div>
      )}

      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight mb-3">Create</h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          {universeInfo
            ? `Add people, places, factions, lore, and more to ${universeInfo.name}.`
            : 'Anything in your universe is a first-class object. Build people, places, factions, and lore — or deploy a new universe on-chain.'}
        </p>
      </div>

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
