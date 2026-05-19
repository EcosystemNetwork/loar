/**
 * TryItHero — anonymous-first generation CTA on the landing page.
 *
 * Lets a first-time visitor type a prompt and get a video back without
 * connecting a wallet. Hits `POST /api/preview/generate` (rate-limited
 * to 3 generations per IP per 24h, locked to LTX Video / 5s / 512p).
 *
 * On success: inline video preview + "Save this" CTA that routes to /login.
 * On 429: shows the upgrade prompt instead of the form.
 */

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Sparkles, Loader2, Wand2, Save, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

interface PreviewResponse {
  videoUrl: string;
  previewsRemaining: number;
  signInHint: string;
}

interface PreviewError {
  error: string;
  message: string;
  previewsRemaining?: number;
  signInHint?: boolean;
}

const EXAMPLE_PROMPTS = [
  'A neon-soaked detective walking through a rain-slicked alley at midnight',
  'Two dragons coiling around a crumbling cathedral, golden hour light',
  'A cyberpunk hacker reflected in a server room window, electric blue glow',
  'A red carpet flash, paparazzi cameras firing, slow motion',
];

export function TryItHero() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [quotaError, setQuotaError] = useState<PreviewError | null>(null);

  const submit = async () => {
    if (prompt.trim().length < 3) {
      toast.error('Add a few more words to your prompt');
      return;
    }
    setBusy(true);
    setResult(null);
    setQuotaError(null);

    try {
      const res = await fetch(`${SERVER_URL}/api/preview/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = (await res.json()) as PreviewResponse | PreviewError;
      if (!res.ok) {
        if (res.status === 429) {
          setQuotaError(data as PreviewError);
        } else {
          toast.error((data as PreviewError).message || 'Generation failed');
        }
        return;
      }
      setResult(data as PreviewResponse);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  };

  if (quotaError) {
    return (
      <section className="container max-w-4xl mx-auto px-4 py-8">
        <Card className="p-8 border-amber-500/40 bg-gradient-to-br from-amber-500/5 to-orange-500/5 text-center space-y-4">
          <Sparkles className="h-10 w-10 mx-auto text-amber-400" />
          <h2 className="text-xl font-semibold">You hit the daily preview limit</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{quotaError.message}</p>
          <Button
            size="lg"
            onClick={() => navigate({ to: '/login', search: { redirect: '/editor' } })}
          >
            Connect a wallet to keep creating
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section className="container max-w-4xl mx-auto px-4 py-8">
      <Card className="p-6 md:p-8 border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-pink-500/5 to-transparent space-y-5">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/15 text-purple-300 text-xs font-medium">
            <Sparkles className="h-3 w-3" />
            Try LOAR — no wallet needed
          </div>
          <h2 className="text-2xl md:text-3xl font-semibold">Generate a video. Right now.</h2>
          <p className="text-sm text-muted-foreground">
            Type a prompt. Get a 5-second clip in under a minute. 3 free previews — then connect a
            wallet to keep going.
          </p>
        </div>

        {!result && (
          <>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A neon-lit cyberpunk street, slow dolly forward, rain-slicked pavement…"
              rows={3}
              maxLength={500}
              disabled={busy}
              className="resize-none"
            />

            <div className="flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPrompt(p)}
                  disabled={busy}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border/40 hover:border-purple-500/50 hover:bg-purple-500/10 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {p.slice(0, 50)}…
                </button>
              ))}
            </div>

            <Button
              size="lg"
              className="w-full md:w-auto md:mx-auto md:flex"
              disabled={busy || prompt.trim().length < 3}
              onClick={submit}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating… (30–60s)
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Generate preview
                </>
              )}
            </Button>
          </>
        )}

        {result && (
          <div className="space-y-4">
            <video
              src={result.videoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="w-full rounded-lg border border-border/40 bg-black"
            />
            <p className="text-xs text-muted-foreground text-center">
              {result.signInHint} {result.previewsRemaining} previews remaining today.
            </p>
            <div className="flex flex-col md:flex-row gap-2 justify-center">
              <Button
                size="lg"
                onClick={() => navigate({ to: '/login', search: { redirect: '/editor' } })}
              >
                <Save className="h-4 w-4 mr-2" />
                Save & keep creating
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setPrompt('');
                }}
              >
                <RefreshCcw className="h-4 w-4 mr-2" />
                Try another
              </Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
