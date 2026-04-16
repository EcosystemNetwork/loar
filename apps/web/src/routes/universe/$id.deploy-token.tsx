/**
 * Deploy Token — standalone page for deploying a governance token + liquidity pool
 * for an existing universe that was created without one.
 *
 * Route: /universe/:id/deploy-token
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useChainId, useSwitchChain } from 'wagmi';
import { useActiveAccount } from 'thirdweb/react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useUniverseManager, useDefaultDeploymentConfig } from '@/hooks/useUniverseManager';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Rocket, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useWaitForTransactionReceipt } from 'wagmi';
import { universeManagerAbi } from '@loar/abis/generated';
import { decodeEventLog } from 'viem';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SUPPORTED_CHAIN_IDS, CHAIN_NAMES, isSupportedChain } from '@/configs/chains';

/**
 * Build lockerConfig supporting optional secondary fee recipient.
 */
function buildLockerConfig(
  locker: `0x${string}` | undefined,
  creatorAddress: `0x${string}`,
  defaultTick: number,
  secondaryRecipient?: `0x${string}`,
  creatorSplitPct = 100
) {
  const rewardAdmins: `0x${string}`[] = [creatorAddress];
  const rewardRecipients: `0x${string}`[] = [creatorAddress];
  const rewardBps: number[] = [];

  if (secondaryRecipient && creatorSplitPct < 100) {
    rewardAdmins.push(creatorAddress); // creator is admin for both slots
    rewardRecipients.push(secondaryRecipient);
    rewardBps.push(creatorSplitPct * 100); // convert % to bps
    rewardBps.push((100 - creatorSplitPct) * 100);
  } else {
    rewardBps.push(10000); // 100% to creator
  }

  return {
    locker: locker!,
    rewardAdmins,
    rewardRecipients,
    rewardBps,
    tickLower: [defaultTick],
    tickUpper: [0],
    positionBps: [10000],
    lockerData: '0x' as `0x${string}`,
  };
}

export const Route = createFileRoute('/universe/$id/deploy-token')({
  component: DeployTokenPage,
});

