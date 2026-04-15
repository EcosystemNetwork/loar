/**
 * Deploy Token — standalone page for deploying a governance token + liquidity pool
 * for an existing universe that was created without one.
 *
 * Route: /universe/:id/deploy-token
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useChainId } from 'wagmi';
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

export const Route = createFileRoute('/universe/$id/deploy-token')({
  component: DeployTokenPage,
});

function DeployTokenPage() {
  const { id: universeId } = Route.useParams();
  const navigate = useNavigate();
  const { address } = useWalletAccount();
  const { isAuthenticated } = useWalletAuth();
  const chainId = useChainId();
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
          lockerConfig: {
            locker: defaultConfig.defaultLocker,
            rewardAdmins: [address as `0x${string}`],
            rewardRecipients: [address as `0x${string}`],
            rewardBps: [10000],
            tickLower: [defaultConfig.defaultTickIfToken0IsLoar],
            tickUpper: [0],
            positionBps: [10000],
            lockerData: '0x' as `0x${string}`,
          },
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

                <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                  <p>This will deploy a governance token and liquidity pool.</p>
                  <p>Cost: ~0.01 ETH for the deployment transaction.</p>
                  <p>Allocation: 80% LP, 10% Creator, 5% Treasury, 5% Community</p>
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
