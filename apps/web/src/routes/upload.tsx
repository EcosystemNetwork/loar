import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { UploadForm } from '@/components/UploadForm';
import { Loader2 } from 'lucide-react';

export const Route = createFileRoute('/upload')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/upload' } });
    }
  },
  component: UploadPage,
  validateSearch: (search: Record<string, unknown>): { universeId?: string } => ({
    universeId: (search.universeId as string) || undefined,
  }),
});

function UploadPage() {
  const { universeId } = Route.useSearch();
  const { isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated && !isAuthenticating) {
      navigate({ to: '/login', search: { redirect: '/upload' } });
    }
  }, [isAuthenticated, isAuthenticating, navigate]);

  if (isAuthenticating) {
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
