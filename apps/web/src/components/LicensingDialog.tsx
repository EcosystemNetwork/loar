/**
 * LicensingDialog — Create or browse IP licenses for universe content.
 *
 * Universe owners can license IP (streaming, merch, gaming, etc.)
 * and licensees can view active licenses.
 */
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Loader2, X, Plus, CheckCircle2, Clock, DollarSign, Scale } from 'lucide-react';

interface LicensingDialogProps {
  universeId: string;
  universeName?: string;
  isOwner?: boolean;
  onClose: () => void;
}

const LICENSE_TYPES = ['STREAMING', 'MERCH', 'GAMING', 'COMIC', 'AUDIO', 'OTHER'] as const;

export function LicensingDialog({
  universeId,
  universeName,
  isOwner,
  onClose,
}: LicensingDialogProps) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [licenseType, setLicenseType] = useState<string>('STREAMING');
  const [licensee, setLicensee] = useState('');
  const [upfrontFee, setUpfrontFee] = useState('0');
  const [royaltyBps, setRoyaltyBps] = useState('500');
  const [durationDays, setDurationDays] = useState('365');
  const [terms, setTerms] = useState('');

  const { data: licenses, isLoading } = useQuery({
    queryKey: ['licenses', universeId],
    queryFn: () => trpcClient.licensing.getLicenses.query({ universeId }),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => trpcClient.licensing.createLicense.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['licenses', universeId] });
      toast.success('License created');
      setShowCreate(false);
    },
  });

  const activateMutation = useMutation({
    mutationFn: (data: { licenseId: string; txHash?: string }) =>
      trpcClient.licensing.activateLicense.mutate(data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['licenses', universeId] });
      toast.success('License activated');
    },
  });

  const handleCreate = async () => {
    await createMutation.mutateAsync({
      universeId,
      type: licenseType,
      licensee: licensee || undefined,
      upfrontFee: parseFloat(upfrontFee) || 0,
      royaltyBps: parseInt(royaltyBps) || 500,
      durationDays: parseInt(durationDays) || 365,
      terms,
    });
  };

  const statusColors: Record<string, string> = {
    PROPOSED: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
    ACTIVE: 'bg-green-500/10 text-green-500 border-green-500/30',
    REVOKED: 'bg-red-500/10 text-red-500 border-red-500/30',
    EXPIRED: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30',
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Scale className="w-5 h-5" /> IP Licenses
            </h2>
            {universeName && <p className="text-sm text-zinc-400">{universeName}</p>}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Create form */}
        {showCreate && isOwner ? (
          <div className="space-y-4 mb-6 p-4 border border-zinc-800 rounded-xl">
            <h3 className="text-sm font-semibold text-white">New License</h3>

            <div className="space-y-2">
              <Label className="text-zinc-400 text-xs">License Type</Label>
              <div className="flex flex-wrap gap-2">
                {LICENSE_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setLicenseType(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                      licenseType === t
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-400 text-xs">Licensee Address (optional)</Label>
              <Input
                placeholder="0x... or leave blank for open license"
                value={licensee}
                onChange={(e) => setLicensee(e.target.value)}
                className="bg-zinc-800 border-zinc-700"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-zinc-400 text-[10px]">Upfront (ETH)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={upfrontFee}
                  onChange={(e) => setUpfrontFee(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-zinc-400 text-[10px]">Royalty (bps)</Label>
                <Input
                  type="number"
                  min="0"
                  max="10000"
                  value={royaltyBps}
                  onChange={(e) => setRoyaltyBps(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-zinc-400 text-[10px]">Duration (days)</Label>
                <Input
                  type="number"
                  min="1"
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-zinc-400 text-xs">Terms</Label>
              <Textarea
                placeholder="Describe the license terms..."
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                className="bg-zinc-800 border-zinc-700 min-h-[60px] text-xs"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCreate(false)}
                className="flex-1"
                size="sm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="flex-1"
                size="sm"
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Plus className="w-3 h-3 mr-1" />
                )}
                Create
              </Button>
            </div>
          </div>
        ) : isOwner ? (
          <Button
            onClick={() => setShowCreate(true)}
            variant="outline"
            className="w-full mb-4"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" /> New License
          </Button>
        ) : null}

        {/* Licenses list */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : !licenses || (licenses as any[]).length === 0 ? (
          <p className="text-center text-zinc-500 py-8 text-sm">No licenses yet</p>
        ) : (
          <div className="space-y-2">
            {(licenses as any[]).map((lic: any) => (
              <div key={lic.id} className="p-3 border border-zinc-800 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3 h-3 text-zinc-500" />
                    <span className="text-xs font-semibold text-white">{lic.type}</span>
                  </div>
                  <Badge className={`text-[9px] ${statusColors[lic.status] || ''}`}>
                    {lic.status}
                  </Badge>
                </div>
                <div className="flex gap-4 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-2.5 h-2.5" />
                    {lic.upfrontFee} ETH + {lic.royaltyBps / 100}% royalty
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {lic.durationDays}d
                  </span>
                </div>
                {lic.status === 'PROPOSED' && isOwner && (
                  <Button
                    size="sm"
                    className="w-full h-7 text-xs"
                    onClick={() => activateMutation.mutate({ licenseId: lic.id })}
                    disabled={activateMutation.isPending}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Activate
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
