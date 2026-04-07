import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useWalletAuth } from '@/lib/wallet-auth';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { UploadForm } from '@/components/UploadForm';
import { Loader2 } from 'lucide-react';

export const Route = createFileRoute('/upload')({
  component: UploadPage,
});

function UploadPage() {
  const { isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();

  if (isAuthenticating) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin border-b-2 border-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <h2 className="text-xl font-semibold">Connect your wallet to upload content</h2>
        <WalletConnectButton size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2">Upload Content</h1>
        <p className="text-muted-foreground mb-8">Share your work with the community</p>
        <UploadForm
          onSuccess={() => navigate({ to: '/dashboard' })}
          onCancel={() => navigate({ to: '/dashboard' })}
        />
      </div>
    </div>
  );
}
