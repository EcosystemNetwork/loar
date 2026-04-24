/**
 * /studio/edit/$assetId — LOAR Edit Canvas.
 *
 * Single, asset-scoped, versioned edit surface. Wraps the existing `editing`
 * router's FAL-backed inpaint path with a non-destructive version chain so
 * every edit creates a traceable child of the parent asset.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { EditCanvasShell } from '@/components/edit-canvas/EditCanvasShell';
import { awaitSessionValidation } from '@/lib/wallet-auth';

export const Route = createFileRoute('/studio/edit/$assetId')({
  // WEB-6: await server-side session check before paid FAL edit jobs become reachable.
  beforeLoad: async ({ context, location }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    await awaitSessionValidation();
  },
  component: StudioEditPage,
});

function StudioEditPage() {
  const { assetId } = Route.useParams();
  return (
    <div className="min-h-screen bg-background">
      <EditCanvasShell assetId={assetId} />
    </div>
  );
}
