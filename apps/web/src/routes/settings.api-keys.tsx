/**
 * /settings/api-keys — every key that moves between you and LOAR, in one place.
 *
 *  - Provider keys (BYOK): YOUR third-party keys (OpenAI, Google, fal, …) that
 *    LOAR uses to run models on your quota. Required, not optional: dispatch
 *    has no platform-pool fallback, so a model stays locked (see
 *    ApiKeyGateModal) until its provider has a key here. Encrypted at rest
 *    server-side and never returned to the client — the UI only sees the
 *    trailing 4 chars.
 *  - Agent keys: `loar_` keys YOU hand to an external agent/script so it can
 *    control LOAR on your behalf.
 *
 * The active tab lives in `?tab=` so links (and the gate modal) can deep-link.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { Bot, KeyRound, ShieldCheck } from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useApiKeys } from '@/hooks/useApiKeys';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiKeyManager } from '@/components/agents/ApiKeyManager';
import { ProviderKeysPanel } from '@/components/settings/ProviderKeysPanel';

export const Route = createFileRoute('/settings/api-keys')({
  validateSearch: z.object({
    tab: z.enum(['providers', 'agents']).optional().catch(undefined),
  }),
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const { address } = useWalletAuth();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: agentKeys } = useApiKeys();

  if (!address) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="text-muted-foreground mt-2">Connect a wallet to manage your API keys.</p>
      </div>
    );
  }

  const activeAgentKeys = ((agentKeys as { status: string }[] | undefined) ?? []).filter(
    (k) => k.status === 'active'
  ).length;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="h-7 w-7 text-violet-400" />
          API Keys
        </h1>
        <p className="text-muted-foreground text-sm mt-2">
          Keys going <strong className="text-foreground">in</strong> (your provider keys, so LOAR
          runs models on your quota) and keys going <strong className="text-foreground">out</strong>{' '}
          (keys you hand to agents and scripts). A model stays locked until you add a key for its
          provider — there's no shared platform key to fall back on.
        </p>
      </div>

      <Tabs
        value={tab ?? 'providers'}
        onValueChange={(next) =>
          navigate({ search: { tab: next as 'providers' | 'agents' }, replace: true })
        }
        className="space-y-5"
      >
        <TabsList className="h-auto">
          <TabsTrigger value="providers" className="gap-2">
            <KeyRound className="h-4 w-4 text-violet-400" />
            Provider keys
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-2">
            <Bot className="h-4 w-4 text-amber-400" />
            Agent keys
            {activeAgentKeys > 0 && (
              <span className="rounded-full bg-amber-500/20 text-amber-300 px-1.5 text-xs tabular-nums">
                {activeAgentKeys}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="space-y-5 mt-0">
          <ProviderKeysPanel
            onAgentKeysClick={() => navigate({ search: { tab: 'agents' }, replace: true })}
          />
        </TabsContent>

        <TabsContent value="agents" className="space-y-4 mt-0">
          <p className="text-sm text-muted-foreground">
            Hand a <code className="text-amber-300">loar_</code> key to an agent (a Hermes agent,
            the MCP server, a script) so it can create entities, generate media, mint and submit
            canon on your behalf. Each key is scoped to the permissions and rate limit you pick; the
            secret is shown <strong className="text-foreground">once</strong> at creation.
          </p>
          <ApiKeyManager />
        </TabsContent>
      </Tabs>

      <Card className="bg-zinc-950/40 border-white/5">
        <CardContent className="pt-6 text-xs text-muted-foreground space-y-2">
          <p className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
            Provider keys are encrypted with a server-held master key (AES-256-GCM). The browser
            only ever sees the trailing 4 chars of a stored key.
          </p>
          <p>
            We never log, mirror, or share your keys. To rotate, paste a new value. Removing a
            provider key re-locks every model on that provider.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
