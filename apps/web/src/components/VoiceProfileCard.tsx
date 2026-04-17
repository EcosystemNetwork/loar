/**
 * VoiceProfileCard — Design and preview character voice profiles.
 *
 * Shows on entity detail pages for character-like entities (person, species, etc.).
 * Lets the owner design a voice via ElevenLabs and play back the preview.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AudioPlayer } from '@/components/AudioPlayer';
import { Mic, Loader2, Volume2, Sparkles, ChevronDown, ChevronUp, X } from 'lucide-react';

interface VoiceProfileCardProps {
  entityId: string;
  entityName: string;
  entityKind: string;
  entityDescription: string;
  universeId: string | null;
  isOwner: boolean;
}

/** Gender options with labels */
const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'neutral', label: 'Neutral' },
] as const;

/** Age options */
const AGES = [
  { value: 'young', label: 'Young' },
  { value: 'middle_aged', label: 'Middle-aged' },
  { value: 'old', label: 'Old' },
] as const;

/** Accent presets */
const ACCENTS = [
  'american',
  'british',
  'australian',
  'indian',
  'african',
  'irish',
  'italian',
  'french',
  'german',
  'spanish',
  'japanese',
  'korean',
  'arabic',
  'swedish',
  'russian',
] as const;

/** Auto-infer voice defaults from entity metadata */
function inferVoiceDefaults(kind: string, description: string, metadata?: Record<string, unknown>) {
  const desc = description.toLowerCase();
  const defaults = {
    gender: 'neutral' as 'male' | 'female' | 'neutral',
    age: 'young' as 'young' | 'middle_aged' | 'old',
    accent: 'american',
    accentStrength: 1.0,
    stability: 0.5,
    style: 0.3,
  };

  // Infer gender
  if (
    desc.includes('female') ||
    desc.includes(' she ') ||
    desc.includes(' her ') ||
    desc.includes('woman') ||
    desc.includes('girl')
  ) {
    defaults.gender = 'female';
  } else if (
    desc.includes('male') ||
    desc.includes(' he ') ||
    desc.includes(' his ') ||
    desc.includes('man') ||
    desc.includes(' boy') ||
    desc.includes('guy')
  ) {
    defaults.gender = 'male';
  }

  // Infer age
  if (
    desc.includes('young') ||
    desc.includes('teen') ||
    desc.includes('child') ||
    desc.includes('kid') ||
    desc.includes('24') ||
    desc.includes('25') ||
    desc.includes('26')
  ) {
    defaults.age = 'young';
  } else if (
    desc.includes('elder') ||
    desc.includes('ancient') ||
    desc.includes('old') ||
    desc.includes('veteran') ||
    desc.includes('legendary')
  ) {
    defaults.age = 'old';
  } else if (desc.includes('40') || desc.includes('mature') || desc.includes('experienced')) {
    defaults.age = 'middle_aged';
  }

  // Infer accent from description hints
  if (desc.includes('british') || desc.includes('london') || desc.includes('oxford')) {
    defaults.accent = 'british';
    defaults.accentStrength = 0.8;
  } else if (desc.includes('japanese') || desc.includes('tokyo')) {
    defaults.accent = 'japanese';
  } else if (desc.includes('french') || desc.includes('paris')) {
    defaults.accent = 'french';
  }

  return defaults;
}

