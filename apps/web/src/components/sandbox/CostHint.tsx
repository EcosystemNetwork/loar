import { batchCostLabel } from '@/lib/generation-cost';
import type { CostEstimate } from '@/hooks/useGenerationCost';

/**
 * Pre-submit price line above the generate buttons. Renders nothing until the
 * estimate has loaded (or if it can't be resolved), so it never advertises a
 * made-up number.
 */
export function CostHint({
  noun,
  estimate,
  count = 1,
}: {
  noun: string;
  estimate: CostEstimate | null;
  count?: number;
}) {
  if (!estimate) return null;
  return (
    <p className="text-[11px] text-muted-foreground -mt-1" data-testid={`${noun}-cost-hint`}>
      {noun[0].toUpperCase() + noun.slice(1)} with {estimate.modelName}:{' '}
      {batchCostLabel(estimate.unitUsd, count)}
      {count <= 1 ? ' per generation' : ''}
    </p>
  );
}
