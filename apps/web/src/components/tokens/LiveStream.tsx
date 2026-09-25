/**
 * Live stream panel for a token page. Everyone sees a LIVE banner with a
 * click-to-load player (nothing third-party loads until they press play); the
 * token's creator also gets Go-live / End controls. Stream refs are validated
 * server-side and the iframe src is rebuilt from that ref (see lib/live-embed).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Play, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { trpcClient } from '@/utils/trpc';
import { liveEmbedUrl } from '@/lib/live-embed';

export function LiveStream({
  tokenAddress,
  isCreator,
}: {
  tokenAddress: string;
  isCreator: boolean;
}) {
  const qc = useQueryClient();
  const key = ['token-live', tokenAddress.toLowerCase()];
  const [playing, setPlaying] = useState(false);
  const [url, setUrl] = useState('');

  const live = useQuery({
    queryKey: key,
    queryFn: () => trpcClient.tokenSocial.getLive.query({ tokenAddress }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const goLive = useMutation({
    mutationFn: () => trpcClient.tokenSocial.setLive.mutate({ tokenAddress, url: url.trim() }),
    onSuccess: () => {
      setUrl('');
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const endLive = useMutation({
    mutationFn: () => trpcClient.tokenSocial.endLive.mutate({ tokenAddress }),
    onSuccess: () => {
      setPlaying(false);
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const stream = live.data;
  if (!stream && !isCreator) return null;

  const src = stream ? liveEmbedUrl(stream.platform, stream.ref, window.location.hostname) : null;

  return (
    <Card className={stream ? 'mb-4 border-red-500/40' : 'mb-4'}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Radio className={`h-4 w-4 ${stream ? 'text-red-500' : 'text-muted-foreground'}`} />
          <h3 className="text-sm font-semibold">{stream ? 'Live now' : 'Go live'}</h3>
          {stream && (
            <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              Live
            </span>
          )}
          {stream && (
            <a
              href={stream.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Open on {stream.platform} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {stream &&
          src &&
          (playing ? (
            <div className="aspect-video overflow-hidden rounded-md bg-black">
              <iframe
                src={src}
                title="Live stream"
                className="h-full w-full"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md bg-muted/40 text-sm hover:bg-muted/60"
            >
              <Play className="h-8 w-8 text-red-500" />
              Watch the {stream.platform} stream
              <span className="text-[10px] text-muted-foreground">
                Loads the {stream.platform} player when you press play
              </span>
            </button>
          ))}

        {isCreator && (
          <div className="space-y-2">
            {stream ? (
              <Button
                variant="outline"
                size="sm"
                disabled={endLive.isPending}
                onClick={() => endLive.mutate()}
              >
                {endLive.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                End stream
              </Button>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Paste your YouTube, Twitch or Kick stream link. It shows on this page for up to 12
                  hours.
                </p>
                <div className="flex gap-2">
                  <Input
                    aria-label="Stream link"
                    placeholder="https://twitch.tv/yourchannel"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    maxLength={300}
                  />
                  <Button
                    disabled={!url.trim() || goLive.isPending}
                    onClick={() => goLive.mutate()}
                  >
                    {goLive.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Go live'}
                  </Button>
                </div>
              </>
            )}
            {(goLive.error || endLive.error) && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {((goLive.error ?? endLive.error) as Error).message}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
