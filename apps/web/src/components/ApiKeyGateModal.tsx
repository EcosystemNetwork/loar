/**
 * ApiKeyGateModal — the popup that unlocks a BYOK-gated model.
 *
 * Singleton, mounted once in `__root.tsx`. Listens on `apiKeyGate.ts`'s
 * imperative channel; any call to `requireProviderKey(provider)` anywhere
 * in the app (ModelSelector, CaptionsPanel, the 3D pipeline, or the global
 * mutation-error handler in utils/query-client.ts) opens this dialog.
 * Saving a key resolves the caller's promise `true` so it can retry the
 * generation it was blocked on; dismissing resolves `false`.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { registerApiKeyGateListener, type ApiKeyGateRequest } from '@/lib/apiKeyGate';
import { PROVIDER_META, isKnownProviderMeta } from '@/lib/providerMeta';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExternalLink, KeyRound, Lock } from 'lucide-react';

export function ApiKeyGateModal() {
  const [request, setRequest] = useState<ApiKeyGateRequest | null>(null);
  const [value, setValue] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => registerApiKeyGateListener(setRequest), []);

  const meta =
    request && isKnownProviderMeta(request.provider) ? PROVIDER_META[request.provider] : null;

  const setKey = useMutation({
    mutationFn: (apiKey: string) =>
      trpcClient.providers.upsertKey.mutate({ provider: request!.provider as any, apiKey }),
    onSuccess: () => {
      toast.success(`${meta?.label ?? request?.provider} key saved — you can generate now.`);
      queryClient.invalidateQueries({ queryKey: ['providers', 'listKeys'] });
      // Every model-catalog query keys off ['model-catalog', ...] or calls
      // providers.listModels / <mode>.listModels — broad invalidation here
      // is cheap (these are cheap, cached queries) and guarantees every
      // open picker re-flags this provider's models as usable.
      queryClient.invalidateQueries({ queryKey: ['providers', 'listModels'] });
      queryClient.invalidateQueries({ queryKey: ['model-catalog'] });
      request?.resolve(true);
      close();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  function close() {
    setRequest(null);
    setValue('');
    setKey.reset();
  }

  function handleDismiss(open: boolean) {
    if (open) return;
    request?.resolve(false);
    close();
  }

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setKey.mutate(trimmed);
  }

  return (
    <Dialog open={!!request} onOpenChange={handleDismiss}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-violet-400" />
            {meta ? `Connect ${meta.label}` : 'Connect your API key'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {request?.reason ??
              'This model needs your own API key — LOAR has no shared platform key to fall back on for it.'}
          </p>
          {meta && <p className="text-sm text-muted-foreground">{meta.blurb}</p>}

          <div className="space-y-2">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              placeholder={meta?.placeholder ?? 'Paste your API key…'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              className="font-mono text-sm"
            />
            <div className="flex items-center justify-between gap-3">
              {meta ? (
                <a
                  href={meta.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  Get a key <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span />
              )}
              <Button onClick={handleSave} disabled={!value.trim() || setKey.isPending} size="sm">
                <KeyRound className="h-3.5 w-3.5" />
                {setKey.isPending ? 'Saving…' : 'Save & unlock'}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Keys are encrypted at rest and tested against the provider before saving — a bad key
            never gets stored. Manage every key at{' '}
            <a href="/settings/api-keys" className="underline hover:text-foreground">
              Settings → Provider Keys
            </a>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
