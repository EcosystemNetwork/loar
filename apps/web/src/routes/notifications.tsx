/**
 * Notification Center — Full-page view of all user notifications.
 * Supports filtering (all/unread), mark-as-read, and load-more pagination.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck, Loader2 } from 'lucide-react';
import { trpc } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export const Route = createFileRoute('/notifications')({
  component: NotificationsPage,
});

const PAGE_SIZE = 20;

/** Format a date as a relative timestamp (e.g. "2m ago", "3h ago", "5d ago"). */
function relativeTime(date: Date | string | number): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
}

function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-4">
      <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}

function NotificationsPage() {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data: unreadData } = useQuery(
    trpc.social.getUnreadCount.queryOptions(undefined, {
      refetchInterval: 30_000,
      enabled: isAuthenticated,
    })
  );

  const {
    data: notificationsData,
    isLoading,
    isFetching,
  } = useQuery(trpc.social.getNotifications.queryOptions({ limit }, { enabled: isAuthenticated }));

  const markRead = useMutation(
    trpc.social.markRead.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [['social', 'getUnreadCount']] });
        queryClient.invalidateQueries({ queryKey: [['social', 'getNotifications']] });
      },
    })
  );

  const unreadCount = unreadData?.count ?? 0;
  const allNotifications = notificationsData?.notifications ?? [];
  const filtered =
    filter === 'unread' ? allNotifications.filter((n: any) => !n.read) : allNotifications;

  // Auth guard
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Bell className="h-12 w-12 text-zinc-600" />
            <p className="text-zinc-400 text-lg font-medium">
              Connect your wallet to view notifications
            </p>
            <p className="text-zinc-500 text-sm">Sign in to see activity across your universes</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-violet-400" />
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          {unreadCount > 0 && (
            <Badge className="bg-violet-600 text-white border-violet-500 hover:bg-violet-600">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markRead.mutate({ all: true })}
            disabled={markRead.isPending}
            className="text-violet-400 hover:text-violet-300 hover:bg-zinc-800"
          >
            {markRead.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}
            Mark all as read
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            filter === 'all'
              ? 'bg-zinc-800 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            filter === 'unread'
              ? 'bg-zinc-800 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Unread
          {unreadCount > 0 && (
            <span className="ml-1.5 text-xs bg-violet-600/30 text-violet-300 px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Notification list */}
      <Card className="border-zinc-800 bg-zinc-900/50 overflow-hidden py-0">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y divide-zinc-800/50">
              {Array.from({ length: 5 }).map((_, i) => (
                <NotificationSkeleton key={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Bell className="h-10 w-10 text-zinc-700" />
              <p className="text-zinc-500 text-sm">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </p>
              {filter === 'unread' && allNotifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilter('all')}
                  className="text-violet-400 hover:text-violet-300"
                >
                  View all notifications
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {filtered.map((notif: any) => (
                <button
                  key={notif.id}
                  onClick={() => {
                    if (!notif.read) {
                      markRead.mutate({ notificationId: notif.id });
                    }
                  }}
                  className={`w-full text-left px-4 py-4 hover:bg-zinc-800/50 transition-colors flex items-start gap-3 ${
                    !notif.read ? 'bg-violet-950/20' : ''
                  }`}
                >
                  {/* Actor avatar */}
                  <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm font-semibold text-violet-300 flex-shrink-0">
                    {notif.actorDisplayName?.[0]?.toUpperCase() || '?'}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm leading-snug ${!notif.read ? 'text-zinc-100' : 'text-zinc-400'}`}
                    >
                      {notif.message}
                    </p>
                    <p className="text-xs text-zinc-600 mt-1">
                      {notif.createdAt
                        ? relativeTime(
                            notif.createdAt?.toDate ? notif.createdAt.toDate() : notif.createdAt
                          )
                        : ''}
                    </p>
                  </div>

                  {/* Unread indicator / read icon */}
                  <div className="flex-shrink-0 mt-1">
                    {!notif.read ? (
                      <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                    ) : (
                      <Check className="h-4 w-4 text-zinc-700" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Load more */}
      {!isLoading && allNotifications.length >= limit && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => setLimit((prev) => prev + PAGE_SIZE)}
            disabled={isFetching}
            className="border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
