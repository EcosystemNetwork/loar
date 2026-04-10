/**
 * UniverseAccessSettings — Universe owner configures access model.
 *
 * Options:
 *   - Open (free for all)
 *   - Subscription-gated (paid tiers)
 *   - Token-gated (must hold governance token)
 *   - Both (subscription OR token holding grants access)
 *
 * Universe owners configure subscription tiers and/or token gate thresholds.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { trpcClient } from '@/utils/trpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Shield,
  Crown,
  Coins,
  Lock,
  Unlock,
  Loader2,
  Plus,
  Save,
  CheckCircle2,
  Eye,
  Vote,
  Film,
  Zap,
  Gift,
} from 'lucide-react';

interface UniverseAccessSettingsProps {
  universeId: string;
  onClose: () => void;
}

type AccessModel = 'open' | 'subscription' | 'token_gate' | 'both';

const TIERS = ['BASIC', 'PREMIUM', 'VIP'] as const;

interface TierConfig {
  tier: string;
  pricePerMonth: string;
  earlyAccess: boolean;
  votingBoost: boolean;
  premiumContent: boolean;
  behindTheScenes: boolean;
  creditBonus: number;
}

const DEFAULT_TIERS: Record<string, TierConfig> = {
  BASIC: {
    tier: 'BASIC',
    pricePerMonth: '0.005',
    earlyAccess: true,
    votingBoost: false,
    premiumContent: false,
    behindTheScenes: false,
    creditBonus: 0,
  },
  PREMIUM: {
    tier: 'PREMIUM',
    pricePerMonth: '0.02',
    earlyAccess: true,
    votingBoost: true,
    premiumContent: true,
    behindTheScenes: false,
    creditBonus: 100,
  },
  VIP: {
    tier: 'VIP',
    pricePerMonth: '0.05',
    earlyAccess: true,
    votingBoost: true,
    premiumContent: true,
    behindTheScenes: true,
    creditBonus: 500,
  },
};

export function UniverseAccessSettings({ universeId, onClose }: UniverseAccessSettingsProps) {
  const queryClient = useQueryClient();
  const [accessModel, setAccessModel] = useState<AccessModel>('open');
  const [tokenThreshold, setTokenThreshold] = useState('1'); // % of total supply
  const [tiers, setTiers] = useState<TierConfig[]>([
    { ...DEFAULT_TIERS.BASIC },
    { ...DEFAULT_TIERS.PREMIUM },
    { ...DEFAULT_TIERS.VIP },
  ]);
  const [saving, setSaving] = useState(false);

  // Load existing access model
  const { data: currentAccessModel } = useQuery({
    queryKey: ['access-model', universeId],
    queryFn: () => trpcClient.universes.getAccessModel.query({ universeId }),
  });

  // Sync state when data loads
  useState(() => {
    if (currentAccessModel?.accessModel) {
      setAccessModel(currentAccessModel.accessModel as AccessModel);
    }
  });

  const { data: existingTiers } = useQuery({
    queryKey: ['subscription-tiers', universeId],
    queryFn: () => trpcClient.subscriptions.getTiers.query({ universeId }),
  });

  const configureTierMutation = useMutation({
    mutationFn: (data: any) => trpcClient.subscriptions.configureTier.mutate(data),
  });

  const updateTier = (index: number, field: keyof TierConfig, value: any) => {
    const next = [...tiers];
    (next[index] as any)[field] = value;
    setTiers(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save the access model choice
      await trpcClient.universes.updateAccessModel.mutate({
        universeId,
        accessModel,
      });

      if (accessModel === 'subscription' || accessModel === 'both') {
        for (const tier of tiers) {
          await configureTierMutation.mutateAsync({
            universeId,
            tier: tier.tier,
            pricePerMonth: parseFloat(tier.pricePerMonth) || 0,
            earlyAccess: tier.earlyAccess,
            votingBoost: tier.votingBoost,
            premiumContent: tier.premiumContent,
            behindTheScenes: tier.behindTheScenes,
            creditBonus: tier.creditBonus,
          });
        }
      }

      // Update token gate threshold via private section config
      if (accessModel === 'token_gate' || accessModel === 'both') {
        await trpcClient.privateSection.updateConfig
          .mutate({
            universeId,
            holderMinPercentage: parseFloat(tokenThreshold) || 1,
          })
          .catch(() => {
            /* Non-critical if config doesn't exist yet */
          });
      }

      queryClient.invalidateQueries({ queryKey: ['subscription-tiers', universeId] });
      toast.success('Access settings saved');
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const accessOptions: { value: AccessModel; label: string; icon: typeof Unlock; desc: string }[] =
    [
      { value: 'open', label: 'Open', icon: Unlock, desc: 'Free for everyone' },
      {
        value: 'subscription',
        label: 'Subscription',
        icon: Crown,
        desc: 'Paid tiers with benefits',
      },
      { value: 'token_gate', label: 'Token Gate', icon: Coins, desc: 'Must hold governance token' },
      { value: 'both', label: 'Sub + Token', icon: Shield, desc: 'Subscribe OR hold tokens' },
    ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Lock className="w-5 h-5" /> Access Settings
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-sm">
            Cancel
          </button>
        </div>

        {/* Access Model Selector */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          {accessOptions.map((opt) => {
            const Icon = opt.icon;
            const selected = accessModel === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setAccessModel(opt.value)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selected
                    ? 'border-primary bg-primary/10'
                    : 'border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${selected ? 'text-primary' : 'text-zinc-500'}`} />
                  <span className="text-sm font-semibold text-white">{opt.label}</span>
                </div>
                <p className="text-[10px] text-zinc-500">{opt.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Token Gate Config */}
        {(accessModel === 'token_gate' || accessModel === 'both') && (
          <Card className="mb-4 border-zinc-800 bg-zinc-800/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-500" />
                Token Gate Threshold
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  step="0.1"
                  min="0.01"
                  max="100"
                  value={tokenThreshold}
                  onChange={(e) => setTokenThreshold(e.target.value)}
                  className="w-24 bg-zinc-900 border-zinc-700"
                />
                <span className="text-sm text-zinc-400">% of total token supply required</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Subscription Tiers Config */}
        {(accessModel === 'subscription' || accessModel === 'both') && (
          <div className="space-y-3 mb-6">
            <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
              <Crown className="w-4 h-4 text-purple-500" />
              Subscription Tiers
            </h3>
            {tiers.map((tier, i) => (
              <Card key={tier.tier} className="border-zinc-800 bg-zinc-800/50">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{tier.tier}</Badge>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={tier.pricePerMonth}
                        onChange={(e) => updateTier(i, 'pricePerMonth', e.target.value)}
                        className="w-28 h-8 text-xs bg-zinc-900 border-zinc-700"
                      />
                      <span className="text-xs text-zinc-500">ETH/mo</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      ['earlyAccess', 'votingBoost', 'premiumContent', 'behindTheScenes'] as const
                    ).map((b) => (
                      <button
                        key={b}
                        onClick={() => updateTier(i, b, !tier[b])}
                        className={`px-2 py-1 rounded text-[10px] border transition-colors ${
                          tier[b]
                            ? 'border-primary/50 bg-primary/10 text-primary'
                            : 'border-zinc-700 text-zinc-500 hover:border-zinc-600'
                        }`}
                      >
                        {b.replace(/([A-Z])/g, ' $1').trim()}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-[10px] text-zinc-500">Credit bonus:</Label>
                    <Input
                      type="number"
                      min="0"
                      value={tier.creditBonus}
                      onChange={(e) => updateTier(i, 'creditBonus', parseInt(e.target.value) || 0)}
                      className="w-20 h-7 text-xs bg-zinc-900 border-zinc-700"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Button onClick={handleSave} disabled={saving} className="w-full h-11 font-bold">
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          {saving ? 'Saving...' : 'Save Access Settings'}
        </Button>
      </div>
    </div>
  );
}
