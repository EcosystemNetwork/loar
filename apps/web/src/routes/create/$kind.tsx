/**
 * Dynamic entity creation form.
 *
 * Route: /create/:kind
 *
 * Renders a tailored form for each entity kind (person, place, thing, faction,
 * event, lore, species, vehicle, technology, organization). Unknown kinds
 * redirect back to the create hub.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Loader2 } from 'lucide-react';

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
  | 'organization';

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
};

function EntityCreateForm() {
  const { kind } = Route.useParams() as { kind: string };
  const navigate = useNavigate();
  const { address } = useAccount();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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

      const result = await trpcClient.entities.create.mutate({
        name,
        description,
        kind: typedKind,
        imageUrl: imageUrl || null,
        metadata,
      });

      toast.success(`${label} created!`);
      navigate({ to: '/wiki/entity/$id', params: { id: result.id } });
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to create entity');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-10 max-w-2xl">
      <Link to="/create">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Create
        </Button>
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">New {label}</h1>
        <p className="text-muted-foreground mt-1">
          Add a new {label.toLowerCase()} to your worldbuilding canon.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core fields */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Core</CardTitle>
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

        <div className="flex gap-3">
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {saving ? 'Creating...' : `Create ${label}`}
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

export const Route = createFileRoute('/create/$kind')({
  component: EntityCreateForm,
});
