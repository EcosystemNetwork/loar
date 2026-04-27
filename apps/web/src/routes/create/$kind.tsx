/**
 * Dynamic entity creation form.
 *
 * Route: /create/:kind
 *
 * Renders a tailored form for each entity kind (person, place, thing, faction,
 * event, lore, species, vehicle, technology, organization). Unknown kinds
 * redirect back to the create hub.
 */
import { createFileRoute, Link, useNavigate, useSearch, redirect } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { useWalletAuth } from '@/lib/wallet-auth';
import { z } from 'zod';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  ShieldCheck,
  Palette,
  ImagePlus,
  Music,
  ChevronDown,
  ChevronUp,
  Box,
  Image as ImageIcon,
  X,
  Star,
  Plus,
} from 'lucide-react';
import { ModelSelector } from '@/components/ModelSelector';
import {
  StyleControls,
  DEFAULT_STYLE_CONTROLS_VALUE,
  type StyleControlsValue,
} from '@/components/StyleControls';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

type EntityKind =
  | 'person'
  | 'place'
  | 'thing'
  | 'faction'
  | 'event'
  | 'lore'
  | 'species'
  | 'vehicle'
  | 'technology'
  | 'organization'
  | 'moodboard'
  | 'style_pack'
  | 'timeline'
  | 'reality'
  | 'dimension'
  | 'plane'
  | 'realm'
  | 'domain';

const VALID_KINDS: EntityKind[] = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
  'moodboard',
  'style_pack',
  'timeline',
  'reality',
  'dimension',
  'plane',
  'realm',
  'domain',
];

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type: 'input' | 'textarea';
  metadataKey?: boolean; /** If true, stored in metadata rather than root fields */
}

