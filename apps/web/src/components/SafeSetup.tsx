/**
 * SafeSetup — Configure multi-sig ownership during universe creation
 *
 * Provides a collapsible section with:
 *   - Toggle to enable multi-sig
 *   - Co-owner address inputs (user is auto-included)
 *   - Threshold selector
 *   - Deploy Safe button
 */
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { isAddress } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useSafe } from '@/hooks/useSafe';
import { Shield, Plus, X, Loader2, CheckCircle2, AlertCircle, Users } from 'lucide-react';

interface SafeSetupProps {
  disabled?: boolean;
  onSafeDeployed: (safeAddress: string) => void;
  onDisabled: () => void;
}

export function SafeSetup({ disabled, onSafeDeployed, onDisabled }: SafeSetupProps) {
  const { address } = useAccount();
  const { deploySafe, isLoading, error } = useSafe();

  const [enabled, setEnabled] = useState(false);
  const [coOwners, setCoOwners] = useState<string[]>(['']);
  const [threshold, setThreshold] = useState(2);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);

  const allOwners = address ? [address, ...coOwners.filter((o) => isAddress(o))] : [];
  const uniqueOwners = [...new Set(allOwners.map((o) => o.toLowerCase()))];
  const hasDuplicates = allOwners.length !== uniqueOwners.length;
  const validCoOwners = coOwners.filter((o) => isAddress(o));
  const canDeploy =
    !disabled &&
    !isLoading &&
    validCoOwners.length >= 1 &&
    !hasDuplicates &&
    threshold >= 1 &&
    threshold <= uniqueOwners.length &&
    !deployedAddress;

  const handleToggle = () => {
    if (enabled) {
      setEnabled(false);
      setDeployedAddress(null);
      setCoOwners(['']);
      setThreshold(2);
      onDisabled();
    } else {
      setEnabled(true);
    }
  };

  const handleAddOwner = () => {
    setCoOwners([...coOwners, '']);
  };

  const handleRemoveOwner = (index: number) => {
    const next = coOwners.filter((_, i) => i !== index);
    setCoOwners(next.length === 0 ? [''] : next);
    if (threshold > next.filter((o) => isAddress(o)).length + 1) {
      setThreshold(Math.max(1, next.filter((o) => isAddress(o)).length + 1));
    }
  };

  const handleOwnerChange = (index: number, value: string) => {
    const next = [...coOwners];
    next[index] = value;
    setCoOwners(next);
  };

  const handleDeploy = async () => {
    if (!address) return;

    const owners = [address, ...validCoOwners];
    const safeAddr = await deploySafe(owners, threshold);
    setDeployedAddress(safeAddr);
    onSafeDeployed(safeAddr);
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled && !enabled}
        className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <Shield className="h-4 w-4" />
        Multi-Sig Ownership
        <Badge variant={enabled ? 'default' : 'outline'} className="text-[10px] px-1.5 py-0">
          {enabled ? 'Enabled' : 'Off'}
        </Badge>
      </button>

      {enabled && (
        <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
          {deployedAddress ? (
            <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-green-600">Safe Deployed</p>
                <code className="text-xs text-muted-foreground break-all">{deployedAddress}</code>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                <span>
                  Add co-owners who will share admin control. You are automatically included.
                </span>
              </div>

              {/* Current user (auto-included) */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Owner 1 (You)</Label>
                <Input value={address ?? ''} disabled className="h-9 text-xs font-mono bg-muted" />
              </div>

              {/* Co-owner inputs */}
              {coOwners.map((owner, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium">Owner {i + 2}</Label>
                    {coOwners.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveOwner(i)}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <Input
                    placeholder="0x..."
                    value={owner}
                    onChange={(e) => handleOwnerChange(i, e.target.value)}
                    disabled={disabled}
                    className={`h-9 text-xs font-mono ${
                      owner && !isAddress(owner) ? 'border-red-500' : ''
                    }`}
                  />
                  {owner && !isAddress(owner) && (
                    <p className="text-[10px] text-red-500">Invalid address</p>
                  )}
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddOwner}
                disabled={disabled}
                className="w-full h-8 text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Owner
              </Button>

              {/* Threshold selector */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Confirmation Threshold</Label>
                <div className="flex items-center gap-2">
                  <select
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    disabled={disabled}
                    className="h-9 px-3 rounded-md border bg-background text-sm"
                  >
                    {Array.from({ length: uniqueOwners.length }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">
                    of {uniqueOwners.length} owners required to execute
                  </span>
                </div>
              </div>

              {hasDuplicates && (
                <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-500">
                  <AlertCircle className="h-3 w-3 flex-shrink-0" />
                  Duplicate owner addresses detected
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-500">
                  <AlertCircle className="h-3 w-3 flex-shrink-0" />
                  {error.message}
                </div>
              )}

              <Button
                type="button"
                onClick={handleDeploy}
                disabled={!canDeploy}
                className="w-full h-10 text-sm font-bold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deploying Safe...
                  </>
                ) : (
                  <>
                    <Shield className="h-4 w-4 mr-2" />
                    Deploy Multi-Sig Wallet
                  </>
                )}
              </Button>

              <p className="text-[10px] text-muted-foreground text-center">
                Deploys a Gnosis Safe. The Safe address becomes the universe admin.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
