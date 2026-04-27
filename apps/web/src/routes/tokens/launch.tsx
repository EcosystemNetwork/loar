/**
 * Minimal Token Launch — pump.fun-style quick-launch (name + symbol + image).
 *
 * Wraps the UniverseManager createUniverseWithToken() call with sensible defaults
 * so creators who don't need the full cinematic worldbuilding wizard can launch
 * a token in one transaction. For the full experience (characters, episodes,
 * lore), `/cinematicUniverseCreate` is still linked at the bottom.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import { useChainId } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { useUniverseManager, useDefaultDeploymentConfig } from '@/hooks/useUniverseManager';
import { DirectUpload } from '@/components/DirectUpload';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Price } from '@/components/Price';
import {
  Rocket,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Zap,
} from 'lucide-react';

export const Route = createFileRoute('/tokens/launch')({
  component: LaunchTokenPage,
});

const SYMBOL_REGEX = /^[A-Z0-9]{3,10}$/;

function LaunchTokenPage() {
  const navigate = useNavigate();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const { createUniverseWithToken, mintFee, mintFeeLoading, isPending, error } =
    useUniverseManager();
  const defaults = useDefaultDeploymentConfig();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [imageURL, setImageURL] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [localError, setLocalError] = useState<string | null>(null);

  const validation = useMemo(() => {
    const issues: string[] = [];
    if (!name.trim()) issues.push('Name required');
    else if (name.length > 50) issues.push('Name too long (max 50)');
    const trimmedSymbol = symbol.trim().toUpperCase();
    if (!trimmedSymbol) issues.push('Symbol required');
    else if (!SYMBOL_REGEX.test(trimmedSymbol))
      issues.push('Symbol must be 3–10 uppercase letters or numbers');
    if (!imageURL) issues.push('Image required');
    if (description.length > 280) issues.push('Description too long (max 280)');
    return issues;
  }, [name, symbol, imageURL, description]);

  const defaultsReady =
    defaults.defaultHook && defaults.defaultLocker && defaults.defaultPairedToken;

  const canSubmit =
    isConnected &&
    validation.length === 0 &&
    defaultsReady &&
    !isPending &&
    status !== 'submitting';

  const handleLaunch = async () => {
    if (!address || !defaultsReady) return;
    setLocalError(null);
    setStatus('submitting');

    const trimmedSymbol = symbol.trim().toUpperCase();
    const trimmedName = name.trim();

    try {
      await createUniverseWithToken(
        {
          name: trimmedName,
          imageURL,
          description: description.trim(),
          nodeCreationOptions: 0,
          nodeVisibilityOptions: 0,
          initialOwner: address,
        },
        {
          tokenConfig: {
            tokenAdmin: address,
            name: trimmedName,
            symbol: trimmedSymbol,
            imageURL,
            metadata: '',
            context: '',
          },
          poolConfig: {
            hook: defaults.defaultHook!,
            pairedToken: defaults.defaultPairedToken!,
            tickIfToken0IsLoar: defaults.defaultTickIfToken0IsLoar,
            tickSpacing: defaults.defaultTickSpacing,
            poolData: defaults.defaultPoolData,
          },
          lockerConfig: {
            locker: defaults.defaultLocker!,
            rewardAdmins: [address],
            rewardRecipients: [address],
            rewardBps: [10_000],
            tickLower: [-230400],
            tickUpper: [230400],
            positionBps: [10_000],
            lockerData: '0x',
          },
        }
      );
      setStatus('success');
      setTimeout(() => {
        navigate({ to: '/tokens' });
      }, 2500);
    } catch (err: any) {
      const msg = err?.shortMessage ?? err?.message ?? 'Launch failed';
      if (msg.includes('User rejected') || msg.includes('user rejected')) {
        setStatus('idle');
        return;
      }
      setLocalError(msg);
      setStatus('error');
    }
  };

  const feeEth = mintFee !== undefined ? Number(mintFee) / 1e18 : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link to="/tokens">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Rocket className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Launch Token</h1>
          </div>
        </div>

        {/* Benefits strip */}
        <Card className="mb-4 border-primary/20 bg-primary/5">
          <CardContent className="p-4 text-sm space-y-1.5">
            <p className="font-semibold flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              Quick-launch in one transaction
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5 pl-5 list-disc">
              <li>Fixed 1B supply, bonding-curve sale then Uniswap v4 graduation</li>
              <li>LP permanently locked on-chain after graduation</li>
              <li>Default 80% curve / 10% creator / 5% treasury / 5% community</li>
              <li>
                Need characters, episodes, lore?{' '}
                <Link to="/cinematicUniverseCreate" className="underline hover:text-foreground">
                  Use the full wizard
                </Link>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Form */}
        <Card>
          <CardContent className="p-5 space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="token-name" className="text-sm font-medium">
                Token Name
              </Label>
              <Input
                id="token-name"
                placeholder="e.g. Sunset Protocol"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
            </div>

            {/* Symbol */}
            <div className="space-y-1.5">
              <Label htmlFor="token-symbol" className="text-sm font-medium">
                Ticker Symbol
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  id="token-symbol"
                  placeholder="SUN"
                  value={symbol}
                  onChange={(e) =>
                    setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                  maxLength={10}
                  className="pl-7 font-mono uppercase tracking-wider"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">3–10 uppercase letters or numbers</p>
            </div>

            {/* Image */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Token Image</Label>
              {imageURL ? (
                <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/30">
                  <img
                    src={imageURL}
                    alt="Token"
                    loading="lazy"
                    decoding="async"
                    className="w-14 h-14 rounded-md object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">Uploaded</p>
                    <p className="text-[10px] text-muted-foreground truncate font-mono">
                      {imageURL}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setImageURL('')}>
                    Replace
                  </Button>
                </div>
              ) : (
                <DirectUpload
                  label="Drop image here or click to upload"
                  acceptedTypes={['image/jpeg', 'image/png', 'image/webp', 'image/gif']}
                  maxSizeMB={5}
                  onUploadComplete={(manifest, previewUrl) => {
                    // Persistent IPFS URL goes on-chain; fall back to the
                    // local blob preview only if the manifest is empty.
                    setImageURL(manifest.uploads[0]?.url || previewUrl);
                  }}
                />
              )}
            </div>

            {/* Description (optional) */}
            <div className="space-y-1.5">
              <Label htmlFor="token-desc" className="text-sm font-medium">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="token-desc"
                placeholder="One sentence on what the universe is about."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={280}
                rows={3}
              />
              <p className="text-[11px] text-muted-foreground text-right">
                {description.length}/280
              </p>
            </div>

            {/* Mint fee */}
            {feeEth !== null && (
              <div className="flex items-center justify-between text-xs p-3 rounded-md bg-muted/40">
                <span className="text-muted-foreground">Launch fee</span>
                <span className="font-mono tabular-nums">
                  <Price eth={feeEth} hideChain />
                </span>
              </div>
            )}

            {/* Validation */}
            {validation.length > 0 && (name || symbol || imageURL) && (
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 space-y-1">
                {validation.map((msg) => (
                  <p
                    key={msg}
                    className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {msg}
                  </p>
                ))}
              </div>
            )}

            {/* Tx status */}
            {status === 'submitting' && (
              <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Confirm the transaction in your wallet…
              </div>
            )}
            {status === 'success' && (
              <div className="p-3 rounded-md bg-green-500/10 border border-green-500/20 flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Token launched! Redirecting to the launchpad…
              </div>
            )}
            {status === 'error' && (localError || error) && (
              <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
                {localError ?? (error as any)?.message ?? 'Launch failed'}
              </div>
            )}

            {/* Network hint */}
            {!defaultsReady && (
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Current network is not supported. Switch to Sepolia or Base Sepolia.
              </div>
            )}

            {/* Launch button */}
            {!isConnected ? (
              <Button className="w-full h-12 text-base font-bold" disabled>
                Connect Wallet
              </Button>
            ) : (
              <Button
                className="w-full h-12 text-base font-bold"
                onClick={handleLaunch}
                disabled={!canSubmit}
              >
                {status === 'submitting' || isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Launching…
                  </>
                ) : (
                  <>
                    <Rocket className="h-5 w-5 mr-2" />
                    Launch Token
                  </>
                )}
              </Button>
            )}

            {mintFeeLoading && (
              <p className="text-[10px] text-center text-muted-foreground">
                Loading on-chain launch fee…
              </p>
            )}
          </CardContent>
        </Card>

        {/* LP + supply disclosure */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Badge variant="secondary" className="text-[10px] gap-1 justify-center py-2">
            <Zap className="h-3 w-3" /> LP Locked Forever
          </Badge>
          <Badge variant="secondary" className="text-[10px] gap-1 justify-center py-2">
            Fixed 1B Supply
          </Badge>
        </div>
      </div>
    </div>
  );
}