const FIELDS_BY_KIND: Record<EntityKind, FieldDef[]> = {
  person: [
    {
      key: 'role',
      label: 'Role / Archetype',
      placeholder: 'e.g. Protagonist, Villain, Mentor',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'appearance',
      label: 'Appearance',
      placeholder: 'Physical description...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'motivations',
      label: 'Motivations',
      placeholder: 'What drives them?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'abilities',
      label: 'Abilities / Skills',
      placeholder: 'Powers, skills, talents...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'homePlace',
      label: 'Home / Origin',
      placeholder: 'Where are they from?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'affiliations',
      label: 'Affiliations',
      placeholder: 'Factions, groups, loyalties...',
      type: 'input',
      metadataKey: true,
    },
  ],
  place: [
    {
      key: 'placeType',
      label: 'Type',
      placeholder: 'e.g. City, Planet, Dungeon, Kingdom',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'atmosphere',
      label: 'Atmosphere',
      placeholder: 'Mood, climate, feel...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'rulesAndDangers',
      label: 'Rules / Dangers',
      placeholder: 'What to know before entering...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'inhabitants',
      label: 'Inhabitants',
      placeholder: 'Who lives here?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'governingFaction',
      label: 'Governing Faction',
      placeholder: 'Who controls this place?',
      type: 'input',
      metadataKey: true,
    },
  ],
  thing: [
    {
      key: 'thingType',
      label: 'Type',
      placeholder: 'e.g. Weapon, Relic, Book, Tool',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'origin',
      label: 'Origin',
      placeholder: 'How was it made / where did it come from?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'powersAndUse',
      label: 'Powers / Use',
      placeholder: 'What does it do?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'rarity',
      label: 'Rarity',
      placeholder: 'e.g. Unique, Legendary, Common',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'currentOwner',
      label: 'Current Owner',
      placeholder: 'Who holds it now?',
      type: 'input',
      metadataKey: true,
    },
  ],
  faction: [
    {
      key: 'mission',
      label: 'Mission',
      placeholder: 'What do they stand for?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'ideology',
      label: 'Ideology',
      placeholder: 'Beliefs, values, worldview...',
      type: 'textarea',
      metadataKey: true,
    },
    { key: 'leader', label: 'Leader', placeholder: 'Who leads?', type: 'input', metadataKey: true },
    {
      key: 'rivals',
      label: 'Rivals / Enemies',
      placeholder: 'Who do they oppose?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'hq',
      label: 'Headquarters',
      placeholder: 'Where are they based?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'resources',
      label: 'Resources',
      placeholder: 'What assets do they command?',
      type: 'textarea',
      metadataKey: true,
    },
  ],
  event: [
    {
      key: 'era',
      label: 'Date / Era',
      placeholder: 'When did this happen?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'participants',
      label: 'Participants',
      placeholder: 'Who was involved?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'location',
      label: 'Location',
      placeholder: 'Where did it happen?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'causes',
      label: 'Causes',
      placeholder: 'What led to this?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'outcome',
      label: 'Outcome',
      placeholder: 'What resulted?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'canonStatus',
      label: 'Canon Status',
      placeholder: 'e.g. Canon, Apocrypha, Alternate Timeline',
      type: 'input',
      metadataKey: true,
    },
  ],
  lore: [
    {
      key: 'loreType',
      label: 'Type',
      placeholder: 'e.g. Magic System, Religion, Law, Prophecy',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'article',
      label: 'Article Body',
      placeholder: 'The full lore entry...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'relatedConcepts',
      label: 'Related Concepts',
      placeholder: 'Connected ideas, terms, entities...',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'canonWeight',
      label: 'Canon Weight',
      placeholder: 'e.g. Hard Canon, Soft Canon, Fanon',
      type: 'input',
      metadataKey: true,
    },
  ],
  species: [
    {
      key: 'biologicalType',
      label: 'Biological Type',
      placeholder: 'e.g. Mammalian, Insectoid, Energy Being',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'traits',
      label: 'Defining Traits',
      placeholder: 'Physical and behavioral traits...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'homeworld',
      label: 'Homeworld / Origin',
      placeholder: 'Where did they evolve?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'culture',
      label: 'Culture',
      placeholder: 'Society, customs, beliefs...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'abilities',
      label: 'Abilities',
      placeholder: 'Special powers or weaknesses...',
      type: 'textarea',
      metadataKey: true,
    },
  ],
  vehicle: [
    {
      key: 'vehicleType',
      label: 'Type',
      placeholder: 'e.g. Starship, Mech, Mount, Submarine',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'crew',
      label: 'Crew / Operator',
      placeholder: 'Who pilots or commands it?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'capabilities',
      label: 'Capabilities',
      placeholder: 'Speed, weapons, special functions...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'origin',
      label: 'Origin',
      placeholder: 'Who built it? Where?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'currentStatus',
      label: 'Current Status',
      placeholder: 'Active, destroyed, legendary...',
      type: 'input',
      metadataKey: true,
    },
  ],
  technology: [
    {
      key: 'techType',
      label: 'Type',
      placeholder: 'e.g. Weapon, Communication, Energy, Transport',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'inventor',
      label: 'Inventor / Origin',
      placeholder: 'Who created it?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'howItWorks',
      label: 'How It Works',
      placeholder: 'Mechanism, principles, rules...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'limitations',
      label: 'Limitations',
      placeholder: 'Costs, weaknesses, side effects...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'users',
      label: 'Primary Users',
      placeholder: 'Who uses this technology?',
      type: 'input',
      metadataKey: true,
    },
  ],
  // ── Visual-language kinds — PRD 5 ──────────────────────────────────
  moodboard: [
    {
      key: 'referenceImages',
      label: 'Reference Image URLs',
      placeholder: 'One URL per line — drop in Pinterest, Unsplash, IPFS, or LOAR upload URLs...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'tags',
      label: 'Tags',
      placeholder: 'neon, overcast, low-contrast, wet streets',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'notes',
      label: 'Notes on the Mood',
      placeholder: 'What feel should generators pull from this board?',
      type: 'textarea',
      metadataKey: true,
    },
  ],
  style_pack: [
    {
      key: 'basePreset',
      label: 'Base Preset',
      placeholder: 'anime, gritty-scifi, graphic-novel, clay, painterly, vhs...',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'stylePrompt',
      label: 'Style Prompt',
      placeholder: 'e.g. hand-drawn ink linework, heavy shadow, muted palette, grainy film texture',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'negativePrompt',
      label: 'Negative Prompt',
      placeholder: 'what this look avoids — smooth render, photoreal, 3D...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'styleKeywords',
      label: 'Style Keywords',
      placeholder: 'ink lines, rim light, matte colors',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'referenceImages',
      label: 'Reference Image URLs',
      placeholder: 'One URL per line — images that define this pack',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'defaultStrength',
      label: 'Default Strength (0.0 – 1.0)',
      placeholder: '0.7',
      type: 'input',
      metadataKey: true,
    },
  ],
  organization: [
    {
      key: 'orgType',
      label: 'Type',
      placeholder: 'e.g. Government, Secret Society, Corporation',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'purpose',
      label: 'Purpose',
      placeholder: 'What is this organization for?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'structure',
      label: 'Structure',
      placeholder: 'Hierarchy, leadership, ranks...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'members',
      label: 'Notable Members',
      placeholder: 'Key figures...',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'influence',
      label: 'Influence / Reach',
      placeholder: 'How much power do they have?',
      type: 'textarea',
      metadataKey: true,
    },
  ],
  // ── Structural / ontology kinds ─────────────────────────────────
  timeline: [
    {
      key: 'era',
      label: 'Era / Age',
      placeholder: 'e.g. The First Age, Year Zero, Post-Collapse',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'scope',
      label: 'Scope',
      placeholder: 'What does this timeline cover?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'branchingPoint',
      label: 'Branching Point',
      placeholder: 'What divergence created this timeline?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'keyEvents',
      label: 'Key Events',
      placeholder: 'Major milestones in this timeline...',
      type: 'textarea',
      metadataKey: true,
    },
  ],
  reality: [
    {
      key: 'designation',
      label: 'Designation',
      placeholder: 'e.g. Earth-616, Prime Reality, Mirror World',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'divergence',
      label: 'Point of Divergence',
      placeholder: 'What makes this reality different?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'physicalLaws',
      label: 'Physical Laws',
      placeholder: 'How do the rules differ from baseline?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'accessibility',
      label: 'Accessibility',
      placeholder: 'How can this reality be reached?',
      type: 'input',
      metadataKey: true,
    },
  ],
  dimension: [
    {
      key: 'dimensionType',
      label: 'Type',
      placeholder: 'e.g. Pocket Dimension, Astral Layer, Fold Space',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'properties',
      label: 'Properties',
      placeholder: 'What are the defining characteristics?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'inhabitants',
      label: 'Inhabitants',
      placeholder: 'What lives here?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'entryPoints',
      label: 'Entry Points',
      placeholder: 'How do you get in and out?',
      type: 'textarea',
      metadataKey: true,
    },
  ],
  plane: [
    {
      key: 'planeType',
      label: 'Type',
      placeholder: 'e.g. Elemental, Spirit, Shadow, Ethereal',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'environment',
      label: 'Environment',
      placeholder: 'What does it look and feel like?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'rulers',
      label: 'Rulers / Powers',
      placeholder: 'Who or what governs this plane?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'effects',
      label: 'Effects on Visitors',
      placeholder: 'What happens to mortals who enter?',
      type: 'textarea',
      metadataKey: true,
    },
  ],
  realm: [
    {
      key: 'realmType',
      label: 'Type',
      placeholder: 'e.g. Kingdom, Empire, City-State, Wild Territory',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'ruler',
      label: 'Ruler',
      placeholder: 'Who rules this realm?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'geography',
      label: 'Geography',
      placeholder: 'Terrain, climate, key landmarks...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'culture',
      label: 'Culture',
      placeholder: 'Customs, laws, way of life...',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'resources',
      label: 'Resources',
      placeholder: 'What does this realm produce or control?',
      type: 'textarea',
      metadataKey: true,
    },
  ],
  domain: [
    {
      key: 'domainType',
      label: 'Type',
      placeholder: 'e.g. District, Estate, Province, Stronghold',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'controller',
      label: 'Controller',
      placeholder: 'Who controls this domain?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'purpose',
      label: 'Purpose',
      placeholder: 'What is this domain used for?',
      type: 'textarea',
      metadataKey: true,
    },
    {
      key: 'boundaries',
      label: 'Boundaries',
      placeholder: 'What defines its borders?',
      type: 'input',
      metadataKey: true,
    },
    {
      key: 'notableFeatures',
      label: 'Notable Features',
      placeholder: 'Landmarks, defenses, secrets...',
      type: 'textarea',
      metadataKey: true,
    },
  ],
};

