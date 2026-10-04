/**
 * Per-kind display metadata (icon, singular, plural) shared by the wiki front
 * page and the entity article.
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
  Images,
  Palette,
} from 'lucide-react';

type IconComponent = React.ComponentType<{ className?: string }>;

export const KIND_ICONS: Record<string, IconComponent> = {
  person: Users,
  place: MapPin,
  thing: Package,
  faction: Swords,
  event: Zap,
  lore: BookOpen,
  species: Dna,
  vehicle: Layers,
  technology: Cpu,
  organization: Building2,
  moodboard: Images,
  style_pack: Palette,
  timeline: GitBranch,
  reality: Eye,
  dimension: Box,
  plane: Hexagon,
  realm: Castle,
  domain: Crown,
};

export const KIND_LABELS: Record<string, string> = {
  person: 'Person',
  place: 'Place',
  thing: 'Thing / Artifact',
  faction: 'Faction',
  event: 'Event',
  lore: 'Lore Page',
  species: 'Species',
  vehicle: 'Vehicle',
  technology: 'Technology',
  organization: 'Organization',
  moodboard: 'Moodboard',
  style_pack: 'Style Pack',
  timeline: 'Timeline',
  reality: 'Reality',
  dimension: 'Dimension',
  plane: 'Plane',
  realm: 'Realm',
  domain: 'Domain',
};

export const KIND_PLURALS: Record<string, string> = {
  person: 'People',
  place: 'Places',
  thing: 'Things',
  faction: 'Factions',
  event: 'Events',
  lore: 'Lore',
  species: 'Species',
  vehicle: 'Vehicles',
  technology: 'Technology',
  organization: 'Organizations',
  moodboard: 'Moodboards',
  style_pack: 'Style Packs',
  timeline: 'Timelines',
  reality: 'Realities',
  dimension: 'Dimensions',
  plane: 'Planes',
  realm: 'Realms',
  domain: 'Domains',
};

export function kindIcon(kind: string): IconComponent {
  return KIND_ICONS[kind] ?? Package;
}
