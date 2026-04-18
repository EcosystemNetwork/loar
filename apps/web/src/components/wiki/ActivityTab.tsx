import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Activity, Clock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from '@tanstack/react-router';

interface ActivityEvent {
  id: string;
  actorUid?: string;
  actorName?: string;
  type?: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  description?: string;
  createdAt?: string | number | { _seconds?: number };
}

function formatRelative(ts: ActivityEvent['createdAt']): string {
  if (!ts) return '';
  let ms = 0;
  if (typeof ts === 'number') ms = ts;
  else if (typeof ts === 'string') ms = new Date(ts).getTime();
  else if (typeof ts === 'object' && ts && '_seconds' in ts && typeof ts._seconds === 'number') {
    ms = ts._seconds * 1000;
  }
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function ActivityTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['wiki', 'activity'],
    queryFn: () => trpcClient.social.getGlobalFeed.query({ limit: 50 }),
  });

  const events = ((data as { events?: ActivityEvent[] } | undefined)?.events ??
    []) as ActivityEvent[];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Recent activity across all public universes ({events.length} events)
      </p>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}

      {!isLoading && events.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p>Quiet at the moment.</p>
          <p className="text-xs mt-1">Create an entity or follow a creator to start the feed.</p>
        </div>
      )}

      <div className="space-y-2">
        {events.map((ev) => {
          const inner = (
            <div className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors rounded">
              <div className="mt-0.5 flex-shrink-0">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 flex items-center justify-center">
                  <Activity className="h-3.5 w-3.5 text-violet-300" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{ev.actorName || 'Someone'}</span>{' '}
                  <span className="text-muted-foreground">
                    {ev.description || (ev.type ? ev.type.replace(/_/g, ' ') : 'did something')}
                  </span>
                  {ev.targetName && (
                    <>
                      {' '}
                      <span className="font-medium">{ev.targetName}</span>
                    </>
                  )}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <Clock className="h-2.5 w-2.5" />
                  {formatRelative(ev.createdAt)}
                  {ev.targetType && (
                    <Badge variant="outline" className="text-[10px] py-0 h-4">
                      {ev.targetType}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          );
          return (
            <Card key={ev.id} className="overflow-hidden">
              {ev.targetType === 'entity' && ev.targetId ? (
                <Link to="/wiki/entity/$id" params={{ id: ev.targetId }}>
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
