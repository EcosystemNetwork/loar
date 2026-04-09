import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../utils/trpc';

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: unreadData } = useQuery(
    trpc.social.getUnreadCount.queryOptions(undefined, {
      refetchInterval: 30_000,
    })
  );

  const { data: notificationsData } = useQuery(
    trpc.social.getNotifications.queryOptions({ limit: 10 }, { enabled: isOpen })
  );

  const markRead = useMutation(
    trpc.social.markRead.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [['social', 'getUnreadCount']] });
        queryClient.invalidateQueries({ queryKey: [['social', 'getNotifications']] });
      },
    })
  );

  const unreadCount = unreadData?.count ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen && unreadCount > 0) {
            markRead.mutate({ all: true });
          }
        }}
        className="relative p-2 text-zinc-400 hover:text-white transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-violet-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-semibold text-white text-sm">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={() => markRead.mutate({ all: true })}
                  className="text-xs text-violet-400 hover:text-violet-300"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notificationsData?.notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-zinc-500 text-sm">
                  No notifications yet
                </div>
              ) : (
                notificationsData?.notifications.map((notif: any) => (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/50 transition-colors ${
                      !notif.read ? 'bg-violet-900/10' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {notif.actorAvatarUrl ? (
                        <img src={notif.actorAvatarUrl} alt="" className="w-8 h-8 rounded-full" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs text-zinc-400">
                          {notif.actorDisplayName?.[0] || '?'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-200">{notif.message}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {notif.createdAt?.toDate
                            ? new Date(notif.createdAt.toDate()).toLocaleDateString()
                            : ''}
                        </p>
                      </div>
                      {!notif.read && (
                        <div className="w-2 h-2 rounded-full bg-violet-500 mt-1.5 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
