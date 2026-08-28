/**
 * Chain-agnostic governance seam.
 *
 * Per docs/prd-solana-parity.md (risk table + decision #2): the UI should call
 * ONE governance hook and branch at the data layer, not fork components per
 * chain. EVM governance is OpenZeppelin Governor (`useUniverseGovernor`, wagmi);
 * Solana governance is Realms / SPL Governance (server-side `native-realms.ts`).
 *
 * Status:
 *   - EVM  → fully wired (pass-through to `useUniverseGovernor`).
 *   - Solana → NOT wired yet. `native-realms.ts` exists server-side but there
 *     are no `/api/governance/*` Solana endpoints. `useGovernance()` returns a
 *     `disabled` descriptor for Solana so callers render a "governance on
 *     Solana is coming" state instead of crashing. Wiring Realms is the
 *     follow-up to Phase 4b.
 */
import { useChain } from '@/hooks/useChain';
import { useUniverseGovernor } from '@/hooks/useUniverseGovernor';

export type GovernanceBackend = 'oz-governor' | 'realms';

export interface GovernanceDisabled {
  available: false;
  backend: GovernanceBackend;
  reason: string;
}

export interface GovernanceEvm {
  available: true;
  backend: 'oz-governor';
  /** The raw `useUniverseGovernor` bundle. Shape is wagmi-flavored by design —
   *  EVM callers already depend on it; this seam just gates it by chain. */
  evm: ReturnType<typeof useUniverseGovernor>;
}

export type GovernanceHandle = GovernanceEvm | GovernanceDisabled;

/**
 * @param governorAddress EVM Governor contract address for the universe. Ignored
 *   on Solana (Realms realm is derived server-side from the universe).
 */
export function useGovernance(governorAddress: `0x${string}` | undefined): GovernanceHandle {
  const { namespace } = useChain();

  // Hooks must run unconditionally — call the EVM hook every render regardless
  // of the active chain, then gate the return.
  const evm = useUniverseGovernor(governorAddress);

  if (namespace === 'solana') {
    return {
      available: false,
      backend: 'realms',
      reason: 'Governance on Solana (Realms) is not wired yet — vote on the EVM side for now.',
    };
  }

  return { available: true, backend: 'oz-governor', evm };
}

/** Which governance backend a given chain namespace uses. */
export function governanceBackendFor(namespace: 'eip155' | 'solana'): GovernanceBackend {
  return namespace === 'solana' ? 'realms' : 'oz-governor';
}