export function VoiceProfileCard({
  entityId,
  entityName,
  entityKind,
  entityDescription,
  universeId,
  isOwner,
}: VoiceProfileCardProps) {
  const queryClient = useQueryClient();
  const [showDesigner, setShowDesigner] = useState(false);

  // Form state
  const inferred = inferVoiceDefaults(entityKind, entityDescription);
  const [gender, setGender] = useState<'male' | 'female' | 'neutral'>(inferred.gender);
  const [age, setAge] = useState<'young' | 'middle_aged' | 'old'>(inferred.age);
  const [accent, setAccent] = useState(inferred.accent);
  const [accentStrength, setAccentStrength] = useState(inferred.accentStrength);
  const [description, setDescription] = useState('');
  const [previewText, setPreviewText] = useState('');

  // Fetch existing voice profiles for this universe
  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['voice-profiles', universeId],
    queryFn: () =>
      universeId
        ? trpcClient.sceneAudio.getVoiceProfiles.query({ universeId })
        : Promise.resolve([]),
    enabled: !!universeId,
  });

  // Find profiles matching this entity
  const entityProfiles = (profiles as any[]).filter(
    (p: any) =>
      p.characterName?.toLowerCase() === entityName.toLowerCase() || p.castMemberId === entityId
  );

  // Design voice mutation
  const designVoice = useMutation({
    mutationFn: (input: {
      universeId: string;
      characterName: string;
      description: string;
      gender: 'male' | 'female' | 'neutral';
      age: 'young' | 'middle_aged' | 'old';
      accent: string;
      accentStrength: number;
      previewText: string;
      stability: number;
      style: number;
      castMemberId?: string;
    }) => trpcClient.sceneAudio.designVoice.mutate(input),
    onSuccess: (data: any) => {
      toast.success(`Voice designed! ${data.credits} credits used.`);
      queryClient.invalidateQueries({ queryKey: ['voice-profiles', universeId] });
      setShowDesigner(false);
    },
    onError: (err: any) => {
      toast.error(err.message ?? 'Voice design failed');
    },
  });

  // Delete voice profile
  const deleteVoice = useMutation({
    mutationFn: (profileId: string) =>
      trpcClient.sceneAudio.deleteVoiceProfile.mutate({ profileId }),
    onSuccess: () => {
      toast.success('Voice profile deleted');
      queryClient.invalidateQueries({ queryKey: ['voice-profiles', universeId] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Delete failed'),
  });

  // Preview voice with custom text
  const previewVoice = useMutation({
    mutationFn: (input: { profileId: string; text: string }) =>
      trpcClient.sceneAudio.previewVoice.mutate(input),
    onSuccess: (data: any) => {
      setPreviewAudioUrl(data.audioUrl);
    },
    onError: (err: any) => toast.error(err.message ?? 'Preview failed'),
  });

  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [previewProfileId, setPreviewProfileId] = useState<string | null>(null);
  const [previewCustomText, setPreviewCustomText] = useState('');

  const handleDesignVoice = () => {
    if (!universeId) {
      toast.error('Entity must belong to a universe to design a voice');
      return;
    }

    const finalDescription =
      description || `Voice for ${entityName}, a ${entityKind}. ${entityDescription.slice(0, 200)}`;

    const finalPreviewText =
      previewText ||
      `My name is ${entityName}. ${entityDescription.split('.').slice(0, 2).join('.')}`.slice(
        0,
        200
      );

    designVoice.mutate({
      universeId,
      characterName: entityName,
      description: finalDescription,
      gender,
      age,
      accent,
      accentStrength,
      previewText: finalPreviewText,
      stability: inferred.stability,
      style: inferred.style,
      castMemberId: entityId,
    });
  };

  // If not a character-like entity, don't show
  const VOICE_ELIGIBLE_KINDS = ['person', 'species', 'faction', 'organization'];
  if (!VOICE_ELIGIBLE_KINDS.includes(entityKind)) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4" />
            Voice Profile
            {entityProfiles.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {entityProfiles.length} voice{entityProfiles.length > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          {isOwner && !showDesigner && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowDesigner(true)}
            >
              <Sparkles className="w-3 h-3 mr-1" />
              Design Voice
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Existing voice profiles with audio players */}
        {loadingProfiles && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading voice profiles...
          </div>
        )}

        {entityProfiles.map((profile: any) => (
          <div key={profile.id} className="space-y-2 rounded-lg border p-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Volume2 className="w-3.5 h-3.5 text-primary" />
                <span className="font-medium">{profile.characterName}</span>
                <Badge variant="outline" className="text-[10px]">
                  {profile.gender} / {profile.age?.replace('_', ' ')} / {profile.accent}
                </Badge>
              </div>
              {isOwner && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirm('Delete this voice profile?')) {
                      deleteVoice.mutate(profile.id);
                    }
                  }}
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>

            {/* Audio preview */}
            {profile.previewUrl && (
              <AudioPlayer
                src={profile.previewUrl}
                title={`${profile.characterName} — Voice Sample`}
                compact
              />
            )}

            {profile.description && (
              <p className="text-xs text-muted-foreground">{profile.description}</p>
            )}

            {/* Custom preview text */}
            {isOwner && (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Test with custom text..."
                  className="flex-1 h-7 text-xs rounded border bg-background px-2"
                  value={previewProfileId === profile.id ? previewCustomText : ''}
                  onChange={(e) => {
                    setPreviewProfileId(profile.id);
                    setPreviewCustomText(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && previewCustomText.trim()) {
                      previewVoice.mutate({ profileId: profile.id, text: previewCustomText });
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] px-2"
                  disabled={
                    previewVoice.isPending ||
                    !previewCustomText.trim() ||
                    previewProfileId !== profile.id
                  }
                  onClick={() =>
                    previewVoice.mutate({ profileId: profile.id, text: previewCustomText })
                  }
                >
                  {previewVoice.isPending && previewProfileId === profile.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    'Test'
                  )}
                </Button>
              </div>
            )}

            {/* Custom preview result */}
            {previewAudioUrl && previewProfileId === profile.id && (
              <AudioPlayer src={previewAudioUrl} title="Custom Preview" compact />
            )}
          </div>
        ))}

        {!loadingProfiles && entityProfiles.length === 0 && !showDesigner && (
          <p className="text-sm text-muted-foreground">
            No voice profile yet.
            {isOwner && ' Design one to give this character a voice for dialogue scenes.'}
          </p>
        )}

        {/* Voice designer form */}
        {showDesigner && (
          <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Design Voice for {entityName}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setShowDesigner(false)}
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
            </div>

            {/* Gender */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Gender</label>
              <div className="flex gap-1">
                {GENDERS.map((g) => (
                  <Button
                    key={g.value}
                    variant={gender === g.value ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={() => setGender(g.value)}
                  >
                    {g.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Age */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Age</label>
              <div className="flex gap-1">
                {AGES.map((a) => (
                  <Button
                    key={a.value}
                    variant={age === a.value ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={() => setAge(a.value)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Accent */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Accent</label>
              <select
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="w-full h-8 text-xs rounded-md border bg-background px-2"
              >
                {ACCENTS.map((a) => (
                  <option key={a} value={a}>
                    {a.charAt(0).toUpperCase() + a.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Accent strength */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Accent Strength: {accentStrength.toFixed(1)}
              </label>
              <input
                type="range"
                min="0.3"
                max="2.0"
                step="0.1"
                value={accentStrength}
                onChange={(e) => setAccentStrength(parseFloat(e.target.value))}
                className="w-full h-2"
              />
            </div>

            {/* Voice description */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Voice Description (optional — auto-generated if empty)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`e.g. "Calm, technical, slightly detached. Quiet intensity."`}
                className="w-full h-16 text-xs rounded-md border bg-background px-2 py-1.5 resize-none"
              />
            </div>

            {/* Preview text */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Preview Text (what the voice will say as a sample)
              </label>
              <textarea
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                placeholder={`e.g. "My name is ${entityName}. ${entityDescription.split('.')[0]}."`}
                className="w-full h-16 text-xs rounded-md border bg-background px-2 py-1.5 resize-none"
              />
            </div>

            {/* Cost + submit */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Cost: ~8 credits</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowDesigner(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleDesignVoice}
                  disabled={designVoice.isPending}
                >
                  {designVoice.isPending ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Designing...
                    </>
                  ) : (
                    <>
                      <Mic className="w-3 h-3 mr-1" />
                      Design Voice
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
