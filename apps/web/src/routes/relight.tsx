/**
 * /relight — Standalone relight workbench.
 *
 * Accepts ?image=<url>&universe=<address>&attachment=<id>&generation=<id>
 * so it can be linked-to from a gallery card, entity detail view, or
 * generation history entry. Renders the RelightPanel, which handles the
 * full flow (preset stacking, tone pack selection, mutation, preview).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Wand2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RelightPanel } from '@/components/RelightPanel';

const searchSchema = z.object({
  image: z.string().url().optional(),
  universe: z.string().optional(),
  attachment: z.string().optional(),
  generation: z.string().optional(),
});

export const Route = createFileRoute('/relight')({
  validateSearch: searchSchema,
  component: RelightPage,
});

function RelightPage() {
  const search = Route.useSearch();
  const [manualUrl, setManualUrl] = useState('');
  const resolvedUrl = search.image || manualUrl;

  return (
    <div className="container mx-auto space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Wand2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Relight Studio</h1>
          <p className="text-sm text-muted-foreground">
            Golden hour, neon night, moonlit alley, warm tavern, cold wasteland — same character,
            new atmosphere. Subject identity is locked.
          </p>
        </div>
      </div>

      {!search.image && (
        <div className="max-w-xl space-y-2 rounded-lg border bg-card p-4">
          <Label htmlFor="relight-source-url">Source Image URL</Label>
          <div className="flex gap-2">
            <Input
              id="relight-source-url"
              placeholder="https://… or ipfs://…"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setManualUrl(manualUrl.trim())}
              disabled={!manualUrl.trim()}
            >
              Load
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: open this page from a gallery card or entity image to auto-load the source.
          </p>
        </div>
      )}

      {resolvedUrl ? (
        <RelightPanel
          imageUrl={resolvedUrl}
          universeAddress={search.universe}
          sourceAttachmentId={search.attachment}
          sourceGenerationId={search.generation}
        />
      ) : null}
    </div>
  );
}
