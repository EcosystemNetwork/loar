/**
 * /settings/agent-keys — LOAR API keys for external agents.
 *
 * These are the `loar_`-prefixed keys you HAND TO an external agent (e.g. a
 * Hermes agent, the MCP server, a script) so it can control LOAR on your
 * behalf — create entities, generate media, mint, submit canon, etc. Each key
 * is scoped to a set of permissions and a rate limit.
 *
 * This is the OPPOSITE direction of /settings/api-keys (BYOK), where you give
 * LOAR *your* provider keys so it can call third-party models for you.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useWalletAuth } from '@/lib/wallet-auth';
import { ApiKeyManager } from '@/components/agents/ApiKeyManager';
import { Card, CardContent } from '@/components/ui/card';
import { Bot, KeyRound, ArrowRight } from 'lucide-react';

export const Route = createFileRoute('/settings/agent-keys')({
  component: AgentKeysPage,
});

function AgentKeysPage() {
  const { address } = useWalletAuth();

  if (!address) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Agent API Keys</h1>
        <p className="text-muted-foreground mt-2">
          Connect a wallet to issue keys for your agents.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Bot className="h-7 w-7 text-amber-400" />
          Agent API Keys
        </h1>
        <p className="text-muted-foreground text-sm mt-2">
          Issue a <code className="text-amber-300">loar_</code> key and hand it to an external agent
          — a Hermes agent, the MCP server, or any script — so it can control LOAR on your behalf.
          Each key is scoped to the permissions and rate limit you choose. The secret is shown once
          at creation, so copy it immediately.
        </p>
      </div>

      {/* Disambiguation callout: this is NOT the BYOK page. */}
      <Card className="bg-zinc-950/40 border-white/5">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <KeyRound className="h-4 w-4 text-violet-400 mt-0.5 flex-shrink-0" />
            <span>
              Looking to plug in <strong className="text-foreground">your own</strong> OpenAI /
              Google / fal keys so LOAR runs models on your quota? That's the opposite direction —
              go to{' '}
              <Link
                to="/settings/api-keys"
                className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1"
              >
                Provider Keys (BYOK)
                <ArrowRight className="h-3 w-3" />
              </Link>
              .
            </span>
          </p>
        </CardContent>
      </Card>

      <ApiKeyManager />
    </div>
  );
}
