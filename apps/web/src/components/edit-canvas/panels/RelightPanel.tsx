/**
 * RelightPanel — change lighting / time of day / backdrop / mood while
 * preserving subject identity. Uses the existing `editing.relightPresets`
 * query to source the preset catalog.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import type { UseEditSessionResult } from '@/hooks/useEditSession';

export function RelightPanel({
  imageUrl,
  session,
  onJobComplete,
}: {
  imageUrl: string;
  session: UseEditSessionResult;
  onJobComplete: (job: { jobId: string; outputUrl: string; beforeUrl: string }) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const presetsQuery = useQuery({
    queryKey: ['editing', 'relightPresets'],
    queryFn: () => trpcClient.editing.relightPresets.query(),
    staleTime: Infinity,
  });

  const groups = presetsQuery.data
    ? [
        { title: 'Lighting', items: presetsQuery.data.lighting },
        { title: 'Time of day', items: presetsQuery.data.time },
        { title: 'Backdrop', items: presetsQuery.data.backdrop },
        { title: 'Mood', items: presetsQuery.data.mood },
      ]
    : [];

  function togglePreset(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleRun() {
    if (selected.size === 0 && !freeText.trim()) {
      toast.error('Pick a preset or add free-text guidance');
      return;
    }
    setIsRunning(true);
    try {
      const job = await session.runRelight({
        presetIds: Array.from(selected),
        freeText: freeText || undefined,
      });
      onJobComplete({ jobId: job.jobId, outputUrl: job.outputUrl, beforeUrl: imageUrl });
    } catch (err: any) {
      toast.error(err?.message || 'Relight failed');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <img
            src={imageUrl}
            alt="source"
            className="w-full rounded border border-border/40 max-h-[540px] object-contain bg-black/20"
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-4">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="text-xs font-medium mb-2">{g.title}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((p: { id: string; label: string; description: string }) => (
                  <Badge
                    key={p.id}
                    variant={selected.has(p.id) ? 'default' : 'outline'}
                    className="cursor-pointer text-[11px] py-1 px-2"
                    onClick={() => togglePreset(p.id)}
                    title={p.description}
                  >
                    {p.label}
                  </Badge>
                ))}
              </div>
            </div>
          ))}

          <Textarea
            placeholder="Optional free-text guidance (e.g. 'softer rim light, slightly warmer')"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={2}
            className="text-sm"
          />

          <Button onClick={handleRun} disabled={isRunning || !session.sessionId} className="w-full">
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Relighting…
              </>
            ) : (
              <>
                <Sun className="h-4 w-4 mr-1.5" />
                Run relight
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
