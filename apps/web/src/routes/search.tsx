/**
 * /search — multimodal search over VLM-indexed scenes.
 * Text query → scene hits with tags, timestamps, and deep-links into content.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search as SearchIcon, Loader2 } from 'lucide-react';

export const Route = createFileRoute('/search')({
  component: SearchPage,
});

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function SearchPage() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data: hits, isFetching } = useQuery({
    queryKey: ['vlm-search', submitted],
    queryFn: () => trpcClient.vlm.search.query.query({ q: submitted, limit: 30 }),
    enabled: submitted.length > 0,
  });

  return (
    <div className="min-h-screen bg-background p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Multimodal Search</h1>
        <p className="text-xs text-muted-foreground">
          Search scenes by what's visible — objects, characters, moods, sigils.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q.trim());
        }}
        className="flex gap-2"
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='e.g. "red sigil desert sunset"'
          className="flex-1"
        />
        <Button type="submit" disabled={!q.trim()}>
          <SearchIcon className="h-4 w-4" />
        </Button>
      </form>

      {submitted && isFetching ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </div>
      ) : null}

      {!isFetching && submitted && hits && (hits as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No scenes matched. Try broader keywords or different tokens.
        </p>
      ) : null}

      <ul className="space-y-2">
        {((hits as any[]) ?? []).map((h, i) => (
          <li key={`${h.contentId}-${h.sceneIndex}-${i}`}>
            <Link to="/gallery" search={{ contentId: h.contentId } as any} className="block">
              <Card className="hover:border-primary/60 transition">
                <CardContent className="p-3 space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">
                      {h.matchedBy}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      {fmt(h.startSec)}–{fmt(h.endSec)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      score {h.score.toFixed(2)}
                    </span>
                  </div>
                  <p>{h.caption}</p>
                  {h.tags?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {h.tags.slice(0, 8).map((t: string) => (
                        <Badge key={t} variant="secondary" className="text-[9px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
