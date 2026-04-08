import { useState, useMemo } from 'react';
import { useMultiChainAuth } from '../../lib/use-multi-chain-auth';
import { BRIDGE_ROUTES, estimateBridgeTime } from '../../configs/bridge';

type Chain = 'base' | 'solana' | 'sui';

interface ChainOption {
  id: Chain;
  name: string;
  badge: string;
}

const CHAINS: ChainOption[] = [
  { id: 'base', name: 'Base', badge: 'B' },
  { id: 'solana', name: 'Solana', badge: 'S' },
  { id: 'sui', name: 'SUI', badge: 'U' },
];

interface BridgeFormProps {
  onBridgeInitiated: (tx: {
    txHash: string;
    sourceChain: Chain;
    destChain: Chain;
    amount: string;
  }) => void;
}

function getRouteKey(source: Chain, dest: Chain): string | null {
  const key = `${source}-to-${dest}`;
  if (key in BRIDGE_ROUTES) return key;
  return null;
}

export function BridgeForm({ onBridgeInitiated }: BridgeFormProps) {
  const { isAuthenticated, address } = useMultiChainAuth();
  const [sourceChain, setSourceChain] = useState<Chain>('base');
  const [destChain, setDestChain] = useState<Chain>('solana');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [isBridging, setIsBridging] = useState(false);

  const routeKey = useMemo(() => getRouteKey(sourceChain, destChain), [sourceChain, destChain]);

  const estimatedTime = useMemo(() => {
    const est = estimateBridgeTime(sourceChain);
    const minMin = Math.floor(est.minSeconds / 60);
    const maxMin = Math.ceil(est.maxSeconds / 60);
    return `${minMin}-${maxMin} min`;
  }, [sourceChain]);

  const fee = useMemo(() => {
    const val = parseFloat(amount) || 0;
    return val * 0.0005;
  }, [amount]);

  const receiveAmount = useMemo(() => {
    const val = parseFloat(amount) || 0;
    return Math.max(0, val - fee);
  }, [amount, fee]);

  const canBridge = isAuthenticated && routeKey !== null && parseFloat(amount) > 0 && !isBridging;

  const handleSwapChains = () => {
    setSourceChain(destChain);
    setDestChain(sourceChain);
  };

  const handleSourceChange = (chain: Chain) => {
    setSourceChain(chain);
    if (chain === destChain) {
      // Auto-pick a different dest
      const alt = CHAINS.find((c) => c.id !== chain);
      if (alt) setDestChain(alt.id);
    }
  };

  const handleDestChange = (chain: Chain) => {
    setDestChain(chain);
    if (chain === sourceChain) {
      const alt = CHAINS.find((c) => c.id !== chain);
      if (alt) setSourceChain(alt.id);
    }
  };

  const handleBridge = async () => {
    if (!canBridge) return;
    setIsBridging(true);

    try {
      // TODO: Integrate @wormhole-foundation/sdk
      // const wh = new Wormhole('Mainnet');
      // const route = BRIDGE_ROUTES[routeKey!];
      // const transfer = await wh.nttTransfer({
      //   sourceChain: route.sourceChain,
      //   destChain: route.destChain,
      //   amount,
      //   recipient: recipient || address,
      // });
      // const tx = await transfer.initiateTransfer(signer);

      // Simulated bridge initiation
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const mockTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

      onBridgeInitiated({
        txHash: mockTxHash,
        sourceChain,
        destChain,
        amount,
      });
    } finally {
      setIsBridging(false);
    }
  };

  return (
    <div className="bg-card border rounded-xl p-6">
      {/* Source Chain */}
      <div className="mb-4">
        <label className="text-sm text-muted-foreground mb-2 block">From</label>
        <div className="flex gap-2 mb-3">
          {CHAINS.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSourceChange(c.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition ${
                sourceChain === c.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-transparent hover:border-border'
              }`}
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-background text-xs font-bold">
                {c.badge}
              </span>
              {c.name}
            </button>
          ))}
        </div>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00 LOAR"
          min="0"
          step="any"
          className="w-full bg-muted rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground border border-transparent focus:border-primary focus:outline-none"
        />
      </div>

      {/* Swap button */}
      <div className="flex justify-center my-2">
        <button
          onClick={handleSwapChains}
          className="p-2 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground transition"
          aria-label="Swap chains"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 2L4 14M4 14L1 11M4 14L7 11M12 14L12 2M12 2L9 5M12 2L15 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Destination Chain */}
      <div className="mb-4">
        <label className="text-sm text-muted-foreground mb-2 block">To</label>
        <div className="flex gap-2 mb-3">
          {CHAINS.map((c) => (
            <button
              key={c.id}
              onClick={() => handleDestChange(c.id)}
              disabled={c.id === sourceChain}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition ${
                destChain === c.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : c.id === sourceChain
                    ? 'bg-muted/50 text-muted-foreground/50 border-transparent cursor-not-allowed'
                    : 'bg-muted text-muted-foreground border-transparent hover:border-border'
              }`}
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-background text-xs font-bold">
                {c.badge}
              </span>
              {c.name}
            </button>
          ))}
        </div>
        <div className="w-full bg-muted rounded-lg px-4 py-3 text-muted-foreground border border-transparent">
          {receiveAmount > 0 ? `${receiveAmount.toFixed(4)} LOAR` : '0.00 LOAR'}
        </div>
      </div>

      {/* Recipient Address */}
      <div className="mb-4">
        <label className="text-sm text-muted-foreground mb-2 block">
          Recipient Address
          {address && (
            <button
              onClick={() => setRecipient(address)}
              className="ml-2 text-xs text-primary hover:underline"
            >
              Use connected wallet
            </button>
          )}
        </label>
        <input
          value={recipient || (address ?? '')}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Destination address"
          className="w-full bg-muted rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground border border-transparent focus:border-primary focus:outline-none text-sm font-mono"
        />
      </div>

      {/* Transfer details */}
      {parseFloat(amount) > 0 && routeKey && (
        <div className="bg-muted rounded-lg p-4 mb-4 text-sm space-y-2">
          <div className="flex justify-between text-muted-foreground">
            <span>Route</span>
            <span className="text-foreground font-mono text-xs">{routeKey}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Transfer fee (0.05%)</span>
            <span className="text-foreground">{fee.toFixed(4)} LOAR</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Estimated time</span>
            <span className="text-foreground">{estimatedTime}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>You receive</span>
            <span className="text-foreground font-medium">{receiveAmount.toFixed(4)} LOAR</span>
          </div>
        </div>
      )}

      {/* Validation messages */}
      {!routeKey && sourceChain !== destChain && (
        <p className="text-sm text-destructive mb-4">
          No bridge route available for {sourceChain} to {destChain}.
        </p>
      )}

      {!isAuthenticated && (
        <p className="text-sm text-muted-foreground mb-4">Connect a wallet to bridge $LOAR.</p>
      )}

      {/* Bridge button */}
      <button
        onClick={handleBridge}
        disabled={!canBridge}
        className="w-full py-3 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {isBridging
          ? 'Initiating Bridge...'
          : `Bridge to ${CHAINS.find((c) => c.id === destChain)?.name ?? destChain}`}
      </button>
    </div>
  );
}