const KIND_LABELS: Record<EntityKind, string> = {
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

function EntityCreateForm() {
  const { kind } = Route.useParams() as { kind: string };
  const { universe: universeAddress } = useSearch({ from: '/create/$kind' });
  const navigate = useNavigate();
  const { address } = useAccount();
  const { isAuthenticated, isAuthenticating } = useWalletAuth();

  useEffect(() => {
    if (!isAuthenticated && !isAuthenticating) {
      navigate({ to: '/login', search: { redirect: `/create/${kind}` } });
    }
  }, [isAuthenticated, isAuthenticating, navigate, kind]);

  // Fetch universe info when scoped to a universe
  const { data: universeResult } = useQuery({
    queryKey: ['universe', universeAddress],
    queryFn: () => trpcClient.universes.get.query({ id: universeAddress! }),
    enabled: !!universeAddress,
  });
  const universeInfo = universeResult?.data as
    | { id: string; name?: string; image_url?: string }
    | undefined;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [monetized, setMonetized] = useState(false);
  const [rightsDeclaration, setRightsDeclaration] = useState<'original' | 'licensed' | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [artworkPrompt, setArtworkPrompt] = useState('');
  const [artworkModel, setArtworkModel] = useState<string>(''); // '' = auto
  const [showArtwork, setShowArtwork] = useState(false);
  const [musicPrompt, setMusicPrompt] = useState('');
  const [showMusic, setShowMusic] = useState(false);
  const [generatingMusic, setGeneratingMusic] = useState(false);
  const [generatingArt, setGeneratingArt] = useState(false);
  const [unstoppableDomain, setUnstoppableDomain] = useState('');
  const [styleControls, setStyleControls] = useState<StyleControlsValue>(
    DEFAULT_STYLE_CONTROLS_VALUE
  );

  // ── Character generation (person kind) ──────────────────────────────
  type CharacterGen = {
    id: string;
    type: '2d' | '3d';
    label: string;
    status: 'generating' | 'completed' | 'failed';
    prompt: string;
    imageUrl?: string;
    modelUrl?: string;
    generationId?: string;
    error?: string;
    isMain?: boolean;
  };
  const [characterPrompt, setCharacterPrompt] = useState('');
  const [characterMode, setCharacterMode] = useState<'2d' | '3d'>('2d');
  const [character3dStyle, setCharacter3dStyle] = useState<
    'realistic' | 'cartoon' | 'low-poly' | 'sculpture' | 'pbr'
  >('realistic');
  const [character2dModel, setCharacter2dModel] = useState<string>('');
  const [variantLabel, setVariantLabel] = useState('');
  const [generatingCharacter, setGeneratingCharacter] = useState(false);
  const [characterGens, setCharacterGens] = useState<CharacterGen[]>([]);

  const isPerson = kind === 'person';
  const anyGenInFlight = characterGens.some((g) => g.status === 'generating');

  // Poll any in-flight 3D jobs every 5s until terminal.
  useEffect(() => {
    const pending = characterGens.filter(
      (g) => g.type === '3d' && g.status === 'generating' && g.generationId
    );
    if (pending.length === 0) return;

    const interval = setInterval(async () => {
      for (const gen of pending) {
        try {
          const task: any = await trpcClient.threed.getTask.query({
            generationId: gen.generationId!,
          });
          if (!task) continue;
          const status = task.status as string | undefined;
          if (status === 'completed') {
            const modelUrl: string | undefined =
              task.modelUrls?.glb ||
              task.modelUrls?.fbx ||
              task.modelUrls?.obj ||
              task.modelUrls?.usdz;
            const thumb: string | undefined = task.thumbnailUrl || task.videoUrl;
            setCharacterGens((prev) =>
              prev.map((g) =>
                g.id === gen.id
                  ? {
                      ...g,
                      status: 'completed',
                      modelUrl: modelUrl ?? g.modelUrl,
                      imageUrl: thumb ?? g.imageUrl,
                    }
                  : g
              )
            );
          } else if (status === 'failed') {
            setCharacterGens((prev) =>
              prev.map((g) =>
                g.id === gen.id
                  ? { ...g, status: 'failed', error: task.failureReason || '3D generation failed' }
                  : g
              )
            );
          }
        } catch (err) {
          // Transient error — keep polling
          // eslint-disable-next-line no-console
          console.warn('3D poll error', err);
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [characterGens]);

  const buildCharacterPrompt = (extra?: string) => {
    const parts: string[] = [];
    if (characterPrompt.trim()) parts.push(characterPrompt.trim());
    if (extra?.trim()) parts.push(extra.trim());
    if (parts.length === 0) {
      // Auto-fill from name + description if nothing typed
      const auto = `Character portrait of ${name || 'a person'}${
        description ? `, ${description}` : ''
      }${fieldValues.appearance ? `, ${fieldValues.appearance}` : ''}${
        fieldValues.role ? `, ${fieldValues.role}` : ''
      }, cinematic lighting, detailed`;
      parts.push(auto.replace(/,\s*,/g, ',').replace(/,\s*$/, ''));
    }
    return parts.join(', ');
  };

  const handleGenerateCharacter = async (opts: { variant?: string } = {}) => {
    const finalPrompt = buildCharacterPrompt(opts.variant);
    if (!finalPrompt.trim()) {
      toast.error('Add a name or describe the character first');
      return;
    }
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isFirst = characterGens.length === 0;
    const label =
      opts.variant?.trim() || (isFirst ? 'Main' : `Variant ${characterGens.length + 1}`);
    const stub: CharacterGen = {
      id: localId,
      type: characterMode,
      label,
      status: 'generating',
      prompt: finalPrompt,
      isMain: isFirst,
    };
    setCharacterGens((prev) => [...prev, stub]);
    setGeneratingCharacter(true);
    try {
      if (characterMode === '2d') {
        const result = await trpcClient.image.generate.mutate({
          prompt: finalPrompt,
          task: 'text_to_image',
          imageSize: 'square_hd',
          numImages: 1,
          routingMode: character2dModel ? 'manual' : 'auto',
          ...(character2dModel ? { selectedModelId: character2dModel } : {}),
          universeId: universeAddress || undefined,
          stylePackEntityId: styleControls.stylePackEntityId ?? undefined,
          moodboardEntityId: styleControls.moodboardEntityId ?? undefined,
          styleStrength: styleControls.styleStrength,
          retexture: styleControls.retexture,
          respectCanonStyle: styleControls.respectCanonStyle,
        });
        if (result.status === 'completed' && result.imageUrls?.[0]) {
          const newUrl = result.imageUrls[0];
          setCharacterGens((prev) =>
            prev.map((g) =>
              g.id === localId ? { ...g, status: 'completed', imageUrl: newUrl } : g
            )
          );
          if (isFirst) setImageUrl(newUrl);
          toast.success('Character generated!');
        } else {
          throw new Error('Image generation did not complete');
        }
      } else {
        const result: any = await trpcClient.threed.textTo3DPreview.mutate({
          prompt: finalPrompt,
          artStyle: character3dStyle,
        });
        const generationId: string | undefined = result?.generationId;
        if (!generationId) throw new Error('3D job did not return a generation ID');
        setCharacterGens((prev) =>
          prev.map((g) => (g.id === localId ? { ...g, generationId } : g))
        );
        toast.success('3D job queued — Meshy will work on it for ~5 min.');
      }
    } catch (err: any) {
      const msg = err?.message ?? 'Generation failed';
      setCharacterGens((prev) =>
        prev.map((g) => (g.id === localId ? { ...g, status: 'failed', error: msg } : g))
      );
      toast.error(msg);
    } finally {
      setGeneratingCharacter(false);
      setVariantLabel('');
    }
  };

  const setMainCharacter = (id: string) => {
    setCharacterGens((prev) => {
      const next = prev.map((g) => ({ ...g, isMain: g.id === id }));
      const main = next.find((g) => g.id === id);
      if (main?.imageUrl) setImageUrl(main.imageUrl);
      return next;
    });
  };

  const removeCharacter = (id: string) => {
    setCharacterGens((prev) => {
      const next = prev.filter((g) => g.id !== id);
      // If we removed the main, promote the first remaining (if any).
      if (!next.some((g) => g.isMain) && next.length > 0) {
        next[0].isMain = true;
        if (next[0].imageUrl) setImageUrl(next[0].imageUrl);
      }
      if (next.length === 0) setImageUrl('');
      return next;
    });
  };

  const handleGenerateAI = async () => {
    if (!name.trim()) {
      toast.error('Enter a name first so AI knows what to generate');
      return;
    }
    setGenerating(true);
    try {
      const profile = await trpcClient.entities.generateProfile.mutate({
        name: name.trim(),
        kind: kind as EntityKind,
        hint: description || '',
      });
      setDescription(profile.description);
      const newFields: Record<string, string> = {};
      for (const [key, value] of Object.entries(profile.metadata)) {
        if (typeof value === 'string' && value) {
          newFields[key] = value;
        }
      }
      setFieldValues((prev) => ({ ...prev, ...newFields }));
      toast.success('AI profile generated! Review and edit before saving.');
    } catch (err: any) {
      toast.error(err.message ?? 'AI generation failed');
    } finally {
      setGenerating(false);
    }
  };

  if (isAuthenticating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!VALID_KINDS.includes(kind as EntityKind)) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <Link to="/create">
          <Button variant="outline" className="mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Create
          </Button>
        </Link>
        <p className="text-muted-foreground">Unknown entity type: {kind}</p>
      </div>
    );
  }

  const typedKind = kind as EntityKind;
  const label = KIND_LABELS[typedKind];
  const fields = FIELDS_BY_KIND[typedKind];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) {
      toast.error('Connect your wallet to create entities');
      return;
    }

    setSaving(true);
    try {
      const metadata: Record<string, unknown> = {};
      for (const field of fields) {
        if (field.metadataKey && fieldValues[field.key]) {
          metadata[field.key] = fieldValues[field.key];
        }
      }

      // Visual-language kinds store structured metadata rather than raw strings.
      // Convert newline-separated URL lists to StyleReferenceImage[] and
      // comma-separated keywords to string[].
      if (typedKind === 'moodboard' || typedKind === 'style_pack') {
        if (typeof metadata.referenceImages === 'string') {
          metadata.referenceImages = (metadata.referenceImages as string)
            .split(/\r?\n/)
            .map((url) => url.trim())
            .filter((url) => url.length > 0)
            .map((url) => ({ url }));
        }
        if (typedKind === 'moodboard' && typeof metadata.tags === 'string') {
          metadata.tags = (metadata.tags as string)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        }
        if (typedKind === 'style_pack' && typeof metadata.styleKeywords === 'string') {
          metadata.styleKeywords = (metadata.styleKeywords as string)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        }
        if (typedKind === 'style_pack' && typeof metadata.defaultStrength === 'string') {
          const parsed = Number(metadata.defaultStrength);
          metadata.defaultStrength =
            Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.7;
        }
      }

      if (monetized && !rightsDeclaration) {
        toast.error('Select a rights declaration for monetized entities');
        setSaving(false);
        return;
      }

      // Persist character variants on the entity for the person kind.
      let mainImageUrl = imageUrl || null;
      if (typedKind === 'person' && characterGens.length > 0) {
        const completed = characterGens.filter((g) => g.status === 'completed');
        if (completed.length > 0) {
          const main = completed.find((g) => g.isMain) ?? completed[0];
          metadata.characterVariants = completed.map((g) => ({
            type: g.type,
            label: g.label,
            imageUrl: g.imageUrl ?? null,
            modelUrl: g.modelUrl ?? null,
            prompt: g.prompt,
            generationId: g.generationId ?? null,
            isMain: g.id === main.id,
          }));
          if (main.modelUrl) metadata.modelUrl = main.modelUrl;
          if (!mainImageUrl && main.imageUrl) mainImageUrl = main.imageUrl;
        }
      }

      const result = await trpcClient.entities.create.mutate({
        name,
        description,
        kind: typedKind,
        imageUrl: mainImageUrl,
        metadata,
        monetized,
        rightsDeclaration: monetized ? rightsDeclaration : null,
        unstoppableDomain: unstoppableDomain.trim() || null,
        universeAddress: universeAddress || null,
      });

      toast.success(`${label} created!`);

      // If artwork prompt was provided, generate artwork and update entity
      if (artworkPrompt.trim()) {
        setGeneratingArt(true);
        try {
          const artResult = await trpcClient.image.generate.mutate({
            prompt: artworkPrompt.trim(),
            task: 'text_to_image',
            imageSize: 'square_hd',
            numImages: 1,
            routingMode: artworkModel ? 'manual' : 'auto',
            ...(artworkModel ? { selectedModelId: artworkModel } : {}),
            entityId: result.id,
            universeId: universeAddress || undefined,
            stylePackEntityId: styleControls.stylePackEntityId ?? undefined,
            moodboardEntityId: styleControls.moodboardEntityId ?? undefined,
            styleStrength: styleControls.styleStrength,
            retexture: styleControls.retexture,
            respectCanonStyle: styleControls.respectCanonStyle,
          });
          if (artResult.status === 'completed' && artResult.imageUrls?.[0]) {
            await trpcClient.entities.update.mutate({
              entityId: result.id,
              imageUrl: artResult.imageUrls[0],
            });
            toast.success('Artwork generated!');
          }
        } catch (artErr: any) {
          toast.error(`Entity created but artwork failed: ${artErr.message ?? 'Unknown error'}`);
        } finally {
          setGeneratingArt(false);
        }
      }

      // If music prompt was provided, generate theme music and auto-attach
      if (musicPrompt.trim()) {
        setGeneratingMusic(true);
        try {
          await trpcClient.audio.generate.mutate({
            prompt: musicPrompt.trim(),
            mode: 'text_to_music',
            durationSec: 15,
            routingMode: 'auto',
            entityId: result.id,
          });
          toast.success('Theme music generated!');
        } catch (musicErr: any) {
          toast.error(`Entity created but music failed: ${musicErr.message ?? 'Unknown error'}`);
        } finally {
          setGeneratingMusic(false);
        }
      }

      navigate({ to: '/wiki/entity/$id', params: { id: result.id } });
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to create entity');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-10 max-w-2xl">
      <Link to="/create" search={universeAddress ? { universe: universeAddress } : {}}>
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Create
        </Button>
      </Link>

      {universeInfo && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-purple-500/10 p-4">
          {universeInfo.image_url && (
            <img
              src={resolveIpfsUrl(universeInfo.image_url)}
              alt=""
              className="h-10 w-10 rounded-lg object-cover flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Creating in
            </p>
            <p className="text-sm font-bold truncate">{universeInfo.name}</p>
          </div>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">New {label}</h1>
        <p className="text-muted-foreground mt-1">
          Add a new {label.toLowerCase()} to{' '}
          {universeInfo ? universeInfo.name : 'your worldbuilding canon'}.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Character generation (person only) — sits at the top so creators
            can riff on visuals before committing to details. */}
        {isPerson && (
          <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-purple-500/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                Character Generation
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Don't know what you want yet? Generate a 2D portrait or a 3D Meshy model for
                inspiration, then add outfits or alternate versions to the same character.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCharacterMode('2d')}
                  className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-colors ${
                    characterMode === '2d'
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-muted-foreground/30'
                  }`}
                >
                  <ImageIcon className="w-4 h-4" />
                  2D Portrait
                </button>
                <button
                  type="button"
                  onClick={() => setCharacterMode('3d')}
                  className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-colors ${
                    characterMode === '3d'
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-muted-foreground/30'
                  }`}
                >
                  <Box className="w-4 h-4" />
                  3D Model (Meshy)
                </button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="characterPrompt">Prompt</Label>
                <Textarea
                  id="characterPrompt"
                  value={characterPrompt}
                  onChange={(e) => setCharacterPrompt(e.target.value)}
                  placeholder={
                    characterMode === '2d'
                      ? 'e.g. weathered space-pirate captain, scarred face, leather coat, cinematic lighting'
                      : 'e.g. anime hero, full-body, blue hair, futuristic armor'
                  }
                  rows={3}
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave blank to auto-fill from name + description.
                </p>
              </div>

              {characterMode === '2d' ? (
                <>
                  <ModelSelector
                    type="image"
                    value={character2dModel}
                    onChange={setCharacter2dModel}
                    label="Image model"
                    task="text_to_image"
                  />
                  <StyleControls
                    value={styleControls}
                    onChange={setStyleControls}
                    universeAddress={universeAddress || null}
                    creatorAddress={address ?? null}
                    hasSourceImage={false}
                  />
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="character3dStyle">Art style</Label>
                  <select
                    id="character3dStyle"
                    value={character3dStyle}
                    onChange={(e) => setCharacter3dStyle(e.target.value as typeof character3dStyle)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="realistic">Realistic</option>
                    <option value="cartoon">Cartoon</option>
                    <option value="low-poly">Low Poly</option>
                    <option value="sculpture">Sculpture</option>
                    <option value="pbr">PBR</option>
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Meshy preview takes ~5 minutes. You can keep filling out the form while it runs.
                  </p>
                </div>
              )}

              {characterGens.length === 0 ? (
                <Button
                  type="button"
                  onClick={() => handleGenerateCharacter()}
                  disabled={generatingCharacter}
                  className="w-full"
                >
                  {generatingCharacter ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  {generatingCharacter
                    ? 'Starting...'
                    : `Generate ${characterMode.toUpperCase()} Character`}
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-sm">Generated</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {characterGens.map((g) => (
                        <div
                          key={g.id}
                          className={`relative rounded-lg border-2 overflow-hidden bg-muted/30 ${
                            g.isMain ? 'border-primary' : 'border-muted'
                          }`}
                        >
                          <div className="aspect-square w-full flex items-center justify-center bg-muted/50">
                            {g.status === 'generating' ? (
                              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                <Loader2 className="w-6 h-6 animate-spin" />
                                <span className="text-[10px]">
                                  {g.type === '3d' ? 'Meshy working...' : 'Generating...'}
                                </span>
                              </div>
                            ) : g.status === 'failed' ? (
                              <div className="text-center px-2">
                                <X className="w-6 h-6 mx-auto text-destructive" />
                                <p className="text-[10px] text-destructive mt-1 truncate">
                                  {g.error}
                                </p>
                              </div>
                            ) : g.imageUrl ? (
                              <img
                                src={resolveIpfsUrl(g.imageUrl)}
                                alt={g.label}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Box className="w-8 h-8 text-muted-foreground" />
                            )}
                          </div>
                          <div className="absolute top-1 right-1 flex gap-1">
                            {g.status === 'completed' && !g.isMain && (
                              <button
                                type="button"
                                onClick={() => setMainCharacter(g.id)}
                                className="rounded bg-background/80 backdrop-blur p-1 hover:bg-background"
                                title="Set as main"
                              >
                                <Star className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeCharacter(g.id)}
                              className="rounded bg-background/80 backdrop-blur p-1 hover:bg-destructive hover:text-destructive-foreground"
                              title="Remove"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 flex items-center justify-between">
                            <span className="text-[11px] text-white font-medium truncate flex items-center gap-1">
                              {g.isMain && <Star className="w-3 h-3 fill-current" />}
                              {g.label}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider text-white/70">
                              {g.type}
                            </span>
                          </div>
                          {g.modelUrl && (
                            <a
                              href={g.modelUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute top-1 left-1 rounded bg-violet-500/90 text-white text-[9px] px-1.5 py-0.5 font-medium"
                            >
                              GLB
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 rounded-lg border border-dashed p-3">
                    <Label htmlFor="variantLabel" className="text-xs">
                      Add variant or outfit
                    </Label>
                    <Input
                      id="variantLabel"
                      value={variantLabel}
                      onChange={(e) => setVariantLabel(e.target.value)}
                      placeholder='e.g. "Battle armor", "Casual", "Side view"'
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerateCharacter({ variant: variantLabel })}
                      disabled={generatingCharacter}
                      className="w-full"
                    >
                      {generatingCharacter ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" />
                      )}
                      Generate variant
                    </Button>
                    <p className="text-[10px] text-muted-foreground">
                      Variants reuse the prompt above; the label gets appended for steering.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Core fields */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Core</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGenerateAI}
              disabled={generating || !name.trim()}
            >
              {generating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              {generating ? 'Generating...' : 'Generate with AI'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Name of this ${label.toLowerCase()}...`}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Summary</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`A short summary of this ${label.toLowerCase()}...`}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="imageUrl">Image URL</Label>
              <Input
                id="imageUrl"
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Kind-specific fields */}
        {fields.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  {field.type === 'textarea' ? (
                    <Textarea
                      id={field.key}
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      rows={3}
                    />
                  ) : (
                    <Input
                      id={field.key}
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Monetization */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monetization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Will you sell, license, or commercially use this {label.toLowerCase()}? Choose now —
              you can change this later.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setMonetized(false);
                  setRightsDeclaration(null);
                }}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-center transition-colors ${
                  !monetized
                    ? 'border-primary bg-primary/5'
                    : 'border-muted hover:border-muted-foreground/30'
                }`}
              >
                <Palette className="w-5 h-5" />
                <span className="font-medium text-sm">Non-Monetized</span>
                <span className="text-xs text-muted-foreground">
                  Personal use, fan art, exploration. Cannot be minted as NFT.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMonetized(true)}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-center transition-colors ${
                  monetized
                    ? 'border-primary bg-primary/5'
                    : 'border-muted hover:border-muted-foreground/30'
                }`}
              >
                <ShieldCheck className="w-5 h-5" />
                <span className="font-medium text-sm">Monetized</span>
                <span className="text-xs text-muted-foreground">
                  Sell, license, or mint as NFT. Requires rights declaration.
                </span>
              </button>
            </div>

            {monetized && (
              <div className="space-y-3 pt-2">
                <Label>Rights Declaration *</Label>
                <div className="space-y-2">
                  <label
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      rightsDeclaration === 'original'
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-muted-foreground/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="rights"
                      checked={rightsDeclaration === 'original'}
                      onChange={() => setRightsDeclaration('original')}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="font-medium text-sm">Original Work</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        I created this — it does not copy or derive from existing copyrighted IP.
                      </p>
                    </div>
                  </label>
                  <label
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      rightsDeclaration === 'licensed'
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-muted-foreground/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="rights"
                      checked={rightsDeclaration === 'licensed'}
                      onChange={() => setRightsDeclaration('licensed')}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="font-medium text-sm">Licensed</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        I have a license or permission from the rights holder to use this
                        commercially.
                      </p>
                    </div>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  False declarations may result in takedown and loss of minting privileges.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unstoppable Domain (optional) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unstoppable Domain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Optionally attach an Unstoppable Domains name to this {label.toLowerCase()} (e.g.
              mycharacter.crypto, myplace.x).
            </p>
            <Input
              placeholder="e.g. mycharacter.crypto"
              value={unstoppableDomain}
              onChange={(e) => setUnstoppableDomain(e.target.value)}
              maxLength={100}
            />
            <p className="text-[10px] text-muted-foreground">
              Supports .crypto, .nft, .x, .wallet, .bitcoin, .dao, .888 and more. This is optional —
              you can add or change it later.
            </p>
          </CardContent>
        </Card>

        {/* Optional AI Artwork — hidden for person kind, which has its own
            Character Generation block at the top. */}
        {!isPerson && (
          <Card>
            <CardHeader>
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setShowArtwork(!showArtwork)}
              >
                <div className="flex items-center gap-2">
                  <ImagePlus className="w-4 h-4" />
                  <CardTitle className="text-base">AI Artwork (Optional)</CardTitle>
                </div>
                {showArtwork ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            </CardHeader>
            {showArtwork && (
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Describe the artwork you want generated for this {label.toLowerCase()}. Leave
                  empty to skip. You can always generate artwork later.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="artworkPrompt">Artwork Prompt</Label>
                  <Textarea
                    id="artworkPrompt"
                    value={artworkPrompt}
                    onChange={(e) => setArtworkPrompt(e.target.value)}
                    placeholder={`e.g. A cinematic portrait of ${name || `this ${label.toLowerCase()}`}, dramatic lighting, detailed digital art...`}
                    rows={3}
                  />
                </div>
                <ModelSelector
                  type="image"
                  value={artworkModel}
                  onChange={setArtworkModel}
                  label="Image model"
                  task="text_to_image"
                />
                <StyleControls
                  value={styleControls}
                  onChange={setStyleControls}
                  universeAddress={universeAddress || null}
                  creatorAddress={address ?? null}
                  hasSourceImage={false}
                />
                {name.trim() && !artworkPrompt.trim() && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const autoPrompt =
                        typedKind === 'person'
                          ? `Character portrait of ${name}, ${description || fieldValues.appearance || fieldValues.role || ''}, cinematic lighting, high quality digital art, detailed`
                          : typedKind === 'place'
                            ? `Landscape painting of ${name}, ${description || fieldValues.atmosphere || ''}, cinematic, detailed environment concept art`
                            : typedKind === 'thing'
                              ? `Detailed illustration of ${name}, ${description || fieldValues.powersAndUse || ''}, fantasy artifact, dramatic lighting`
                              : `Concept art of ${name}, ${description || ''}, high quality digital art, cinematic`;
                      setArtworkPrompt(autoPrompt.replace(/,\s*,/g, ',').replace(/,\s*$/, ''));
                    }}
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Auto-fill prompt from details
                  </Button>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* Optional AI Theme Music */}
        <Card>
          <CardHeader>
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setShowMusic(!showMusic)}
            >
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4" />
                <CardTitle className="text-base">AI Theme Music (Optional)</CardTitle>
              </div>
              {showMusic ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </CardHeader>
          {showMusic && (
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Describe the theme music for this {label.toLowerCase()}. A 15-second track will be
                generated and auto-attached. Leave empty to skip.
              </p>
              <div className="space-y-2">
                <Label htmlFor="musicPrompt">Music Prompt</Label>
                <Textarea
                  id="musicPrompt"
                  value={musicPrompt}
                  onChange={(e) => setMusicPrompt(e.target.value)}
                  placeholder={`e.g. Epic orchestral theme for ${name || `this ${label.toLowerCase()}`}, cinematic and dramatic...`}
                  rows={3}
                />
              </div>
              {name.trim() && !musicPrompt.trim() && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const autoPrompt =
                      typedKind === 'person'
                        ? `Character theme music for ${name}, ${fieldValues.role || ''} archetype, cinematic orchestral`
                        : typedKind === 'place'
                          ? `Ambient soundscape for ${name}, ${fieldValues.atmosphere || ''}, environmental audio`
                          : typedKind === 'faction'
                            ? `Faction anthem for ${name}, ${fieldValues.ideology || ''}, powerful and commanding`
                            : typedKind === 'event'
                              ? `Dramatic score for ${name}, ${fieldValues.era || ''}, tension and resolution`
                              : `Theme music for ${name}, cinematic orchestral, ${description || ''}`;
                    setMusicPrompt(autoPrompt.replace(/,\s*,/g, ',').replace(/,\s*$/, ''));
                  }}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Auto-fill prompt from details
                </Button>
              )}
            </CardContent>
          )}
        </Card>

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={
              saving ||
              generatingArt ||
              generatingMusic ||
              anyGenInFlight ||
              !name.trim() ||
              (monetized && !rightsDeclaration)
            }
          >
            {(saving || generatingArt || generatingMusic) && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            {generatingMusic
              ? 'Generating Music...'
              : generatingArt
                ? 'Generating Artwork...'
                : saving
                  ? 'Creating...'
                  : anyGenInFlight
                    ? 'Waiting on character...'
                    : `Create ${label}`}
          </Button>
          <Link to="/create">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
        {anyGenInFlight && (
          <p className="text-xs text-muted-foreground -mt-2">
            One or more character generations are still running. Wait or remove the in-flight ones
            to submit.
          </p>
        )}
      </form>
    </div>
  );
}

const createSearchSchema = z.object({
  universe: z.string().optional(),
});

export const Route = createFileRoute('/create/$kind')({
  beforeLoad: ({ context, params }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: `/create/${params.kind}` } });
    }
  },
  component: EntityCreateForm,
  validateSearch: createSearchSchema,
});
