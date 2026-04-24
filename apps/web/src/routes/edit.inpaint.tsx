/**
 * /edit/inpaint — Generative Fill / Remove / Replace / Fix studio
 *
 * Source image is passed via the `src` search param. If none is provided,
 * the user lands on a paste-URL empty state.
 */
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { InpaintStudio } from '@/components/editing/InpaintStudio';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Wand2, ArrowLeft } from 'lucide-react';
import { awaitSessionValidation } from '@/lib/wallet-auth';

export const Route = createFileRoute('/edit/inpaint')({
  validateSearch: z.object({
    src: z.string().url().optional(),
    sourceGenerationId: z.string().optional(),
    universeId: z.string().optional(),
  }),
  // WEB-6: paid FAL inpaint jobs; wait for /auth/me before mount.
  beforeLoad: async ({ context, location }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    await awaitSessionValidation();
  },
  component: InpaintPage,
});

function InpaintPage() {
  const { src, sourceGenerationId, universeId } = Route.useSearch();
  const navigate = useNavigate();
  const [urlInput, setUrlInput] = useState('');

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/gallery' })}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-purple-400" />
              <h1 className="text-xl font-semibold">Inpaint · Remove · Replace · Fill</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Mask a region, then replace it, remove it, add something new, or fix details. Results
              appear in your gallery automatically.
            </p>
          </div>
        </div>

        {src ? (
          <InpaintStudio
            sourceImageUrl={src}
            sourceGenerationId={sourceGenerationId}
            universeId={universeId}
          />
        ) : (
          <Card className="p-10">
            <div className="max-w-md mx-auto space-y-4 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-muted/20 flex items-center justify-center">
                <Wand2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <h2 className="font-medium">Load an image to edit</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Paste a URL from your gallery or from anywhere on the web.
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://…"
                  className="h-9 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && urlInput.trim()) {
                      navigate({
                        to: '/edit/inpaint',
                        search: { src: urlInput.trim() },
                      });
                    }
                  }}
                />
                <Button
                  onClick={() => {
                    if (urlInput.trim()) {
                      navigate({
                        to: '/edit/inpaint',
                        search: { src: urlInput.trim() },
                      });
                    }
                  }}
                  disabled={!urlInput.trim()}
                >
                  Load
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Tip: use the <strong>Edit</strong> button on any gallery card to jump in faster.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
