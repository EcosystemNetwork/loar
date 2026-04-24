/**
 * /edit/outpaint — Outpaint / Reframe / Pan / Zoom-out studio
 *
 * Accepts a source image URL via the `src` search param. If no source is
 * provided the user is shown an empty state with a way to paste a URL.
 */
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { OutpaintStudio } from '@/components/editing/OutpaintStudio';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ImageIcon, ArrowLeft } from 'lucide-react';
import { awaitSessionValidation } from '@/lib/wallet-auth';

export const Route = createFileRoute('/edit/outpaint')({
  validateSearch: z.object({
    src: z.string().url().optional(),
    universeId: z.string().optional(),
    entityId: z.string().optional(),
  }),
  // WEB-6: paid FAL outpaint jobs; wait for /auth/me before mount.
  beforeLoad: async ({ context, location }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    await awaitSessionValidation();
  },
  component: OutpaintPage,
});

function OutpaintPage() {
  const { src, universeId, entityId } = Route.useSearch();
  const navigate = useNavigate();
  const [urlInput, setUrlInput] = useState('');

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/gallery' })}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Reframe & Outpaint</h1>
            <p className="text-sm text-muted-foreground">
              Expand an image beyond its original boundaries — pan, zoom out, or change aspect
              ratio.
            </p>
          </div>
        </div>

        {src ? (
          <OutpaintStudio sourceImageUrl={src} universeId={universeId} entityId={entityId} />
        ) : (
          <Card className="mx-auto max-w-xl p-8 text-center">
            <ImageIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="mb-2 text-lg font-semibold">Choose a source image</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Paste any public image URL to begin. You can also open this page from any gallery
              item.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="https://…/image.png"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
              />
              <Button
                disabled={!urlInput.trim()}
                onClick={() => {
                  const trimmed = urlInput.trim();
                  try {
                    // Validate before navigating
                    new URL(trimmed);
                    navigate({
                      to: '/edit/outpaint',
                      search: { src: trimmed, universeId, entityId },
                    });
                  } catch {
                    // Invalid URL — no-op, leave field focused
                  }
                }}
              >
                Load
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
