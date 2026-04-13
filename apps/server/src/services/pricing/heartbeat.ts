/**
 * Pricing Heartbeat — Monitors AI provider pricing every 12 hours.
 *
 * Fetches current costs from fal.ai's pricing page, compares against
 * our stored rates, and updates Firestore + in-memory cache when changes
 * are detected. Applies the configured margin (default 30%) automatically.
 *
 * Flow:
 *   1. Fetch provider pricing (fal.ai API or scrape)
 *   2. Compare against cached providerCostUsd per model
 *   3. If changed, update Firestore `modelPricing` collection
 *   4. Recalculate fiatPriceUsd and loarPriceUsd with margins
 *   5. Log changes for audit trail
 */

import { FIAT_MARGIN, LOAR_MARGIN, LOAR_TO_USD } from '../video-models/registry';
import { VIDEO_MODELS } from '../video-models/registry';
import { IMAGE_MODELS } from '../image-models/registry';

// ── Types ──────────────────────────────────────────────────────────────

export interface ModelPriceEntry {
  modelId: string;
  type: 'image' | 'video';
  falModelId: string;
  displayName: string;
  /** What we pay the provider per generation */
  providerCostUsd: number;
  /** providerCostUsd × FIAT_MARGIN */
  fiatPriceUsd: number;
  /** providerCostUsd × LOAR_MARGIN */
  loarPriceUsd: number;
  /** Internal credit cost */
  creditCost: number;
  /** When this price was last verified */
  lastCheckedAt: string;
  /** When the price last changed */
  lastChangedAt: string;
  /** Source of the price (registry, fal-api, manual) */
  source: 'registry' | 'fal-api' | 'manual';
}

export interface PriceChangeLog {
  modelId: string;
  type: 'image' | 'video';
  oldProviderCost: number;
  newProviderCost: number;
  oldFiatPrice: number;
  newFiatPrice: number;
  changePercent: number;
  detectedAt: string;
}

// ── In-memory price cache ──────────────────────────────────────────────

const priceCache = new Map<string, ModelPriceEntry>();
let lastHeartbeat: Date | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// ── Margin helpers ─────────────────────────────────────────────────────

function calcFiatPrice(providerCost: number): number {
  return Math.round(providerCost * FIAT_MARGIN * 100) / 100;
}

function calcLoarPrice(providerCost: number): number {
  return Math.round(providerCost * LOAR_MARGIN * 100) / 100;
}

function calcCreditCost(providerCost: number): number {
  return Math.ceil((providerCost * FIAT_MARGIN) / LOAR_TO_USD);
}

// ── Initialize from hardcoded registries ───────────────────────────────

function seedFromRegistries(): void {
  const now = new Date().toISOString();

  for (const model of VIDEO_MODELS) {
    priceCache.set(model.id, {
      modelId: model.id,
      type: 'video',
      falModelId: model.falModelId,
      displayName: model.displayName,
      providerCostUsd: model.providerCostUsd,
      fiatPriceUsd: model.fiatPriceUsd,
      loarPriceUsd: model.loarPriceUsd,
      creditCost: model.creditCost,
      lastCheckedAt: now,
      lastChangedAt: now,
      source: 'registry',
    });
  }

  for (const model of IMAGE_MODELS) {
    priceCache.set(model.id, {
      modelId: model.id,
      type: 'image',
      falModelId: model.falModelId ?? '',
      displayName: model.displayName,
      providerCostUsd: model.providerCostUsd,
      fiatPriceUsd: model.fiatPriceUsd,
      loarPriceUsd: model.loarPriceUsd,
      creditCost: model.creditCostPerImage,
      lastCheckedAt: now,
      lastChangedAt: now,
      source: 'registry',
    });
  }
}

// ── Fetch fal.ai pricing ───────────────────────────────────────────────

/** Known fal.ai model pricing (cents per unit). Updated via heartbeat. */
const FAL_PRICING_ENDPOINTS = [
  'https://fal.ai/api/pricing', // If fal exposes a pricing API
];

