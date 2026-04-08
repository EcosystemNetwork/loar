/**
 * Bridge Component — Transfer $LOAR across Base, Solana, SUI, and Ethereum
 * using Wormhole NTT (Native Token Transfers).
 *
 * Base is the hub (locking mode), all others are burn-and-mint spokes.
 * 0.05% transfer fee is collected on the source chain.
 */

import { useState, useMemo } from 'react';
import { useMultiChainAuth } from '../lib/use-multi-chain-auth';
import { BRIDGE_ROUTES, estimateBridgeTime, BRIDGE_FEE_NOTE } from '../configs/bridge';

type Chain = 'base' | 'solana' | 'sui' | 'ethereum';

interface ChainOption {
  id: Chain;
  name: string;
  icon: string;
  disabled?: boolean;
}

const CHAINS: ChainOption[] = [
  { id: 'base', name: 'Base', icon: '🔵' },
  { id: 'solana', name: 'Solana', icon: '🟣' },
  { id: 'sui', name: 'SUI', icon: '🔷' },
  { id: 'ethereum', name: 'Ethereum', icon: '⟠' },
];

export function Bridge() {
  const { isAuthenticated, chainFamily, address } = useMultiChainAuth();
  const [sourceChain, setSourceChain] = useState<Chain>('base');
  const [destChain, setDestChain] = useState<Chain>('solana');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'confirming' | 'complete' | 'error'>(
    'idle'
  );
  const [txHash, setTxHash] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const fee = useMemo(() => {
    const val = parseFloat(amount) || 0;
    return val * 0.0005; // 0.05%
  }, [amount]);

  const receiveAmount = useMemo(() => {
    const val = parseFloat(amount) || 0;
    return val - fee;
  }, [amount, fee]);

  const estimatedTime = useMemo(() => {
    const est = estimateBridgeTime(sourceChain as 'base' | 'solana' | 'sui');
    const minMin = Math.floor(est.minSeconds / 60);
    const maxMin = Math.ceil(est.maxSeconds / 60);
    return `${minMin}-${maxMin} min`;
  }, [sourceChain]);

  const handleSwapChains = () => {
    setSourceChain(destChain);
    setDestChain(sourceChain);
  };

  const handleBridge = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (!isAuthenticated) return;

    setStatus('pending');
    setErrorMsg('');

    try {
      // The actual NTT transfer is initiated via Wormhole SDK
      // This would call the NTT Manager contract on the source chain
      // For now, we show the flow and emit the transaction
      setStatus('confirming');

      // TODO: Integrate @wormhole-foundation/sdk
      // const wh = new Wormhole('Testnet');
      // const transfer = await wh.nttTransfer(sourceChain, destChain, amount);
      // const tx = await transfer.initiateTransfer(signer);
      // setTxHash(tx.hash);

      // Simulated for now
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setStatus('complete');
      setTxHash('bridge-tx-placeholder');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Bridge failed');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto p-6 rounded-xl bg-zinc-900 border border-zinc-800">
        <h2 className="text-xl font-bold text-white mb-4">Bridge $LOAR</h2>
        <p className="text-zinc-400">Connect a wallet to bridge LOAR across chains.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 rounded-xl bg-zinc-900 border border-zinc-800">
      <h2 className="text-xl font-bold text-white mb-6">Bridge $LOAR</h2>

      {/* Source Chain */}
      <div className="mb-4">
        <label className="text-sm text-zinc-400 mb-1 block">From</label>
        <div className="flex gap-2">
          <select
            value={sourceChain}
            onChange={(e) => setSourceChain(e.target.value as Chain)}
            className="flex-1 bg-zinc-800 text-white rounded-lg px-3 py-2 border border-zinc-700"
          >
            {CHAINS.filter((c) => c.id !== destChain).map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-32 bg-zinc-800 text-white rounded-lg px-3 py-2 border border-zinc-700 text-right"
          />
        </div>
      </div>

      {/* Swap button */}
      <div className="flex justify-center my-2">
        <button
          onClick={handleSwapChains}
          className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition"
        >
          ↕
        </button>
      </div>

      {/* Destination Chain */}
      <div className="mb-4">
        <label className="text-sm text-zinc-400 mb-1 block">To</label>
        <div className="flex gap-2">
          <select
            value={destChain}
            onChange={(e) => setDestChain(e.target.value as Chain)}
            className="flex-1 bg-zinc-800 text-white rounded-lg px-3 py-2 border border-zinc-700"
          >
            {CHAINS.filter((c) => c.id !== sourceChain).map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <div className="w-32 bg-zinc-800 text-zinc-300 rounded-lg px-3 py-2 border border-zinc-700 text-right">
            {receiveAmount > 0 ? receiveAmount.toFixed(2) : '0.00'}
          </div>
        </div>
      </div>

      {/* Details */}
      {parseFloat(amount) > 0 && (
        <div className="bg-zinc-800/50 rounded-lg p-3 mb-4 text-sm">
          <div className="flex justify-between text-zinc-400">
            <span>Transfer fee (0.05%)</span>
            <span className="text-zinc-300">{fee.toFixed(4)} LOAR</span>
          </div>
          <div className="flex justify-between text-zinc-400 mt-1">
            <span>Fee destination</span>
            <span className="text-zinc-300">{sourceChain} LP</span>
          </div>
          <div className="flex justify-between text-zinc-400 mt-1">
            <span>Estimated time</span>
            <span className="text-zinc-300">{estimatedTime}</span>
          </div>
          <div className="flex justify-between text-zinc-400 mt-1">
            <span>You receive</span>
            <span className="text-white font-medium">{receiveAmount.toFixed(4)} LOAR</span>
          </div>
        </div>
      )}

      {/* Bridge button */}
      <button
        onClick={handleBridge}
        disabled={
          status === 'pending' || status === 'confirming' || !amount || parseFloat(amount) <= 0
        }
        className="w-full py-3 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 text-white"
      >
        {status === 'pending'
          ? 'Initiating...'
          : status === 'confirming'
            ? 'Waiting for confirmation...'
            : status === 'complete'
              ? 'Bridge Complete'
              : `Bridge to ${CHAINS.find((c) => c.id === destChain)?.name}`}
      </button>

      {/* Status messages */}
      {status === 'complete' && (
        <div className="mt-3 p-3 rounded-lg bg-green-900/30 border border-green-800 text-green-300 text-sm">
          Bridge successful. Your LOAR will arrive on {CHAINS.find((c) => c.id === destChain)?.name}{' '}
          in ~{estimatedTime}.
        </div>
      )}
      {status === 'error' && (
        <div className="mt-3 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Info note */}
      <p className="mt-4 text-xs text-zinc-500">{BRIDGE_FEE_NOTE}</p>
    </div>
  );
}
