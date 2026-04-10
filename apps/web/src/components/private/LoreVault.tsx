/**
 * LoreVault — hidden worldbuilding materials (backstories, lore, secrets).
 *
 * Items in the vault can be assigned different access tiers:
 *   - admin:   Only universe admin can see
 *   - team:    All team members can see
 *   - holders: Token holders above threshold can see
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc, trpcClient } from '../../utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AccessLevel } from '../../hooks/usePrivateAccess';

interface LoreVaultProps {
  universeId: string;
  accessLevel: AccessLevel;
}

const TIER_LABELS: Record<string, string> = {
  admin: 'Admin Only',
  team: 'Team',
  holders: 'Token Holders',
};

const TIER_COLORS: Record<string, string> = {
  admin: 'bg-red-900/50 text-red-400',
  team: 'bg-blue-900/50 text-blue-400',
  holders: 'bg-amber-900/50 text-amber-400',
};

export function LoreVault({ universeId, accessLevel }: LoreVaultProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [accessTier, setAccessTier] = useState<'team' | 'holders' | 'admin'>('team');

  const { data, isLoading } = useQuery(
    trpc.privateSection.listItems.queryOptions({
      universeId,
      section: 'vault',
      limit: 50,
    })
  );

  const createMutation = useMutation({
    mutationFn: (input: {
      universeId: string;
      title: string;
      body: string;
      accessTier: 'team' | 'holders' | 'admin';
    }) =>
      trpcClient.privateSection.createItem.mutate({
        ...input,
        section: 'vault',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['privateSection', 'listItems']] });
      setShowForm(false);
      setTitle('');
      setBody('');
      setAccessTier('team');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => trpcClient.privateSection.deleteItem.mutate({ itemId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['privateSection', 'listItems']] });
    },
  });

  const canCreate = accessLevel === 'admin' || accessLevel === 'team';
  const items = data?.items ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold">Lore Vault</h3>
          <p className="text-zinc-500 text-sm">
            Hidden worldbuilding — backstories, secrets, unreleased lore
          </p>
        </div>
        {canCreate && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add Lore'}
          </Button>
        )}
      </div>

      {showForm && (
        <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3 border border-zinc-700">
          <Input
            placeholder="Lore entry title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-zinc-900 border-zinc-600"
          />
          <Textarea
            placeholder="The hidden lore... (Markdown supported)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="bg-zinc-900 border-zinc-600 min-h-[120px]"
          />
          <div className="flex items-center gap-3">
            <label className="text-sm text-zinc-400">Who can see this?</label>
            <select
              value={accessTier}
              onChange={(e) => setAccessTier(e.target.value as 'team' | 'holders' | 'admin')}
              className="bg-zinc-900 border border-zinc-600 rounded-md px-3 py-1.5 text-sm text-white"
            >
              <option value="holders">Token Holders</option>
              <option value="team">Team Only</option>
              <option value="admin">Admin Only</option>
            </select>
          </div>
          <Button
            size="sm"
            onClick={() => createMutation.mutate({ universeId, title, body, accessTier })}
            disabled={!title.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Saving...' : 'Add to Vault'}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p>The vault is empty.</p>
          {canCreate && (
            <p className="text-sm mt-1">Add hidden lore, character backstories, or plot secrets.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item: any) => (
            <div
              key={item.id}
              className="bg-zinc-800/50 border border-zinc-700 rounded-lg overflow-hidden hover:border-zinc-600 transition-colors"
            >
              <button
                onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                className="w-full text-left p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <svg
                    className={`w-4 h-4 text-zinc-400 transition-transform ${expandedId === item.id ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m8.25 4.5 7.5 7.5-7.5 7.5"
                    />
                  </svg>
                  <h4 className="text-white font-medium truncate">{item.title}</h4>
                  <span
                    className={`text-xs px-2 py-0.5 rounded shrink-0 ${TIER_COLORS[item.accessTier] ?? TIER_COLORS.team}`}
                  >
                    {TIER_LABELS[item.accessTier] ?? item.accessTier}
                  </span>
                </div>
                {canCreate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(item.id);
                    }}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-red-400 hover:text-red-300 shrink-0"
                  >
                    Delete
                  </Button>
                )}
              </button>
              {expandedId === item.id && item.body && (
                <div className="px-4 pb-4 pt-0">
                  <div className="text-zinc-300 text-sm whitespace-pre-wrap border-t border-zinc-700 pt-3">
                    {item.body}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
