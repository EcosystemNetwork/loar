import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Music, Play, Pause, Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Link } from '@tanstack/react-router';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface AudioTabProps {
  universeAddress?: string;
}

export function AudioTab({ universeAddress }: AudioTabProps) {
  const [search, setSearch] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['wiki', 'audio', universeAddress],
    queryFn: () =>
      trpcClient.gallery.browse.query({
        universeId: universeAddress,
        mediaType: 'audio',
        sortBy: 'newest',
        limit: 50,
      }),
  });

  const items: any[] = (data?.items ?? []) as any[];
  const filtered = search.trim()
    ? items.filter(
        (i) =>
          i.title?.toLowerCase().includes(search.toLowerCase()) ||
          i.description?.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  function toggle(id: string, url: string) {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const a = new Audio(url);
    audioRef.current = a;
    a.addEventListener('ended', () => setPlayingId(null));
    a.play().catch(() => setPlayingId(null));
    setPlayingId(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search soundtracks…"
            className="pl-9"
          />
        </div>
        <Link to="/sandbox">
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            Generate Audio
          </Button>
        </Link>
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Music className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="mb-2">No audio yet.</p>
          <p className="text-xs mb-4">
            Generate music, dialogue, or SFX in the sandbox — they'll appear here.
          </p>
          <Link to="/sandbox">
            <Button variant="outline">Open Sandbox</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => {
          const isPlaying = playingId === item.id;
          return (
            <Card key={item.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              <div className="aspect-square bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 relative flex items-center justify-center">
                {item.thumbnailUrl ? (
                  <img
                    src={resolveIpfsUrl(item.thumbnailUrl)}
                    alt={item.title}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <Music className="h-12 w-12 text-muted-foreground/40" />
                )}
                {item.mediaUrl && (
                  <Button
                    onClick={() => toggle(item.id, item.mediaUrl)}
                    size="icon"
                    className="relative z-10 h-14 w-14 rounded-full bg-white/90 text-black hover:bg-white"
                  >
                    {isPlaying ? (
                      <Pause className="h-6 w-6" />
                    ) : (
                      <Play className="h-6 w-6 ml-0.5" />
                    )}
                  </Button>
                )}
                <Badge className="absolute top-2 left-2 bg-black/60 text-white border-0 text-[10px]">
                  <Music className="h-2.5 w-2.5 mr-1" />
                  Audio
                </Badge>
                {item.classification && (
                  <Badge
                    variant="outline"
                    className="absolute top-2 right-2 bg-black/60 text-white border-0 text-[10px]"
                  >
                    {item.classification}
                  </Badge>
                )}
              </div>
              <CardContent className="p-3">
                <p className="text-sm font-medium truncate">{item.title}</p>
                {item.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {item.description}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
