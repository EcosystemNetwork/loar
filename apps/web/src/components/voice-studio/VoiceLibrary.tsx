/**
 * Voice Studio — Library tab.
 *
 * Browse the LOAR curated voice catalog. Filter by category/gender/tag,
 * preview voices inline, save into "My Voices".
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Play, Pause, Bookmark, Sparkles, ArrowRight } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  VOICE_CATEGORY_LABELS,
  type LibraryVoice,
  type VoiceCategory,
  type Gender,
} from './voice-studio.types';

interface VoiceLibraryProps {
  onCast?: (voice: LibraryVoice) => void;
}

const CATEGORIES: Array<VoiceCategory | 'all'> = [
  'all',
  'narrator',
  'protagonist_male',
  'protagonist_female',
  'villain',
  'child',
  'elderly',
  'creature',
  'accent',
  'specialty',
];

export function VoiceLibrary({ onCast }: VoiceLibraryProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<VoiceCategory | 'all'>('all');
  const [gender, setGender] = useState<Gender | 'all'>('all');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['voiceLibrary', 'list', category, gender, search],
    queryFn: () =>
      trpcClient.voiceLibrary.list.query({
        category: category === 'all' ? undefined : category,
        gender: gender === 'all' ? undefined : gender,
        search: search.trim() || undefined,
        limit: 200,
      }),
  });

  const voices = (data ?? []) as LibraryVoice[];

  const grouped = useMemo(() => {
    const byCat = new Map<VoiceCategory, LibraryVoice[]>();
    for (const v of voices) {
      if (!byCat.has(v.category)) byCat.set(v.category, []);
      byCat.get(v.category)!.push(v);
    }
    return byCat;
  }, [voices]);

  const saveMutation = useMutation({
    mutationFn: (libraryEntryId: string) =>
      trpcClient.voiceLibrary.saveToMyVoices.mutate({ libraryEntryId }),
    onSuccess: () => {
      toast.success('Saved to My Voices');
      queryClient.invalidateQueries({ queryKey: ['voiceLibrary', 'myVoices'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function play(voice: LibraryVoice) {
    if (!voice.previewUrl) {
      toast.error('No preview available — seed the library to mint preview audio.');
      return;
    }
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    if (playingId === voice.id) {
      setPlayingId(null);
      return;
    }
    const a = new Audio(voice.previewUrl);
    a.onended = () => setPlayingId(null);
    a.play().catch((e) => toast.error(`Preview failed: ${e.message}`));
    setAudioEl(a);
    setPlayingId(voice.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative grow min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search voices…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={category} onValueChange={(v) => setCategory(v as VoiceCategory | 'all')}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c === 'all' ? 'All categories' : VOICE_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={gender} onValueChange={(v) => setGender(v as Gender | 'all')}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any gender</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading voices…</p>
      ) : voices.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No voices in the library yet. Run{' '}
              <code className="rounded bg-muted px-1.5 py-0.5">pnpm seed:voices</code> to mint the
              curated catalog.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(grouped.entries()).map(([cat, list]) => (
            <section key={cat} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {VOICE_CATEGORY_LABELS[cat]}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((voice) => (
                  <VoiceCard
                    key={voice.id}
                    voice={voice}
                    playing={playingId === voice.id}
                    onPlay={() => play(voice)}
                    onSave={() => saveMutation.mutate(voice.id)}
                    onCast={onCast ? () => onCast(voice) : undefined}
                    saving={saveMutation.isPending && saveMutation.variables === voice.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function VoiceCard({
  voice,
  playing,
  onPlay,
  onSave,
  onCast,
  saving,
}: {
  voice: LibraryVoice;
  playing: boolean;
  onPlay: () => void;
  onSave: () => void;
  onCast?: () => void;
  saving: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="truncate font-semibold">{voice.name}</h4>
            <p className="line-clamp-2 text-xs text-muted-foreground">{voice.description}</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onPlay}
            disabled={!voice.previewUrl}
            title={voice.previewUrl ? 'Preview' : 'No preview yet'}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px]">
            {voice.gender}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {voice.age.replace('_', ' ')}
          </Badge>
          {voice.accent ? (
            <Badge variant="outline" className="text-[10px]">
              {voice.accent}
            </Badge>
          ) : null}
          {voice.tags.slice(0, 3).map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" className="grow" onClick={onSave} disabled={saving}>
            <Bookmark className="mr-1.5 size-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {onCast ? (
            <Button size="sm" className="grow" onClick={onCast}>
              <ArrowRight className="mr-1.5 size-3.5" />
              Cast
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
