/**
 * Navigation model for the wiki hub.
 *
 * Every view is still addressed by a flat `?tab=` id (so existing links keep
 * working); this file only decides how those ids are grouped for display.
 * The hub renders one row of groups and, beneath it, the views in the active
 * group — instead of a single strip of 30+ tabs.
 */
import {
  Users,
  MapPin,
  Package,
  Swords,
  Zap,
  BookOpen,
  Dna,
  Layers,
  Cpu,
  Building2,
  GitBranch,
  Eye,
  Box,
  Hexagon,
  Castle,
  Crown,
  ImageIcon,
  UserCircle,
  Images,
  Palette,
  Rotate3d,
  Film,
  Music,
  Network,
  CalendarDays,
  Map as MapIcon,
  ListOrdered,
  Activity,
  BarChart3,
  Heart,
  Sparkles,
  Compass,
  Library,
  Clapperboard,
  Orbit,
} from 'lucide-react';
import type { EntityKind, WikiTab } from './types';

type IconComponent = React.ComponentType<{ className?: string }>;

export interface WikiTabDef {
  id: WikiTab;
  label: string;
  kind?: EntityKind;
  icon: IconComponent;
}

export type WikiGroupId = 'discover' | 'entities' | 'story' | 'structure' | 'saved';

export interface WikiGroupDef {
  id: WikiGroupId;
  label: string;
  hint: string;
  icon: IconComponent;
  tabs: WikiTabDef[];
}

const kindTab = (id: EntityKind, label: string, icon: IconComponent): WikiTabDef => ({
  id,
  label,
  kind: id,
  icon,
});

export const WIKI_GROUPS: WikiGroupDef[] = [
  {
    id: 'discover',
    label: 'Discover',
    hint: 'Browse, ask and explore',
    icon: Compass,
    tabs: [
      { id: 'gallery', label: 'Gallery', icon: ImageIcon },
      { id: 'ask', label: 'Ask', icon: Sparkles },
      { id: 'az-index', label: 'A–Z', icon: ListOrdered },
      { id: 'graph', label: 'Graph', icon: Network },
      { id: 'event-timeline', label: 'Timeline', icon: CalendarDays },
      { id: 'places-map', label: 'Map', icon: MapIcon },
      { id: 'stats', label: 'Stats', icon: BarChart3 },
      { id: 'activity', label: 'Activity', icon: Activity },
      { id: 'creators', label: 'Creators', icon: UserCircle },
    ],
  },
  {
    id: 'entities',
    label: 'Entities',
    hint: 'Everything canon is made of',
    icon: Library,
    tabs: [
      kindTab('person', 'People', Users),
      kindTab('place', 'Places', MapPin),
      kindTab('thing', 'Things', Package),
      kindTab('faction', 'Factions', Swords),
      kindTab('event', 'Events', Zap),
      kindTab('lore', 'Lore', BookOpen),
      kindTab('species', 'Species', Dna),
      kindTab('vehicle', 'Vehicles', Layers),
      kindTab('technology', 'Tech', Cpu),
      kindTab('organization', 'Orgs', Building2),
      kindTab('moodboard', 'Moodboards', Images),
      kindTab('style_pack', 'Style Packs', Palette),
    ],
  },
  {
    id: 'story',
    label: 'Story & media',
    hint: 'Episodes, sound and models',
    icon: Clapperboard,
    tabs: [
      { id: 'episodes', label: 'Episodes', icon: Film },
      { id: 'audio', label: 'Audio', icon: Music },
      { id: 'character-profiles', label: 'Profiles', icon: UserCircle },
      { id: '3d-models', label: '3D Models', icon: Rotate3d },
      { id: 'collection', label: 'Collection', icon: Users },
    ],
  },
  {
    id: 'structure',
    label: 'Structure',
    hint: 'Timelines, realities and realms',
    icon: Orbit,
    tabs: [
      kindTab('timeline', 'Timelines', GitBranch),
      kindTab('reality', 'Realities', Eye),
      kindTab('dimension', 'Dimensions', Box),
      kindTab('plane', 'Planes', Hexagon),
      kindTab('realm', 'Realms', Castle),
      kindTab('domain', 'Domains', Crown),
    ],
  },
  {
    id: 'saved',
    label: 'Saved',
    hint: 'Your bookmarks',
    icon: Heart,
    tabs: [{ id: 'bookmarks', label: 'Bookmarks', icon: Heart }],
  },
];

/** Flat list of every view, in display order. */
export const WIKI_TABS: WikiTabDef[] = WIKI_GROUPS.flatMap((g) => g.tabs);

/** The view shown when `?tab=` is absent. Omitted from the URL. */
export const DEFAULT_WIKI_TAB: WikiTab = 'gallery';

/** Resolve a raw `?tab=` value to a known view, falling back to the default. */
export function resolveWikiTab(raw: string | undefined): WikiTab {
  if (raw && WIKI_TABS.some((t) => t.id === raw)) return raw as WikiTab;
  return DEFAULT_WIKI_TAB;
}

export function findWikiTab(id: WikiTab): WikiTabDef {
  return WIKI_TABS.find((t) => t.id === id) ?? WIKI_TABS[0];
}

/** The group a view belongs to. */
export function groupForTab(id: WikiTab): WikiGroupDef {
  return WIKI_GROUPS.find((g) => g.tabs.some((t) => t.id === id)) ?? WIKI_GROUPS[0];
}

/** Build the /wiki search object; the default view is omitted to keep URLs clean. */
export function buildWikiSearch(
  tab: WikiTab,
  universe: string | undefined
): { universe?: string; tab?: string } {
  const s: { universe?: string; tab?: string } = {};
  if (universe) s.universe = universe;
  if (tab !== DEFAULT_WIKI_TAB) s.tab = tab;
  return s;
}
