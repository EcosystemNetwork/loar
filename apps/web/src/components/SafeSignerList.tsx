/**
 * SafeSignerList — display current Safe owners and threshold
 *
 * Read-only component shown in governance / universe settings
 * when the admin is a Safe multi-sig.
 */
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { Badge } from '@/components/ui/badge';
import { Shield, User, CheckCircle2 } from 'lucide-react';

interface SafeSignerListProps {
  owners: string[];
  threshold: number;
  safeAddress: string;
}

export function SafeSignerList({ owners, threshold, safeAddress }: SafeSignerListProps) {
  const { address } = useAccount();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Multi-Sig Owners
        </h4>
        <Badge variant="outline" className="text-[10px]">
          {threshold}-of-{owners.length}
        </Badge>
      </div>

      <div className="space-y-1.5">
        {owners.map((owner) => {
          const isYou = address && owner.toLowerCase() === address.toLowerCase();
          return (
            <div
              key={owner}
              className="flex items-center justify-between p-2 bg-muted/50 rounded-md"
            >
              <div className="flex items-center gap-2 min-w-0">
                <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <code className="text-xs font-mono truncate">
                  {owner.slice(0, 8)}...{owner.slice(-6)}
                </code>
              </div>
              {isYou && (
                <Badge variant="secondary" className="text-[9px] flex-shrink-0">
                  <CheckCircle2 className="h-2 w-2 mr-1" />
                  You
                </Badge>
              )}
            </div>
          );
        })}
      </div>

      <div className="text-[10px] text-muted-foreground">
        <code className="font-mono text-[9px] break-all">{safeAddress}</code>
      </div>
    </div>
  );
}
