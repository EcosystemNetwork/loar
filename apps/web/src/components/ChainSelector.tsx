/**
 * ChainSelector — the shared "deploy on" chain picker.
 *
 * Renders one <Select> over `SUPPORTED_CHAINS` (EVM chains always; the active
 * Solana cluster too, but only when the build sets `VITE_SOLANA_CLUSTER` — see
 * `@/configs/chains`). When only a single option is available it renders
 * nothing, so callers can drop it in unconditionally.
 *
 * Presentational only: it takes a `ChainSelection` + setter. Callers that want
 * the choice to persist across the app should pass `useChain()`'s
 * `chain` / `setChain`. The universe-create wizard keeps its own local state
 * (it also drives a wagmi chain switch) and passes that instead.
 */
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SUPPORTED_CHAINS,
  chainOptionById,
  evmChainIdToSelectionId,
  type ChainSelection,
} from '@/configs/chains';

export interface ChainSelectorProps {
  value: ChainSelection;
  onChange: (next: ChainSelection) => void;
  disabled?: boolean;
  /** Field label. Pass null to render the <Select> with no label. */
  label?: string | null;
  className?: string;
}

function selectionToId(sel: ChainSelection): string {
  return sel.kind === 'evm' ? evmChainIdToSelectionId(sel.chainId) : `solana:${sel.cluster}`;
}

export function ChainSelector({
  value,
  onChange,
  disabled,
  label = 'Deploy on',
  className,
}: ChainSelectorProps) {
  // Nothing to choose — keep the form clean.
  if (SUPPORTED_CHAINS.length < 2) return null;

  return (
    <div className={className}>
      {label !== null && <Label className="text-sm font-semibold mb-2 block">{label}</Label>}
      <Select
        value={selectionToId(value)}
        onValueChange={(id) => {
          const opt = chainOptionById(id);
          if (opt) onChange(opt.selection);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="h-11">
          <SelectValue placeholder="Select network" />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_CHAINS.map((opt) => (
            <SelectItem key={opt.id} value={opt.id}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
