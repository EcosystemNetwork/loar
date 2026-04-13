/**
 * Approximate per-provider storage cost rates.
 *
 * These are estimates based on public pricing at the time of writing and
 * should be tuned as actual invoices come in. All values are USD per MB.
 *
 * Upload cost  = one-time transfer / pin fee
 * Monthly cost = ongoing storage per MB per month
 *
 * Sources (2026-Q1):
 *   Pinata       – $0.20/GB/month (hot IPFS pinning, includes bandwidth)
 *   Lighthouse   – Filecoin deal price ≈ $0.002/GB/month (Mainnet estimate)
 *   Firebase     – $0.026/GB/month (Cloud Storage Standard)
 *   Synapse      – Filecoin Calibration testnet (no real cost, negligible)
 */

export interface ProviderCostRate {
  /** One-time cost per MB transferred/pinned. */
  uploadCostPerMb: number;
  /** Ongoing monthly cost per MB stored. */
  monthlyCostPerMb: number;
}

export const STORAGE_COST_RATES: Record<string, ProviderCostRate> = {
  pinata: { uploadCostPerMb: 0, monthlyCostPerMb: 0.000195 }, // $0.20/GB
  lighthouse: { uploadCostPerMb: 0, monthlyCostPerMb: 0.000002 }, // $0.002/GB
  firebase: { uploadCostPerMb: 0.00001, monthlyCostPerMb: 0.0000254 }, // $0.026/GB + egress
  synapse: { uploadCostPerMb: 0, monthlyCostPerMb: 0 }, // testnet
};

/**
 * Estimate upload and monthly storage costs for a given provider + byte count.
 * Returns zeros for unknown providers rather than throwing.
 */
export function estimateCost(
  provider: string,
  bytes: number
): { uploadCostUsd: number; monthlyCostUsd: number; totalCostUsd: number } {
  const mb = bytes / (1024 * 1024);
  const rates = STORAGE_COST_RATES[provider] ?? { uploadCostPerMb: 0, monthlyCostPerMb: 0 };
  const uploadCostUsd = rates.uploadCostPerMb * mb;
  const monthlyCostUsd = rates.monthlyCostPerMb * mb;
  return {
    uploadCostUsd,
    monthlyCostUsd,
    totalCostUsd: uploadCostUsd + monthlyCostUsd,
  };
}