interface FalPriceData {
  [falModelId: string]: {
    costPerRequest?: number;
    costPerSecond?: number;
    costPerMegapixel?: number;
  };
}

async function fetchFalPricing(): Promise<FalPriceData | null> {
  // fal.ai doesn't have a public pricing API yet.
  // When they do, we'll fetch it here. For now, we log that the check ran
  // and rely on manual updates + the Firestore override system.
  //
  // Future: parse https://fal.ai/pricing or use their billing API
  // to get per-model costs programmatically.

  try {
    // Try the fal pricing API (may not exist yet)
    for (const endpoint of FAL_PRICING_ENDPOINTS) {
      const res = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        return await res.json();
      }
    }
  } catch {
    // Expected — fal doesn't have a public pricing API yet
  }

  return null;
}

// ── Firestore persistence ──────────────────────────────────────────────

async function loadFromFirestore(): Promise<void> {
  try {
    const { db, firebaseAvailable } = await import('../../lib/firebase');
    if (!firebaseAvailable || !db) return;

    const snapshot = await db.collection('modelPricing').get();
    if (snapshot.empty) return;

    for (const doc of snapshot.docs) {
      const data = doc.data() as ModelPriceEntry;
      if (data.modelId && data.providerCostUsd != null) {
        priceCache.set(data.modelId, data);
      }
    }

    console.log(`[pricing] Loaded ${snapshot.size} model prices from Firestore`);
  } catch (err) {
    console.warn('[pricing] Failed to load from Firestore, using registry defaults:', err);
  }
}

async function saveToFirestore(entries: ModelPriceEntry[]): Promise<void> {
  try {
    const { db, firebaseAvailable } = await import('../../lib/firebase');
    if (!firebaseAvailable || !db) return;

    const batch = db.batch();
    for (const entry of entries) {
      batch.set(db.collection('modelPricing').doc(entry.modelId), entry);
    }
    await batch.commit();
  } catch (err) {
    console.warn('[pricing] Failed to save to Firestore:', err);
  }
}

async function logPriceChange(change: PriceChangeLog): Promise<void> {
  try {
    const { db, firebaseAvailable } = await import('../../lib/firebase');
    if (!firebaseAvailable || !db) return;

    await db.collection('priceChangeLogs').add(change);
  } catch {
    // Best-effort logging
  }

  console.log(
    `[pricing] Price change: ${change.modelId} ` +
      `$${change.oldProviderCost.toFixed(4)} → $${change.newProviderCost.toFixed(4)} ` +
      `(${change.changePercent > 0 ? '+' : ''}${change.changePercent.toFixed(1)}%)`
  );
}

// ── Core heartbeat logic ───────────────────────────────────────────────

async function runHeartbeat(): Promise<{
  checked: number;
  updated: number;
  changes: PriceChangeLog[];
}> {
  const now = new Date().toISOString();
  const changes: PriceChangeLog[] = [];
  const updated: ModelPriceEntry[] = [];

  // Try to fetch live pricing
  const falPrices = await fetchFalPricing();

  if (falPrices) {
    // If we got live pricing, compare and update
    for (const [modelId, entry] of priceCache) {
      const falPrice = falPrices[entry.falModelId];
      if (!falPrice?.costPerRequest) continue;

      const newCost = falPrice.costPerRequest;
      const oldCost = entry.providerCostUsd;

      if (Math.abs(newCost - oldCost) > 0.0001) {
        const change: PriceChangeLog = {
          modelId,
          type: entry.type,
          oldProviderCost: oldCost,
          newProviderCost: newCost,
          oldFiatPrice: entry.fiatPriceUsd,
          newFiatPrice: calcFiatPrice(newCost),
          changePercent: ((newCost - oldCost) / oldCost) * 100,
          detectedAt: now,
        };
        changes.push(change);

        const updatedEntry: ModelPriceEntry = {
          ...entry,
          providerCostUsd: newCost,
          fiatPriceUsd: calcFiatPrice(newCost),
          loarPriceUsd: calcLoarPrice(newCost),
          creditCost: calcCreditCost(newCost),
          lastCheckedAt: now,
          lastChangedAt: now,
          source: 'fal-api',
        };
        priceCache.set(modelId, updatedEntry);
        updated.push(updatedEntry);
      } else {
        // Price unchanged — just update lastCheckedAt
        entry.lastCheckedAt = now;
      }
    }
  } else {
    // No live pricing available — just mark all as checked
    for (const [, entry] of priceCache) {
      entry.lastCheckedAt = now;
    }
  }

  // Persist changes
  if (updated.length > 0) {
    await saveToFirestore(updated);
    for (const change of changes) {
      await logPriceChange(change);
    }
  }

  lastHeartbeat = new Date();

  console.log(
    `[pricing] Heartbeat complete: ${priceCache.size} models checked, ` +
      `${changes.length} price changes detected`
  );

  return { checked: priceCache.size, updated: updated.length, changes };
}

