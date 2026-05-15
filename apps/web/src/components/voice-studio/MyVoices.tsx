/**
 * Voice Studio — My Voices tab.
 *
 * User's saved (from library) + cloned + designed voices.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play, Pause, Trash2, BookOpen, UserCircle, Wand2, Mic, ArrowRight } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MyVoice } from './voice-studio.types';

interface MyVoicesProps {
  onCast?: (voice: MyVoice) => void;
}

const SOURCE_ICON = {
  library: BookOpen,
  clone: Mic,
  design: Wand2,
};

export function MyVoices({ onCast }: MyVoicesProps) {
  const queryClient = useQueryClient();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['voiceLibrary', 'myVoices'],
    queryFn: () => trpcClient.voiceLibrary.myVoices.query({}),
  });

  const voices = (data ?? []) as MyVoice[];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => trpcClient.voiceLibrary.deleteMyVoice.mutate({ id }),
    onSuccess: () => {
      toast.success('Removed');
      queryClient.invalidateQueries({ queryKey: ['voiceLibrary', 'myVoices'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function play(voice: MyVoice) {
    if (!voice.previewUrl) {
      toast.error('No preview audio for this voice.');
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

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading your voices…</p>;
  }

  if (voices.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <UserCircle className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            You don't have any voices yet. Save curated voices from the Library tab, clone your own
            from the Clone tab, or design a new one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {voices.map((voice) => {
        const Icon = SOURCE_ICON[voice.source] ?? UserCircle;
        return (
          <Card key={voice.id}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon className="size-3.5 text-muted-foreground" />
                    <h4 className="truncate font-semibold">{voice.name}</h4>
                  </div>
                  {voice.description ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {voice.description}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => play(voice)}
                  disabled={!voice.previewUrl}
                >
                  {playingId === voice.id ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-[10px] capitalize">
                  {voice.source}
                </Badge>
                {(voice.tags ?? []).slice(0, 3).map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                {onCast ? (
                  <Button size="sm" className="grow" onClick={() => onCast(voice)}>
                    <ArrowRight className="mr-1.5 size-3.5" />
                    Cast
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate(voice.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
