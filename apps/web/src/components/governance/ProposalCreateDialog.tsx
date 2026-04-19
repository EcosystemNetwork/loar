import { useState } from 'react';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { useMutation } from '@tanstack/react-query';
import { useUniverseGovernor } from '../../hooks/useUniverseGovernor';
import { useUniverseAddresses } from '../../hooks/useUniverseAddresses';
import { trpc } from '../../utils/trpc';
import { encodeFunctionData, isAddress, isHex } from 'viem';
import { universeAbi } from '@loar/abis/generated';
import { toast } from 'sonner';

type ProposalTemplate = 'canonize' | 'custom';

export function ProposalCreateDialog({
  universeId,
  onClose,
}: {
  universeId: string;
  onClose: () => void;
}) {
  const { address } = useAccount();
  const [template, setTemplate] = useState<ProposalTemplate>('canonize');
  const [description, setDescription] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [customTarget, setCustomTarget] = useState('');
  const [customCalldata, setCustomCalldata] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const syncProposal = useMutation(trpc.governance.syncProposal.mutationOptions());

  const { governorAddress, universeAddress, tokenAddress } = useUniverseAddresses(universeId);

  const { propose, isPending, isConfirming } = useUniverseGovernor(governorAddress);

  const handleSubmit = async () => {
    setErrorMsg(null);
    if (!address || !governorAddress || !universeAddress) {
      setErrorMsg('Wallet or governor not available');
      return;
    }
    if (!description.trim()) {
      setErrorMsg('Description is required');
      return;
    }

    let targets: `0x${string}`[];
    let values: bigint[];
    let calldatas: `0x${string}`[];

    try {
      if (template === 'canonize') {
        if (!nodeId) throw new Error('Node ID is required');
        const nodeBig = BigInt(nodeId);
        targets = [universeAddress];
        values = [0n];
        calldatas = [
          encodeFunctionData({
            abi: universeAbi,
            functionName: 'setCanon',
            args: [nodeBig],
          }),
        ];
      } else {
        if (!isAddress(customTarget)) throw new Error('Target must be a valid 0x address');
        if (!isHex(customCalldata)) throw new Error('Calldata must be a 0x-prefixed hex string');
        targets = [customTarget as `0x${string}`];
        values = [0n];
        calldatas = [customCalldata as `0x${string}`];
      }
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Invalid input');
      return;
    }

    setIsSubmitting(true);
    try {
      const { txHash, proposalId } = await propose({
        targets,
        values,
        calldatas,
        description,
      });

      // Sync to Firestore using the real on-chain proposalId when we can parse it.
      // Fall back to the tx hash (still unique) when the receipt wasn't available.
      const syncedId = proposalId !== null ? proposalId.toString() : txHash;
      await syncProposal.mutateAsync({
        proposalId: syncedId,
        universeId,
        governorAddress,
        tokenAddress: tokenAddress || '',
        description,
        proposer: address,
        targets: targets.map(String),
        values: values.map(String),
        calldatas: calldatas.map(String),
        state: 'Pending',
        startBlock: 0,
        endBlock: 0,
      });

      toast.success('Proposal created', {
        description:
          proposalId !== null
            ? `Proposal #${syncedId.slice(0, 10)}…`
            : `Tx: ${txHash.slice(0, 10)}…`,
      });
      onClose();
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Proposal submission failed';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const busy = isSubmitting || isPending || isConfirming;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Create Proposal</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        {/* Template selector */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTemplate('canonize')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              template === 'canonize' ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            Canonize Node
          </button>
          <button
            onClick={() => setTemplate('custom')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              template === 'custom' ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            Custom Action
          </button>
        </div>

        <div className="space-y-4">
          {template === 'canonize' && (
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Node ID to canonize</label>
              <input
                type="number"
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                placeholder="42"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
              />
            </div>
          )}

          {template === 'custom' && (
            <>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Target Contract</label>
                <input
                  type="text"
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Calldata (hex)</label>
                <input
                  type="text"
                  value={customCalldata}
                  onChange={(e) => setCustomCalldata(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe why this proposal should pass..."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 resize-none"
            />
          </div>
        </div>

        {errorMsg && (
          <p className="text-xs text-red-400 mt-4" role="alert">
            {errorMsg}
          </p>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || !description}
            className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-sm font-medium transition-colors"
          >
            {busy ? 'Submitting...' : 'Submit Proposal'}
          </button>
        </div>
      </div>
    </div>
  );
}
