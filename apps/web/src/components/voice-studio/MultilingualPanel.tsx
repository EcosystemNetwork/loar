/**
 * Voice Studio — Multilingual Dubbing tab.
 *
 * Wraps ElevenLabs' Dubbing API: take an episode (or any video URL) and
 * generate translated dubs for N target languages. Poll status until each
 * job either completes or fails, then offer playback + publish-to-episode.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Globe, Loader2, CheckCircle2, AlertCircle, Send } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { LANG_NAMES, type MultilingualDubJob } from './voice-studio.types';

interface MultilingualPanelProps {
  episodeId?: string;
}

const POPULAR_TARGETS = ['es', 'fr', 'de', 'pt', 'it', 'ja', 'zh', 'ko', 'hi', 'ar', 'ru'];

export function MultilingualPanel({ episodeId }: MultilingualPanelProps) {
  const queryClient = useQueryClient();
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLang, setSourceLang] = useState('en');
  const [durationSec, setDurationSec] = useState(60);
  const [numSpeakers, setNumSpeakers] = useState<number | ''>('');
  const [selectedLangs, setSelectedLangs] = useState<Set<string>>(new Set(['es', 'ja']));

  const { data: jobs } = useQuery({
    queryKey: ['multilingualDub', 'list', episodeId],
    queryFn: () =>
      trpcClient.multilingualDub.list.query({
        episodeId,
        limit: 100,
      }),
  });

  const { data: supported } = useQuery({
    queryKey: ['multilingualDub', 'languages'],
    queryFn: () => trpcClient.multilingualDub.supportedLanguages.query(),
  });

  const { data: estimate } = useQuery({
    queryKey: ['multilingualDub', 'estimate', durationSec, selectedLangs.size],
    queryFn: () =>
      trpcClient.multilingualDub.estimateCost.query({
        durationSec,
        targetLangs: Math.max(1, selectedLangs.size),
      }),
    enabled: selectedLangs.size > 0,
  });

  const create = useMutation({
    mutationFn: () =>
      trpcClient.multilingualDub.create.mutate({
        sourceVideoUrl: sourceUrl,
        sourceLang: sourceLang as never,
        targetLangs: Array.from(selectedLangs) as never,
        durationSec,
        numSpeakers: typeof numSpeakers === 'number' ? numSpeakers : undefined,
        episodeId,
      }),
    onSuccess: (res) => {
      toast.success(`Started ${res.jobs.length} dub job(s)`);
      if (res.failures.length) toast.error(`${res.failures.length} target language(s) failed`);
      queryClient.invalidateQueries({ queryKey: ['multilingualDub', 'list'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const poll = useMutation({
    mutationFn: (id: string) => trpcClient.multilingualDub.status.mutate({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['multilingualDub', 'list'] }),
  });

  const publish = useMutation({
    mutationFn: (id: string) => trpcClient.multilingualDub.publish.mutate({ id }),
    onSuccess: () => {
      toast.success('Published to episode');
      queryClient.invalidateQueries({ queryKey: ['multilingualDub', 'list'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Auto-poll dubbing jobs every 8s ────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const list = (jobs ?? []) as MultilingualDubJob[];
      for (const j of list) {
        if (j.status === 'dubbing') poll.mutate(j.id);
      }
    }, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  function toggleLang(code: string) {
    setSelectedLangs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const supportedLangs = (supported?.languages ?? POPULAR_TARGETS) as readonly string[];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4" /> Create multilingual dubs
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Source video URL</Label>
              <Input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://… episode mp4"
              />
            </div>
            <div>
              <Label className="text-xs">Source language</Label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
              >
                {supportedLangs.map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAMES[l] ?? l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs">Duration (sec)</Label>
              <Input
                type="number"
                min={1}
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value) || 1)}
              />
            </div>
            <div>
              <Label className="text-xs"># Speakers (hint)</Label>
              <Input
                type="number"
                min={1}
                max={20}
                placeholder="auto"
                value={numSpeakers}
                onChange={(e) => setNumSpeakers(e.target.value ? Number(e.target.value) : '')}
              />
            </div>
            <div className="col-span-2 flex items-end justify-end gap-2">
              <div className="text-xs text-muted-foreground">
                {estimate ? (
                  <>
                    {estimate.totalCredits} credits ({estimate.perLanguageCredits}/lang ×{' '}
                    {selectedLangs.size})
                  </>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>
          <div>
            <Label className="text-xs">Target languages</Label>
            <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6">
              {supportedLangs.map((l) => (
                <label
                  key={l}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={selectedLangs.has(l)}
                    onCheckedChange={() => toggleLang(l)}
                    disabled={l === sourceLang}
                  />
                  <span>{LANG_NAMES[l] ?? l}</span>
                </label>
              ))}
            </div>
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !sourceUrl.trim() || selectedLangs.size === 0}
          >
            {create.isPending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 size-3.5" />
            )}
            Dub to {selectedLangs.size} language{selectedLangs.size === 1 ? '' : 's'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {((jobs ?? []) as MultilingualDubJob[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {((jobs ?? []) as MultilingualDubJob[]).map((j) => (
                <li
                  key={j.id}
                  className="flex items-center gap-2 rounded border border-border p-2 text-sm"
                >
                  <Badge variant="outline" className="font-mono text-xs">
                    {j.targetLang}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {LANG_NAMES[j.targetLang] ?? j.targetLang}
                  </span>
                  <StatusBadge status={j.status} />
                  {j.failureReason ? (
                    <span className="text-[10px] text-destructive">{j.failureReason}</span>
                  ) : null}
                  <span className="grow" />
                  {j.outputVideoUrl ? (
                    <a
                      href={j.outputVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline"
                    >
                      video
                    </a>
                  ) : null}
                  {j.outputAudioUrl ? (
                    <a
                      href={j.outputAudioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline"
                    >
                      audio
                    </a>
                  ) : null}
                  {j.status === 'complete' && j.episodeId && !j.publishedToEpisode ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => publish.mutate(j.id)}
                      disabled={publish.isPending}
                    >
                      Publish
                    </Button>
                  ) : null}
                  {j.publishedToEpisode ? (
                    <Badge variant="outline" className="text-[10px] text-emerald-500">
                      published
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: MultilingualDubJob['status'] }) {
  if (status === 'complete')
    return (
      <Badge variant="outline" className="gap-1 text-[10px] text-emerald-500">
        <CheckCircle2 className="size-3" /> complete
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge variant="outline" className="gap-1 text-[10px] text-destructive">
        <AlertCircle className="size-3" /> failed
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <Loader2 className="size-3 animate-spin" /> dubbing
    </Badge>
  );
}
