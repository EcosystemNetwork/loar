/**
 * Web3ModeToggle — Switch between Web2 and Web3 UI.
 *
 * Compact toggle for the header or settings page.
 * Shows a subtle indicator that can be placed anywhere.
 */

import { useWeb3Mode } from '@/lib/web3-mode';
import { Button } from '@/components/ui/button';
import { Blocks, Eye } from 'lucide-react';

export function Web3ModeToggle() {
  const { web3Mode, setWeb3Mode } = useWeb3Mode();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setWeb3Mode(!web3Mode)}
      className={web3Mode ? 'text-primary' : 'text-muted-foreground'}
      title={
        web3Mode
          ? 'Web3 mode: ON — showing blockchain details'
          : 'Standard mode — click to show Web3 details'
      }
    >
      {web3Mode ? <Blocks className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  );
}