function DeployTokenPage() {
  const { id: universeId } = Route.useParams();
  const navigate = useNavigate();
  const { address } = useWalletAccount();
  const { isAuthenticated } = useWalletAuth();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const thirdwebAccount = useActiveAccount();

  const { deployUniverseToken, hash, isPending, error } = useUniverseManager();
  const defaultConfig = useDefaultDeploymentConfig();
  const {
    isLoading: isConfirming,
    isSuccess: txSuccess,
    data: txReceipt,
  } = useWaitForTransactionReceipt({ hash });

  const [tokenSymbol, setTokenSymbol] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [tokenAddress, setTokenAddress] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [feeRecipient2, setFeeRecipient2] = useState('');
  const [feeSplit, setFeeSplit] = useState(100); // % to creator, remainder to secondary

  // Fetch universe info
  const { data: universeResult, isLoading: universeLoading } = useQuery({
    queryKey: ['universe', universeId],
    queryFn: () => trpcClient.universes.get.query({ id: universeId }),
    enabled: !!universeId,
  });
  const universe = (universeResult as any)?.data;

  // Read on-chain universe data to get the numeric ID
  const { useGetUniverseData } = useUniverseManager();

  // We need the numeric universeId from the contract
  // Try reading it from the Firestore record
  const onChainId = universe?.onChainUniverseId;

  // Watch for tx success
  if (txSuccess && txReceipt && !completed) {
    setCompleted(true);
    setDeploying(false);

    // Parse token address from event
    for (const log of txReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: universeManagerAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'TokenCreated') {
          const args = decoded.args as { tokenAddress: string; governor: string };
          setTokenAddress(args.tokenAddress);

          // Update Firestore
          if (universe?.id) {
            trpcClient.universes.finalizeTokenDeployment
              .mutate({
                universeId: universe.id,
                tokenAddress: args.tokenAddress,
                governanceAddress: args.governor,
                tokenDeployTxHash: hash,
              })
              .catch(() => {});
          }
        }
      } catch {
        // Not our event
      }
    }
    toast.success('Token deployed successfully!');
  }

  const handleDeploy = async () => {
    if (!address || !tokenSymbol || onChainId === undefined) return;

    setDeploying(true);
    try {
      await deployUniverseToken(
        {
          tokenConfig: {
            tokenAdmin: address as `0x${string}`,
            name: tokenName || universe?.name || 'Universe Token',
            symbol: tokenSymbol,
            imageURL: universe?.image_url || '',
            metadata: `Governance token for ${universe?.name || 'Universe'}`,
            context: universe?.description || '',
          },
          poolConfig: {
            hook: defaultConfig.defaultHook,
            pairedToken: defaultConfig.defaultPairedToken,
            tickIfToken0IsLoar: defaultConfig.defaultTickIfToken0IsLoar,
            tickSpacing: defaultConfig.defaultTickSpacing,
            poolData: defaultConfig.defaultPoolData as `0x${string}`,
          },
          lockerConfig: buildLockerConfig(
            defaultConfig.defaultLocker,
            address as `0x${string}`,
            defaultConfig.defaultTickIfToken0IsLoar,
            showAdvanced && feeRecipient2.match(/^0x[0-9a-fA-F]{40}$/)
              ? (feeRecipient2 as `0x${string}`)
              : undefined,
            feeSplit
          ),
          allocationConfig: {
            lpBps: 8000,
            creatorBps: 1000,
            treasuryBps: 500,
            communityBps: 500,
          },
        },
        BigInt(onChainId)
      );
    } catch (err) {
      toast.error(`Deploy failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setDeploying(false);
    }
  };

  if (universeLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 py-10">
        <Button variant="ghost" className="mb-6" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <Card>
          <CardContent className="p-6 space-y-6">
            <div>
              <h1 className="text-2xl font-bold">Deploy Token & Liquidity Pool</h1>
              <p className="text-sm text-muted-foreground mt-1">{universe?.name || universeId}</p>
            </div>

            {completed ? (
              <div className="text-center space-y-4 py-8">
                <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
                <h2 className="text-xl font-bold">Token Deployed!</h2>
                {tokenAddress && (
                  <p className="text-sm text-muted-foreground font-mono">{tokenAddress}</p>
                )}
                <Button onClick={() => navigate({ to: '/' })}>Back to Home</Button>
              </div>
            ) : (
              <>
                {!onChainId && onChainId !== 0 ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Enter the on-chain Universe ID (from the creation transaction).
                    </p>
                    <div>
                      <Label className="text-sm font-semibold mb-2 block">
                        On-Chain Universe ID
                      </Label>
                      <Input
                        type="number"
                        placeholder="e.g., 0"
                        onChange={(e) => {
                          if (universe) {
                            (universe as any).onChainUniverseId = e.target.value;
                          }
                        }}
                        className="h-11"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Your universe ID is <strong>0</strong> (first universe created)
                      </p>
                    </div>
                  </div>
                ) : null}

                {SUPPORTED_CHAIN_IDS.length > 1 && (
                  <div>
                    <Label className="text-sm font-semibold mb-2 block">Deploy on</Label>
                    <Select
                      value={String(chainId)}
                      onValueChange={(v) => {
                        const id = Number(v);
                        if (id !== chainId) switchChain({ chainId: id });
                      }}
                      disabled={deploying || isPending || isConfirming}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Select network" />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_CHAIN_IDS.map((id) => (
                          <SelectItem key={id} value={String(id)}>
                            {CHAIN_NAMES[id] ?? `Chain ${id}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div>
                  <Label className="text-sm font-semibold mb-2 block">Token Name</Label>
                  <Input
                    placeholder={universe?.name || 'Token Name'}
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    className="h-11"
                  />
                </div>

                <div>
                  <Label className="text-sm font-semibold mb-2 block">Token Symbol</Label>
                  <Input
                    placeholder="e.g., MEME"
                    value={tokenSymbol}
                    onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                    maxLength={10}
                    className="h-11"
                  />
                </div>

                {/* Advanced: LP Fee Incentive Settings */}
                <div className="border rounded-lg">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors rounded-lg"
                  >
                    <span>LP Fee Incentive Settings</span>
                    <span className="text-xs text-muted-foreground">
                      {showAdvanced ? '▲ Hide' : '▼ Advanced'}
                    </span>
                  </button>
                  {showAdvanced && (
                    <div className="px-3 pb-3 space-y-3 border-t pt-3">
                      <p className="text-xs text-muted-foreground">
                        Configure how swap fees from your liquidity pool are distributed. By
                        default, 100% goes to you. Add a second recipient to share yield.
                      </p>
                      <div>
                        <Label className="text-xs mb-1 block">Your Share (%)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          value={feeSplit}
                          onChange={(e) =>
                            setFeeSplit(Math.min(100, Math.max(1, Number(e.target.value))))
                          }
                          className="h-9"
                        />
                      </div>
                      {feeSplit < 100 && (
                        <div>
                          <Label className="text-xs mb-1 block">
                            Secondary Recipient ({100 - feeSplit}% of fees)
                          </Label>
                          <Input
                            placeholder="0x... (treasury, DAO, collaborator)"
                            value={feeRecipient2}
                            onChange={(e) => setFeeRecipient2(e.target.value)}
                            className="h-9 font-mono text-xs"
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Use this to incentivize LP providers or share fees with collaborators.
                            You can update recipients later from your dashboard.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                  <p>This will deploy a governance token and liquidity pool.</p>
                  <p>Cost: ~0.01 ETH for the deployment transaction.</p>
                  <p>Allocation: 80% LP, 10% Creator, 5% Treasury, 5% Community</p>
                  {showAdvanced && feeSplit < 100 && feeRecipient2 && (
                    <p className="text-amber-500">
                      LP Fee Split: {feeSplit}% to you, {100 - feeSplit}% to{' '}
                      {feeRecipient2.slice(0, 8)}...
                    </p>
                  )}
                </div>

                <Button
                  onClick={handleDeploy}
                  disabled={!tokenSymbol || deploying || isPending || isConfirming}
                  className="w-full h-12 text-base font-bold"
                  size="lg"
                >
                  {isPending || isConfirming || deploying ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      {isConfirming ? 'Confirming...' : 'Deploying...'}
                    </>
                  ) : (
                    <>
                      <Rocket className="h-5 w-5 mr-2" />
                      Deploy Token (0.01 ETH)
                    </>
                  )}
                </Button>

                {error && <p className="text-sm text-red-400">{error.message?.slice(0, 200)}</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
