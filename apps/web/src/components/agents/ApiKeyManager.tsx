/**
 * API Key Manager — Create, view, and revoke API keys for programmatic access
 */
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useAvailablePermissions,
} from '@/hooks/useApiKeys';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useState } from 'react';
import { Key, Plus, Trash2, Copy, Eye, EyeOff, Shield, Terminal } from 'lucide-react';

const LOAR_SERVER_URL = (import.meta as any).env?.VITE_API_URL || 'https://api.loar.fun';

function hermesMcpConfig(rawKey: string) {
  return JSON.stringify(
    {
      mcpServers: {
        loar: {
          command: 'npx',
          args: ['@loar/mcp-server'],
          env: {
            LOAR_API_KEY: rawKey,
            LOAR_SERVER_URL,
          },
        },
      },
    },
    null,
    2
  );
}

interface Props {
  aiAgentId?: string;
}

export function ApiKeyManager({ aiAgentId }: Props) {
  const { data: keys, isLoading } = useApiKeys();
  const { data: availablePermissions } = useAvailablePermissions();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    permissions: [] as string[],
    rateLimitPerMinute: 60,
    expiresInDays: undefined as number | undefined,
  });

  const filteredKeys = aiAgentId
    ? (keys as any[])?.filter((k: any) => k.aiAgentId === aiAgentId)
    : keys;

  const togglePermission = (p: string) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(p)
        ? prev.permissions.filter((x) => x !== p)
        : [...prev.permissions, p],
    }));
  };

  const allPermissionValues = ((availablePermissions as any[]) ?? []).map((p: any) => p.value);
  const allSelected =
    allPermissionValues.length > 0 && form.permissions.length === allPermissionValues.length;

  const toggleSelectAll = () => {
    setForm((prev) => ({
      ...prev,
      permissions: allSelected ? [] : allPermissionValues,
    }));
  };

  const handleCreate = async () => {
    if (!form.name || form.permissions.length === 0) {
      toast.error('Name and at least one permission required');
      return;
    }

    try {
      const result = await createKey.mutateAsync({
        name: form.name,
        aiAgentId,
        permissions: form.permissions,
        rateLimitPerMinute: form.rateLimitPerMinute,
        expiresInDays: form.expiresInDays,
      });
      setNewKey((result as any).rawKey);
      setForm({ name: '', permissions: [], rateLimitPerMinute: 60, expiresInDays: undefined });
      toast.success('API key created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create key');
    }
  };

  const handleRevoke = async (keyId: string) => {
    try {
      await revokeKey.mutateAsync(keyId);
      toast.success('API key revoked');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyKey = async (key: string) => {
    // navigator.clipboard is undefined outside a secure context (e.g. served
    // over a LAN IP instead of localhost/https), so guard + fall back to the
    // legacy execCommand path. Either way the key stays selectable in the
    // read-only field below, so the user can always Ctrl+C manually.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(key);
      } else {
        const ta = document.createElement('textarea');
        ta.value = key;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('copy command rejected');
      }
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed — select the key and copy manually (Ctrl/Cmd+C)');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Key className="h-5 w-5 text-amber-400" />
          API Keys
        </h3>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)} className="gap-1">
          <Plus className="h-3 w-3" />
          New Key
        </Button>
      </div>

      {/* New key reveal */}
      {newKey && (
        <Card className="border-amber-500/50 bg-amber-500/5 p-4">
          <p className="mb-2 text-sm font-medium text-amber-400">
            Save this key now — it won't be shown again
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={newKey}
              onFocusCapture={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              className="flex-1 rounded bg-zinc-800 px-3 py-2 font-mono text-sm text-white select-all outline-none ring-1 ring-amber-500/30 focus:ring-amber-500/60"
              aria-label="Your new API key"
            />
            <Button size="sm" variant="outline" onClick={() => copyKey(newKey)}>
              <Copy className="mr-1 h-4 w-4" />
              Copy
            </Button>
          </div>
          <div className="mt-4 border-t border-amber-500/20 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                <Terminal className="h-3.5 w-3.5" />
                Connect to Hermes (MCP)
              </p>
              <Button size="sm" variant="outline" onClick={() => copyKey(hermesMcpConfig(newKey))}>
                <Copy className="mr-1 h-3 w-3" />
                Copy config
              </Button>
            </div>
            <p className="mb-2 text-xs text-zinc-400">
              Paste into your Hermes agent's MCP config (or any MCP client) to give it LOAR tools.
            </p>
            <pre className="overflow-x-auto rounded bg-zinc-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-300">
              {hermesMcpConfig(newKey)}
            </pre>
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="mt-2 text-zinc-400"
            onClick={() => setNewKey(null)}
          >
            Dismiss
          </Button>
        </Card>
      )}

      {/* Create form */}
      {showCreate && (
        <Card className="p-4 space-y-3">
          <Input
            placeholder="Key name (e.g. Production Agent)"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-zinc-400">Permissions</p>
              <button
                type="button"
                onClick={toggleSelectAll}
                disabled={allPermissionValues.length === 0}
                className="text-xs font-medium text-amber-400 hover:text-amber-300 disabled:opacity-40"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {(availablePermissions as any[])?.map((p: any) => (
                <Badge
                  key={p.value}
                  variant={form.permissions.includes(p.value) ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => togglePermission(p.value)}
                >
                  {p.label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-400">Rate limit (req/min)</label>
              <Input
                type="number"
                value={form.rateLimitPerMinute}
                onChange={(e) =>
                  setForm((p) => ({ ...p, rateLimitPerMinute: Number(e.target.value) }))
                }
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-400">
                Expires in (days, optional)
              </label>
              <Input
                type="number"
                placeholder="Never"
                value={form.expiresInDays ?? ''}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    expiresInDays: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={createKey.isPending}>
              {createKey.isPending ? 'Creating...' : 'Create Key'}
            </Button>
          </div>
        </Card>
      )}

      {/* Key list */}
      {isLoading ? (
        <div className="py-4 text-center text-zinc-500">Loading...</div>
      ) : !(filteredKeys as any[])?.length ? (
        <Card className="p-4 text-center text-zinc-500">
          <Key className="mx-auto mb-2 h-6 w-6 opacity-50" />
          <p className="text-sm">No API keys yet</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {(filteredKeys as any[]).map((key: any) => (
            <Card key={key.id} className="flex items-center gap-3 p-3">
              <Shield
                className={`h-4 w-4 ${key.status === 'active' ? 'text-green-400' : 'text-zinc-500'}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{key.name}</p>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <code>{key.keyPrefix}...</code>
                  <span>·</span>
                  <span>{key.totalRequests || 0} requests</span>
                  {key.lastUsedAt && (
                    <>
                      <span>·</span>
                      <span>Last used {new Date(key.lastUsedAt).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>
              <Badge
                variant={key.status === 'active' ? 'default' : 'secondary'}
                className="text-xs"
              >
                {key.status}
              </Badge>
              {key.status === 'active' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRevoke(key.id)}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
