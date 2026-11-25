/**
 * CharacterViewer — a character's 3D model with its motion clips. Each clip
 * is its own GLB (mesh + baked motion), so switching clips swaps the source.
 */
import { useState } from 'react';
import { ModelViewer } from '@/components/ModelViewerLazy';
import { Button } from '@/components/ui/button';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';
import { cn } from '@/lib/utils';
import { clipLabel, type PuppetClip } from './clips';

const url = (u: string | null | undefined) => (u ? resolveIpfsUrlPreferred(u) : '');

export function CharacterViewer({
  name,
  modelUrl,
  posterUrl,
  usdzUrl,
  clips,
  className,
}: {
  name: string;
  /** Static model to show when no clip is playing (web copy preferred). */
  modelUrl: string | null;
  posterUrl?: string | null;
  usdzUrl?: string | null;
  clips: PuppetClip[];
  className?: string;
}) {
  const [clip, setClip] = useState<string | null>(null);
  const active = clips.find((c) => c.preset === clip) ?? null;
  const src = active ? (active.webUrl ?? active.url) : modelUrl;
  if (!src) return null;

  return (
    <div className="space-y-2">
      <ModelViewer
        key={src}
        src={url(src)}
        poster={active ? undefined : url(posterUrl) || undefined}
        alt={active ? `${name} — ${clipLabel(active.preset)}` : `${name} 3D model`}
        iosSrc={active ? null : url(usdzUrl) || null}
        autoplay={!!active}
        className={cn('aspect-square w-full', className)}
      />
      {clips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Motion:</span>
          <Button
            size="sm"
            variant={clip === null ? 'default' : 'outline'}
            className="h-7 px-2 text-xs"
            onClick={() => setClip(null)}
          >
            Static
          </Button>
          {clips.map((c) => (
            <Button
              key={c.preset}
              size="sm"
              variant={clip === c.preset ? 'default' : 'outline'}
              className="h-7 px-2 text-xs"
              onClick={() => setClip(c.preset)}
            >
              {clipLabel(c.preset)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
