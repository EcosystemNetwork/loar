/**
 * NotificationSettings — Manage push/email notification preferences
 * and device registration for FCM push notifications.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Mail, Smartphone, TestTube, Loader2, Check } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useWalletAuth } from '../../lib/wallet-auth';
import { toast } from 'sonner';

const NOTIFICATION_TYPES = [
  { key: 'new_follower', label: 'New followers', description: 'When someone follows you' },
  { key: 'proposal_vote', label: 'Governance votes', description: 'Votes on your proposals' },
  { key: 'canon_accepted', label: 'Canon accepted', description: 'Your submission is canonized' },
  { key: 'canon_rejected', label: 'Canon rejected', description: 'Your submission is rejected' },
  {
    key: 'content_in_universe',
    label: 'Universe content',
    description: 'New content in your universes',
  },
  { key: 'item_sold', label: 'Item sold', description: 'Your NFT or listing sells' },
  {
    key: 'subscription_new',
    label: 'New subscriber',
    description: 'Someone subscribes to your universe',
  },
  { key: 'mention', label: 'Mentions', description: 'When you are @mentioned' },
  { key: 'poll_ended', label: 'Poll results', description: 'Polls you voted on have ended' },
  {
    key: 'episode_drop',
    label: 'Episode drops',
    description: 'New episodes in followed universes',
  },
] as const;

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-900 ${
        checked ? 'bg-violet-600' : 'bg-zinc-700'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function NotificationSettings() {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();

  const { data: prefs, isLoading } = useQuery(
    trpc.notifications.getPreferences.queryOptions(undefined, {
      enabled: isAuthenticated,
    })
  );

  const [pushEnabled, setPushEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [channels, setChannels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (prefs) {
      setPushEnabled(prefs.push ?? false);
      setEmailEnabled(prefs.email ?? false);
      setChannels(prefs.channels ?? {});
    }
  }, [prefs]);

  const updatePrefs = useMutation(
    trpc.notifications.updatePreferences.mutationOptions({
      onSuccess: () => {
        toast.success('Preferences saved');
        queryClient.invalidateQueries({ queryKey: [['notifications', 'getPreferences']] });
      },
    })
  );

  const registerDevice = useMutation(
    trpc.notifications.registerDevice.mutationOptions({
      onSuccess: () => toast.success('Device registered for push notifications'),
    })
  );

  const testPush = useMutation(
    trpc.notifications.testPush.mutationOptions({
      onSuccess: () => toast.success('Test notification sent!'),
      onError: () => toast.error('Failed to send test notification'),
    })
  );

  function handleSave() {
    updatePrefs.mutate({ push: pushEnabled, email: emailEnabled, channels });
  }

  function toggleChannel(type: string, channel: 'push' | 'email') {
    setChannels((prev) => {
      const current = prev[type] ?? ['in_app', 'push', 'email'];
      const has = current.includes(channel);
      return {
        ...prev,
        [type]: has ? current.filter((c) => c !== channel) : [...current, channel],
      };
    });
  }

  async function handleEnablePush() {
    if (!('Notification' in window)) {
      toast.error('Push notifications not supported in this browser');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast.error('Push notification permission denied');
      return;
    }
    // In a real implementation, get FCM token from Firebase Messaging SDK
    // For now, register with a placeholder that the SW will replace
    registerDevice.mutate({ token: 'web-push-' + Date.now(), platform: 'web' });
    setPushEnabled(true);
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        Sign in to manage notification settings
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-zinc-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Global toggles */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Delivery Channels</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Smartphone className="h-5 w-5 text-violet-400" />
              <div>
                <p className="text-white font-medium">Push Notifications</p>
                <p className="text-sm text-zinc-400">Browser & mobile push alerts</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Toggle
                checked={pushEnabled}
                onChange={(v) => {
                  setPushEnabled(v);
                  if (v) handleEnablePush();
                }}
              />
              {pushEnabled && (
                <button
                  onClick={() => testPush.mutate()}
                  disabled={testPush.isPending}
                  className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                >
                  {testPush.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <TestTube className="h-3 w-3" />
                  )}
                  Test
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-blue-400" />
              <div>
                <p className="text-white font-medium">Email Notifications</p>
                <p className="text-sm text-zinc-400">Important updates to your inbox</p>
              </div>
            </div>
            <Toggle checked={emailEnabled} onChange={setEmailEnabled} />
          </div>
        </div>
      </div>

      {/* Per-type channel config */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Event Types</h3>
        <p className="text-sm text-zinc-400 mb-6">Choose which channels each notification uses</p>

        <div className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[1fr_60px_60px] gap-2 px-3 pb-2 border-b border-zinc-800">
            <span className="text-xs text-zinc-500 uppercase">Event</span>
            <span className="text-xs text-zinc-500 uppercase text-center">Push</span>
            <span className="text-xs text-zinc-500 uppercase text-center">Email</span>
          </div>

          {NOTIFICATION_TYPES.map(({ key, label, description }) => {
            const typeChannels = channels[key] ?? ['in_app', 'push', 'email'];
            return (
              <div
                key={key}
                className="grid grid-cols-[1fr_60px_60px] gap-2 items-center px-3 py-3 rounded-lg hover:bg-zinc-800/50"
              >
                <div>
                  <p className="text-sm text-white">{label}</p>
                  <p className="text-xs text-zinc-500">{description}</p>
                </div>
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={typeChannels.includes('push')}
                    onChange={() => toggleChannel(key, 'push')}
                    disabled={!pushEnabled}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500 focus:ring-offset-zinc-900"
                  />
                </div>
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={typeChannels.includes('email')}
                    onChange={() => toggleChannel(key, 'email')}
                    disabled={!emailEnabled}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500 focus:ring-offset-zinc-900"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={updatePrefs.isPending}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-6 py-2.5 font-medium transition-colors"
        >
          {updatePrefs.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : updatePrefs.isSuccess ? (
            <Check className="h-4 w-4" />
          ) : null}
          Save Preferences
        </button>
      </div>
    </div>
  );
}
