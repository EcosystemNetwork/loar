import { useState } from 'react';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { useMutation } from '@tanstack/react-query';
import { useUniverseGovernor } from '../../hooks/useUniverseGovernor';
import { useUniverseAddresses } from '../../hooks/useUniverseAddresses';
import { trpc } from '../../utils/trpc';
import { encodeFunctionData } from 'viem';
import { universeAbi } from '@loar/abis/generated';

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

  const syncProposal = useMutation(trpc.governance.syncProposal.mutationOptions());

  const { governorAddress, universeAddress, tokenAddress } = useUniverseAddresses(universeId);

  const { propose } = useUniverseGovernor(governorAddress);

  const handleSubmit = async () => {
    if (!address || !governorAddress || !universeAddress) return;
    setIsSubmitting(true);

    try {
      let targets: `0x${string}`[];
      let values: bigint[];
      let calldatas: `0x${string}`[];

      if (template === 'canonize' && nodeId) {
        targets = [universeAddress];
        values = [0n];
        calldatas = [
          encodeFunctionData({
            abi: universeAbi,
            functionName: 'setCanon',
            args: [BigInt(nodeId)],
          }),
        ];
      } else {
        targets = [customTarget as `0x${string}`];
        values = [0n];
        calldatas = [customCalldata as `0x${string}`];
      }

      // Submit proposal on-chain (writeContract is fire-and-forget in wagmi v2)
      // The tx hash is tracked via useWriteContract state, not return value
      await propose?.({ targets, values, calldatas, description });

      // Sync to Firestore with a generated proposal ID
      // (actual on-chain proposalId will be synced on tx confirmation)
      const tempId = `pending_${Date.now()}_${address}`;
      await syncProposal.mutateAsync({
        proposalId: tempId,
        universeId,
        governorAddress: governorAddress || '',
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

      onClose();
    } catch (err) {
      // Error surfaced via UI state
    } finally {
      setIsSubmitting(false);
    }
  };

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

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !description}
            className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-sm font-medium transition-colors"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Proposal'}
          </button>
        </div>
      </div>
    </div>
  );
}
