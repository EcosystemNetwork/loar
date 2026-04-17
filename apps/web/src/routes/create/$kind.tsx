/**
 * Dynamic entity creation form.
 *
 * Route: /create/:kind
 *
 * Renders a tailored form for each entity kind (person, place, thing, faction,
 * event, lore, species, vehicle, technology, organization). Unknown kinds
 * redirect back to the create hub.
 */
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
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
} from 'lucide-react';

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
  const [showArtwork, setShowArtwork] = useState(false);
  const [musicPrompt, setMusicPrompt] = useState('');
  const [showMusic, setShowMusic] = useState(false);
  const [generatingMusic, setGeneratingMusic] = useState(false);
  const [generatingArt, setGeneratingArt] = useState(false);
  const [unstoppableDomain, setUnstoppableDomain] = useState('');

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

      if (monetized && !rightsDeclaration) {
        toast.error('Select a rights declaration for monetized entities');
        setSaving(false);
        return;
      }

      const result = await trpcClient.entities.create.mutate({
        name,
        description,
        kind: typedKind,
        imageUrl: imageUrl || null,
        metadata: metadata as Record<string, string | number | boolean | null>,
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
            routingMode: 'auto',
            entityId: result.id,
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
              src={universeInfo.image_url}
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

        {/* Optional AI Artwork */}
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
                Describe the artwork you want generated for this {label.toLowerCase()}. Leave empty
                to skip. You can always generate artwork later.
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
                  : `Create ${label}`}
          </Button>
          <Link to="/create">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}

const createSearchSchema = z.object({
  universe: z.string().optional(),
});

export const Route = createFileRoute('/create/$kind')({
  component: EntityCreateForm,
  validateSearch: createSearchSchema,
});
