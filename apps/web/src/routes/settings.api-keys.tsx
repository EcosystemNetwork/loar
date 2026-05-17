/**
 * /settings/api-keys — Bring-Your-Own-Key (BYOK) for external providers.
 *
 * Currently supports ByteDance ModelArk (Seedance / Seedream / Seed 2.0).
 * Keys are encrypted at rest server-side; never returned to the client. UI
 * shows only the trailing 4 chars of a stored key for confirmation.
 */
import { createFileRoute } from '@tanstack/react-router';
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
import { ExternalLink, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';

export const Route = createFileRoute('/settings/api-keys')({
  component: ApiKeysPage,
});

type Provider = 'bytedance' | 'zai' | 'openai' | 'google' | 'fal' | 'elevenlabs' | 'meshy';

const PROVIDER_META: Record<
  Provider,
  {
    label: string;
    blurb: string;
    docsUrl: string;
    placeholder: string;
    fallbackNote: string;
  }
> = {
  bytedance: {
    label: 'ByteDance ModelArk',
    blurb:
      'Powers Seedance 2.0 (video), Seedream 5.0 (images), Seed 2.0 (planning), and OmniHuman talking-scenes. Plug in your own key and the platform spends your ModelArk credits instead of ours.',
    docsUrl: 'https://docs.byteplus.com/en/docs/ModelArk/',
    placeholder: 'Paste your ModelArk API key…',
    fallbackNote:
      'When no key is set, generation runs on the platform key (subject to shared quotas).',
  },
  zai: {
    label: 'Z.AI (GLM)',
    blurb:
      'Powers GLM-4.6 / GLM-5.x reasoning, GLM-5V vision, CogView-4 image, CogVideoX-3 video, GLM-ASR transcription, and Web Search / Web Reader tools. Used by /lab/zai, the worldbuild planner, canon-consistency checks, and the governance agent.',
    docsUrl: 'https://docs.z.ai/llms.txt',
    placeholder: 'Paste your Z.AI API key…',
    fallbackNote:
      'When no key is set, Z.AI calls run on the platform key (ZAI_API_KEY). Plug in your own to spend your own quota.',
  },
  google: {
    label: 'Google AI (Imagen + Gemini)',
    blurb:
      'Powers Imagen 4 / nano-banana-pro image generation, Gemini 2.5 Pro video analysis, character image analysis, and prompt enhancement. The default image model across the studio.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    placeholder: 'Paste your Google AI Studio key (AIza…)…',
    fallbackNote:
      'When no key is set, Google calls run on the platform key (GOOGLE_API_KEY). Plug in your own to spend your own quota.',
  },
  fal: {
    label: 'fal.ai',
    blurb:
      "Powers FLUX, Veo3, Sora 2, Kling, Runway Gen-3, WAN, PixVerse, Stable Audio, MusicGen, LoRA training, inpainting/outpainting, upscaling, frame interpolation, and background removal. The studio's broadest provider.",
    docsUrl: 'https://fal.ai/dashboard/keys',
    placeholder: 'Paste your fal.ai key (uuid:secret)…',
    fallbackNote:
      'When no key is set, FAL calls run on the platform key (FAL_KEY). Plug in your own to spend your own quota.',
  },
  elevenlabs: {
    label: 'ElevenLabs',
    blurb:
      'Powers text-to-speech, voice cloning, voice design, sound effects, and the talking-scene pipeline. Voice/audio backbone for narration and dialogue.',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    placeholder: 'Paste your ElevenLabs API key…',
    fallbackNote:
      'When no key is set, ElevenLabs calls run on the platform key (ELEVENLABS_API_KEY). Plug in your own to spend your own quota.',
  },
  meshy: {
    label: 'Meshy (3D)',
    blurb:
      'Powers text-to-3D, image-to-3D, multi-image-to-3D, and re-texturing in the character pipeline. Generates GLB / FBX / OBJ assets for the studio.',
    docsUrl: 'https://www.meshy.ai/api',
    placeholder: 'Paste your Meshy API key (msy_…)…',
    fallbackNote:
      'When no key is set, Meshy calls run on the platform key (MESHY_API_KEY). Plug in your own to spend your own quota.',
  },
  openai: {
    label: 'OpenAI',
    blurb:
      'Used as a fallback LLM and for select OpenAI-only features (GPT-Image, embeddings, transcription).',
    docsUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'Paste your OpenAI key (sk-…)…',
    fallbackNote:
      'When no key is set, OpenAI calls run on the platform key (OPENAI_API_KEY). Plug in your own to spend your own quota.',
  },
};

// The new `providers.upsertKey` mutation tests every key against the provider
// before persisting — bad keys never hit disk. The legacy "test then save"
// double-call pattern is no longer needed.
const TESTABLE_PROVIDERS = new Set<Provider>(['bytedance', 'zai']);
void TESTABLE_PROVIDERS;

function ApiKeysPage() {
  const { address } = useWalletAuth();

  if (!address) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">API Keys</h1>
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
          API Keys
        </h1>
        <p className="text-muted-foreground text-sm mt-2">
          Plug in your own provider keys and the platform routes your generation calls through them.
          Keys are encrypted at rest with AES-256-GCM and never returned to the browser.
        </p>
      </div>

      <ProviderCard provider="bytedance" />
      <ProviderCard provider="zai" />
      <ProviderCard provider="google" />
      <ProviderCard provider="fal" />
      <ProviderCard provider="elevenlabs" />
      <ProviderCard provider="meshy" />
      <ProviderCard provider="openai" />

      <Card className="bg-zinc-950/40 border-white/5">
        <CardContent className="pt-6 text-xs text-muted-foreground space-y-2">
          <p className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Keys are encrypted with a server-held master key (AES-256-GCM). The browser only ever
            sees the trailing 4 chars of a stored key for confirmation.
          </p>
          <p>
            We never log, mirror, or share your keys. To rotate, paste a new value. To stop using
            BYOK, click "Remove" — the platform falls back to the shared key.
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
                <Badge variant="secondary">Using platform key</Badge>
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
          <p className="text-sm text-muted-foreground italic">{meta.fallbackNote}</p>
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
