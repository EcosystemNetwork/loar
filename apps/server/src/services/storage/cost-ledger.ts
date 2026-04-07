/**
 * CostLedger — persists per-operation cost entries to Firestore `costLedger`.
 *
 * Records both storage upload costs (driven by StorageManager) and AI
 * generation costs (driven by the model router), so the team can answer
 * "what did this generation cost end-to-end?" for any contentHash or userId.
 */
import { db } from '../../lib/firebase';
import type { CostEntry } from './types';
import { estimateCost } from './cost-rates';

const COLLECTION = 'costLedger';

export class CostLedger {
  private static instance: CostLedger | null = null;

  static getInstance(): CostLedger {
    if (!this.instance) this.instance = new CostLedger();
    return this.instance;
  }

  // ─── Write ─────────────────────────────────────────────────

  /** Persist a cost entry. Returns the saved entry with its generated ID. */
  async record(entry: Omit<CostEntry, 'id'>): Promise<CostEntry> {
    const id = crypto.randomUUID();
    const full: CostEntry = { ...entry, id };
    try {
      await db.collection(COLLECTION).doc(id).set(full);
    } catch (err) {
      console.error('[CostLedger] Failed to record entry:', err);
    }
    return full;
  }

  /**
   * Convenience: record a storage upload cost derived from provider + bytes.
   * Skips write if both cost values are zero (e.g. testnet providers).
   */
  async recordUpload(opts: {
    provider: string;
    bytes: number;
    contentHash?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<CostEntry | null> {
    const { uploadCostUsd, monthlyCostUsd, totalCostUsd } = estimateCost(opts.provider, opts.bytes);

    if (totalCostUsd === 0) return null; // skip zero-cost providers (testnet)

    return this.record({
      userId: opts.userId,
      contentHash: opts.contentHash,
      operation: 'upload',
      provider: opts.provider,
      bytes: opts.bytes,
      estimatedUploadCostUsd: uploadCostUsd,
      estimatedMonthlyCostUsd: monthlyCostUsd,
      totalCostUsd,
      metadata: opts.metadata,
      createdAt: Date.now(),
    });
  }

  /**
   * Record an AI generation cost (e.g. from model router).
   * costUsd should be the total charge including LOAR margin.
   */
  async recordGeneration(opts: {
    provider: string; // e.g. 'runway', 'kling', 'luma'
    costUsd: number;
    contentHash?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<CostEntry> {
    return this.record({
      userId: opts.userId,
      contentHash: opts.contentHash,
      operation: 'generation',
      provider: opts.provider,
      bytes: 0,
      estimatedUploadCostUsd: 0,
      estimatedMonthlyCostUsd: 0,
      totalCostUsd: opts.costUsd,
      metadata: opts.metadata,
      createdAt: Date.now(),
    });
  }

  // ─── Read ──────────────────────────────────────────────────

  async getByUser(userId: string, limit = 50): Promise<CostEntry[]> {
    try {
      const snap = await db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.data() as CostEntry);
    } catch {
      return [];
    }
  }

  async getByContentHash(contentHash: string): Promise<CostEntry[]> {
    try {
      const snap = await db.collection(COLLECTION).where('contentHash', '==', contentHash).get();
      return snap.docs.map((d) => d.data() as CostEntry);
    } catch {
      return [];
    }
  }

  /**
   * Aggregate cost summary for a user.
   * Reads up to 1 000 entries — suitable for dashboards, not billing.
   */
  async summarizeByUser(userId: string): Promise<CostSummary> {
    const entries = await this.getByUser(userId, 1000);
    return summarize(entries);
  }

  /**
   * Full cost breakdown for a single asset (contentHash).
   * Includes both storage and generation costs if linked.
   */
  async summarizeByContentHash(contentHash: string): Promise<CostSummary> {
    const entries = await this.getByContentHash(contentHash);
    return summarize(entries);
  }
}

export interface ProviderCostBreakdown {
  uploadCostUsd: number;
  monthlyCostUsd: number;
  totalCostUsd: number;
  count: number;
}

export interface CostSummary {
  totalUploadCostUsd: number;
  totalMonthlyCostUsd: number;
  totalCostUsd: number;
  byProvider: Record<string, ProviderCostBreakdown>;
  byOperation: Record<string, number>;
  entryCount: number;
}

function summarize(entries: CostEntry[]): CostSummary {
  const byProvider: Record<string, ProviderCostBreakdown> = {};
  const byOperation: Record<string, number> = {};
  let totalUpload = 0;
  let totalMonthly = 0;

  for (const e of entries) {
    totalUpload += e.estimatedUploadCostUsd;
    totalMonthly += e.estimatedMonthlyCostUsd;

    if (!byProvider[e.provider]) {
      byProvider[e.provider] = { uploadCostUsd: 0, monthlyCostUsd: 0, totalCostUsd: 0, count: 0 };
    }
    byProvider[e.provider].uploadCostUsd += e.estimatedUploadCostUsd;
    byProvider[e.provider].monthlyCostUsd += e.estimatedMonthlyCostUsd;
    byProvider[e.provider].totalCostUsd += e.totalCostUsd;
    byProvider[e.provider].count++;

    byOperation[e.operation] = (byOperation[e.operation] ?? 0) + e.totalCostUsd;
  }

  return {
    totalUploadCostUsd: totalUpload,
    totalMonthlyCostUsd: totalMonthly,
    totalCostUsd: totalUpload + totalMonthly,
    byProvider,
    byOperation,
    entryCount: entries.length,
  };
}

export function getCostLedger(): CostLedger {
  return CostLedger.getInstance();
}
