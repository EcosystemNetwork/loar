/**
 * $LOAR Faucet — big, obvious testnet token claim page.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useReadContract, useChainId } from 'wagmi';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { formatUnits } from 'viem';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Droplets, Coins, ArrowRight, CheckCircle2, Wallet } from 'lucide-react';
import { getEvmAddresses, isZeroAddress } from '@/configs/addresses';

export const Route = createFileRoute('/faucet')({
  component: FaucetPage,
});

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const FAUCET_ABI = [
  {
    name: 'claim',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [],
    outputs: [],
  },
  {
    name: 'claimAmount',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'faucetBalance',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

function FaucetPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const [isClaiming, setIsClaiming] = useState(false);
  const [justClaimed, setJustClaimed] = useState(false);

  const addrs = getEvmAddresses(chainId);
  const ZERO = '0x0000000000000000000000000000000000000000' as const;
  const LOAR_TOKEN_ADDRESS: `0x${string}` = addrs?.loarToken ?? ZERO;
  const LOAR_FAUCET_ADDRESS: `0x${string}` = addrs?.loarFaucet ?? ZERO;
  const hasFaucet = !isZeroAddress(LOAR_FAUCET_ADDRESS);

  const { data: claimAmountData } = useReadContract({
    address: LOAR_FAUCET_ADDRESS,
    abi: FAUCET_ABI,
    functionName: 'claimAmount',
    query: { enabled: hasFaucet },
  });

  const { data: faucetBalanceData } = useReadContract({
    address: LOAR_FAUCET_ADDRESS,
    abi: FAUCET_ABI,
    functionName: 'faucetBalance',
    query: { enabled: hasFaucet },
  });

  // User's $LOAR balance
  const { data: userBalanceRaw, refetch: refetchBalance } = useReadContract({
    address: LOAR_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !isZeroAddress(LOAR_TOKEN_ADDRESS),
      refetchInterval: 15000,
    },
  });

  const faucetAmount = claimAmountData ? Number(formatUnits(claimAmountData as bigint, 18)) : 1000;
  const faucetBalance = faucetBalanceData
    ? Number(formatUnits(faucetBalanceData as bigint, 18))
    : null;
  const userBalance =
    userBalanceRaw != null ? Number(formatUnits(userBalanceRaw as bigint, 18)) : 0;

  // No cooldown — testnet faucet is unlimited

  const handleClaim = async () => {
    if (!hasFaucet) return;
    setIsClaiming(true);
    try {
      toast.info('Confirm faucet claim in your wallet...');
      await writeContractAsync({
        address: LOAR_FAUCET_ADDRESS,
        abi: FAUCET_ABI,
        functionName: 'claim',
      });
      toast.success(`Claimed ${faucetAmount.toLocaleString()} $LOAR!`);
      setJustClaimed(true);
      refetchBalance();
    } catch (err) {
      if (err instanceof Error && !err.message.includes('rejected')) {
        toast.error('Faucet claim failed: ' + err.message);
      }
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/40 via-background to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent" />

        <div className="relative max-w-2xl mx-auto px-4 pt-16 pb-12 text-center">
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 mb-8">
            <Droplets className="w-12 h-12 text-emerald-400" />
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-4">
            $LOAR Faucet
          </h1>
          <p className="text-lg text-zinc-400 max-w-md mx-auto">
            Claim free testnet <span className="text-emerald-400 font-semibold">$LOAR</span> tokens
            to explore the platform, generate content, and buy credits.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-xl mx-auto px-4 -mt-2 pb-16 space-y-6">
        {/* Claim Card */}
        <Card className="border-emerald-700/40 bg-zinc-950/80 backdrop-blur-sm overflow-hidden">
          {/* Claim amount banner */}
          <div className="bg-emerald-600/15 border-b border-emerald-700/30 px-6 py-4 text-center">
            <p className="text-sm text-emerald-400/80 uppercase tracking-wider font-medium mb-1">
              Claim Amount
            </p>
            <p className="text-5xl font-extrabold text-emerald-400">
              {faucetAmount.toLocaleString()}
            </p>
            <p className="text-sm text-emerald-400/60 mt-1">$LOAR tokens per claim</p>
          </div>

          <CardContent className="p-6 space-y-6">
            {/* Status / Claim button */}
            {!hasFaucet ? (
              <div className="text-center py-6">
                <p className="text-zinc-400">Faucet contract not configured.</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Set VITE_LOAR_FAUCET_ADDRESS in your environment.
                </p>
              </div>
            ) : !isConnected ? (
              <div className="text-center py-6 space-y-4">
                <Wallet className="w-10 h-10 text-zinc-500 mx-auto" />
                <p className="text-zinc-400">Connect your wallet to claim tokens</p>
              </div>
            ) : justClaimed ? (
              <div className="text-center py-6 space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xl font-bold text-emerald-400">
                    {faucetAmount.toLocaleString()} $LOAR Claimed!
                  </p>
                  <p className="text-sm text-zinc-400 mt-1">Tokens have been sent to your wallet</p>
                </div>
                <Button
                  variant="outline"
                  className="border-emerald-700/50 text-emerald-400 hover:bg-emerald-950/50"
                  onClick={() => setJustClaimed(false)}
                >
                  Done
                </Button>
              </div>
            ) : (
              <button
                disabled={isClaiming}
                onClick={handleClaim}
                className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xl font-bold rounded-xl transition-all shadow-lg shadow-emerald-900/40 hover:shadow-emerald-800/50 hover:scale-[1.01]"
              >
                {isClaiming ? (
                  <span className="flex items-center justify-center gap-3">
                    <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Claiming...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-3">
                    <Droplets className="w-6 h-6" />
                    Claim {faucetAmount.toLocaleString()} $LOAR
                  </span>
                )}
              </button>
            )}

            {/* Your balance */}
            {isConnected && (
              <div className="flex items-center justify-between bg-zinc-900/60 rounded-lg px-4 py-3 border border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <Coins className="w-5 h-5 text-amber-400" />
                  <span className="text-sm text-zinc-400">Your $LOAR Balance</span>
                </div>
                <span className="text-lg font-bold text-emerald-400">
                  {userBalance.toLocaleString()}
                </span>
              </div>
            )}

            {/* Faucet supply */}
            {faucetBalance !== null && (
              <div className="flex items-center justify-between bg-zinc-900/60 rounded-lg px-4 py-3 border border-zinc-800">
                <span className="text-sm text-zinc-400">Faucet Supply</span>
                <span className="text-sm font-medium text-zinc-300">
                  {faucetBalance.toLocaleString()} $LOAR remaining
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* CTA to use tokens */}
        <Card className="border-zinc-800 bg-zinc-950/60">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-zinc-300 mb-3">What can you do with $LOAR?</p>
            <div className="space-y-2.5">
              <Link
                to="/credits"
                className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-amber-700/40 hover:bg-amber-950/20 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <Coins className="w-5 h-5 text-amber-400" />
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Buy Credits</p>
                    <p className="text-xs text-zinc-500">Generate images, video, music, and more</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-amber-400 transition-colors" />
              </Link>
              <Link
                to="/tokens"
                className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-purple-700/40 hover:bg-purple-950/20 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className="w-5 h-5 text-purple-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Launchpad</p>
                    <p className="text-xs text-zinc-500">
                      Trade universe tokens and support creators
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-purple-400 transition-colors" />
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Info */}
        <p className="text-center text-xs text-zinc-600">
          This faucet distributes testnet $LOAR tokens. Tokens have no monetary value.
          <br />
          No cooldown — claim as often as you need.
        </p>
      </div>
    </div>
  );
}
