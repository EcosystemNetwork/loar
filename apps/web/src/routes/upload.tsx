import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useWalletAuth, awaitSessionValidation } from '@/lib/wallet-auth';
import { UploadForm } from '@/components/UploadForm';
import { Loader2 } from 'lucide-react';

export const Route = createFileRoute('/upload')({
  // WEB-6: block route entry until the server-side /auth/me check resolves.
  // Otherwise the localStorage-hydrated "authenticated" state lets the
  // UploadForm queue mutations in the 0-500ms window before the cookie is
  // confirmed live.
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/upload' } });
    }
    await awaitSessionValidation();
  },
  component: UploadPage,
  validateSearch: (search: Record<string, unknown>): { universeId?: string } => ({
    universeId: (search.universeId as string) || undefined,
  }),
});

function UploadPage() {
  const { universeId } = Route.useSearch();
  const { isAuthenticated, isAuthenticating, sessionReady } = useWalletAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (sessionReady && !isAuthenticated && !isAuthenticating) {
      navigate({ to: '/login', search: { redirect: '/upload' } });
    }
  }, [isAuthenticated, isAuthenticating, sessionReady, navigate]);

  if (isAuthenticating || !sessionReady) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2">Upload Content</h1>
        <p className="text-muted-foreground mb-8">Share your work with the community</p>
        <UploadForm
          defaultUniverseId={universeId}
          onSuccess={() => navigate({ to: '/dashboard' })}
          onCancel={() => navigate({ to: '/dashboard' })}
        />
      </div>
    </div>
  );
}
