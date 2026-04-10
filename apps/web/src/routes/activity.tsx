import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '../utils/trpc';

export const Route = createFileRoute('/activity')({
  component: ActivityPage,
});

const EVENT_ICONS: Record<string, string> = {
  created_universe: 'Created a universe',
  created_content: 'Published new content',
  created_character: 'Created a character',
  created_entity: 'Created an entity',
  minted_nft: 'Minted an NFT',
  voted_proposal: 'Voted on a proposal',
  created_proposal: 'Created a proposal',
  executed_proposal: 'Executed a proposal',
  followed_user: 'Followed',
  purchased_credits: 'Purchased credits',
  subscribed_universe: 'Subscribed to a universe',
  submitted_canon: 'Submitted to canon',
  canon_accepted: 'Canon submission accepted',
  collab_started: 'Started a collaboration',
  listed_item: 'Listed an item',
  sold_item: 'Sold an item',
};

function ActivityPage() {
  const [tab, setTab] = useState<'following' | 'global'>('following');

  const followingFeed = useQuery(
    trpc.social.getActivityFeed.queryOptions({ limit: 30 }, { enabled: tab === 'following' })
  );

  const globalFeed = useQuery(
    trpc.social.getGlobalFeed.queryOptions({ limit: 30 }, { enabled: tab === 'global' })
  );

  const feed = tab === 'following' ? followingFeed : globalFeed;
  const events = (feed.data as any)?.events || [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">Activity</h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(['following', 'global'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Feed */}
        {feed.isError ? (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
            <p className="text-red-400">Failed to load activity feed</p>
          </div>
        ) : feed.isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-zinc-800" />
                <div className="flex-1">
                  <div className="h-4 bg-zinc-800 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-zinc-800 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-400 text-lg">
              {tab === 'following'
                ? 'Follow creators to see their activity here'
                : 'No activity yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {events.map((event: any) => {
              const time = event.createdAt?.toDate
                ? new Date(event.createdAt.toDate())
                : new Date(
                    event.createdAt?._seconds ? event.createdAt._seconds * 1000 : event.createdAt
                  );

              return (
                <div
                  key={event.id}
                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-zinc-900/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-sm text-zinc-400 flex-shrink-0">
                    {event.actorDisplayName?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200">
                      <span className="font-medium text-white">
                        {event.actorDisplayName || event.actorUid?.slice(0, 8)}
                      </span>{' '}
                      {EVENT_ICONS[event.eventType] || event.eventType}
                      {event.targetTitle && (
                        <span className="text-violet-400"> {event.targetTitle}</span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {time instanceof Date && !isNaN(time.getTime())
                        ? time.toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
