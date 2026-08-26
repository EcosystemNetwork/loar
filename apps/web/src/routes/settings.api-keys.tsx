/**
 * /settings/api-keys — Bring-Your-Own-Key (BYOK) for external providers.
 *
 * BYOK is required, not optional: dispatch has no platform-pool fallback —
 * a model stays locked (see ApiKeyGateModal) until the user adds their own
 * key for its provider here. Keys are encrypted at rest server-side; never
 * returned to the client. UI shows only the trailing 4 chars of a stored
 * key for confirmation.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ApiKeyManager } from '@/components/agents/ApiKeyManager';
import { PROVIDER_META, type Provider } from '@/lib/providerMeta';
import { ArrowRight, Bot, ExternalLink, KeyRound, Lock, ShieldCheck, Trash2 } from 'lucide-react';

export const Route = createFileRoute('/settings/api-keys')({
  component: ApiKeysPage,
});

const ALL_PROVIDERS = Object.keys(PROVIDER_META) as Provider[];

function ApiKeysPage() {
  const { address } = useWalletAuth();

  if (!address) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Provider Keys (BYOK)</h1>
        <p className="text-muted-foreground mt-2">
          Connect a wallet to manage your bring-your-own-key settings.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="h-7 w-7 text-violet-400" />
          Provider Keys (BYOK)
        </h1>
        <p className="text-muted-foreground text-sm mt-2">
          Plug in <strong className="text-foreground">your own</strong> third-party provider keys
          (OpenAI, Google, fal, …) and the platform routes your generation calls through them. Keys
          are encrypted at rest with AES-256-GCM and never returned to the browser.{' '}
          <strong className="text-foreground">
            A model is locked until you add a key for its provider
          </strong>{' '}
          — there's no shared platform key to fall back on.
        </p>
      </div>

      {/* Agent API keys — issue a loar_ key for an external agent to control LOAR.
          Surfaced inline here (not just at /settings/agent-keys) because users
          land on "api-keys" expecting exactly this. Same generator, same backend. */}
      <Card className="border-amber-500/30 bg-amber-500/[0.03]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-300">
            <Bot className="h-5 w-5" />
            Agent API Keys
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Want a key to <strong className="text-foreground">hand to an agent</strong> (a Hermes
            agent, the MCP server, a script) so it can control LOAR on your behalf — create
            entities, generate media, mint, submit canon? Mint one here. Each{' '}
            <code className="text-amber-300">loar_</code> key is scoped to the permissions and rate
            limit you pick, and the secret is shown{' '}
            <strong className="text-foreground">once</strong> at creation. Full page:{' '}
            <Link
              to="/settings/agent-keys"
              className="text-amber-300 hover:text-amber-200 inline-flex items-center gap-1"
            >
              Agent API Keys
              <ArrowRight className="h-3 w-3" />
            </Link>
            .
          </p>
        </CardHeader>
        <CardContent>
          <ApiKeyManager />
        </CardContent>
      </Card>

      <div className="border-t border-white/5 pt-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-violet-400" />
          Provider Keys (BYOK)
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          The opposite direction: plug in <strong className="text-foreground">your own</strong>{' '}
          third-party provider keys so LOAR runs models on your quota.
        </p>
      </div>

      {ALL_PROVIDERS.map((provider) => (
        <ProviderCard key={provider} provider={provider} />
      ))}

      <Card className="bg-zinc-950/40 border-white/5">
        <CardContent className="pt-6 text-xs text-muted-foreground space-y-2">
          <p className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Keys are encrypted with a server-held master key (AES-256-GCM). The browser only ever
            sees the trailing 4 chars of a stored key for confirmation.
          </p>
          <p>
            We never log, mirror, or share your keys. To rotate, paste a new value. Removing a key
            re-locks every model on that provider — there is no shared platform key it falls back
            to.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const meta = PROVIDER_META[provider];
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');

  const { data: keys, isLoading } = useQuery({
    queryKey: ['providers', 'listKeys'],
    queryFn: () => trpcClient.providers.listKeys.query(),
    refetchOnWindowFocus: false,
  });

  const stored = useMemo(() => {
    if (!keys) return null;
    return keys.find((k) => k.provider === provider) ?? null;
  }, [keys, provider]);

  const setKey = useMutation({
    mutationFn: (v: string) => trpcClient.providers.upsertKey.mutate({ provider, apiKey: v }),
    onSuccess: () => {
      toast.success(`${meta.label} key saved`);
      setValue('');
      queryClient.invalidateQueries({ queryKey: ['providers', 'listKeys'] });
      queryClient.invalidateQueries({ queryKey: ['providers', 'listModels'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  const clearKey = useMutation({
    mutationFn: () => trpcClient.providers.deleteKey.mutate({ provider }),
    onSuccess: () => {
      toast.success(`${meta.label} key removed`);
      queryClient.invalidateQueries({ queryKey: ['providers', 'listKeys'] });
      queryClient.invalidateQueries({ queryKey: ['providers', 'listModels'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Remove failed'),
  });

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // `providers.upsertKey` server-side runs the provider's test endpoint
    // before persisting. No separate test call needed.
    setKey.mutate(trimmed);
  };

  return (
    <Card className="bg-zinc-900/40 border-white/10">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {meta.label}
              {stored ? (
                <Badge
                  variant="default"
                  className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                >
                  Active
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 gap-1"
                >
                  <Lock className="h-2.5 w-2.5" />
                  Locked
                </Badge>
              )}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{meta.blurb}</p>
          </div>
          <a
            href={meta.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 flex-shrink-0"
          >
            Docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : stored ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="font-mono text-emerald-300">
                •••• {stored.last4 || stored.fingerprint.slice(-4)}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={clearKey.isPending}
                onClick={() => clearKey.mutate()}
                className="text-red-400 hover:text-red-300 gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Saved {new Date(stored.createdAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic flex items-center gap-1.5">
            <Lock className="h-3 w-3 flex-shrink-0" />
            {meta.lockedNote}
          </p>
        )}

        <div className="space-y-2">
          <Label
            htmlFor={`${provider}-key`}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {stored ? 'Replace with new key' : 'Add a key'}
          </Label>
          <div className="flex gap-2">
            <Input
              id={`${provider}-key`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={meta.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 font-mono text-sm"
            />
            <Button onClick={handleSave} disabled={!value.trim() || setKey.isPending}>
              {setKey.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Keys are encrypted before storage. We test once on save to confirm auth.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