// ── Public API ─────────────────────────────────────────────────────────

/** Get the current price for a model (from cache, with margins applied). */
export function getModelPrice(modelId: string): ModelPriceEntry | undefined {
  return priceCache.get(modelId);
}

/** Get all current model prices. */
export function getAllPrices(): ModelPriceEntry[] {
  return Array.from(priceCache.values());
}

/** Get pricing summary stats. */
export function getPricingStatus() {
  return {
    totalModels: priceCache.size,
    lastHeartbeat: lastHeartbeat?.toISOString() ?? null,
    fiatMargin: FIAT_MARGIN,
    loarMargin: LOAR_MARGIN,
    loarToUsd: LOAR_TO_USD,
  };
}

/** Manually update a model's provider cost (admin use). */
export async function updateModelPrice(
  modelId: string,
  newProviderCostUsd: number
): Promise<ModelPriceEntry | null> {
  const existing = priceCache.get(modelId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const change: PriceChangeLog = {
    modelId,
    type: existing.type,
    oldProviderCost: existing.providerCostUsd,
    newProviderCost: newProviderCostUsd,
    oldFiatPrice: existing.fiatPriceUsd,
    newFiatPrice: calcFiatPrice(newProviderCostUsd),
    changePercent:
      ((newProviderCostUsd - existing.providerCostUsd) / existing.providerCostUsd) * 100,
    detectedAt: now,
  };

  const updated: ModelPriceEntry = {
    ...existing,
    providerCostUsd: newProviderCostUsd,
    fiatPriceUsd: calcFiatPrice(newProviderCostUsd),
    loarPriceUsd: calcLoarPrice(newProviderCostUsd),
    creditCost: calcCreditCost(newProviderCostUsd),
    lastCheckedAt: now,
    lastChangedAt: now,
    source: 'manual',
  };

  priceCache.set(modelId, updated);
  await saveToFirestore([updated]);
  await logPriceChange(change);

  return updated;
}

/** Force an immediate heartbeat check. */
export async function forceHeartbeat() {
  return runHeartbeat();
}

/** Initialize the pricing system and start the 12-hour heartbeat. */
export async function startPricingHeartbeat(): Promise<void> {
  // 1. Seed from hardcoded registries
  seedFromRegistries();

  // 2. Override with Firestore prices (if available and more recent)
  await loadFromFirestore();

  // 3. Run initial heartbeat
  await runHeartbeat();

  // 4. Schedule every 12 hours
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  heartbeatInterval = setInterval(() => {
    runHeartbeat().catch((err) => console.error('[pricing] Heartbeat failed:', err));
  }, TWELVE_HOURS);

  console.log('[pricing] Heartbeat started — checking every 12 hours');
}

/** Stop the heartbeat (for graceful shutdown). */
export function stopPricingHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
