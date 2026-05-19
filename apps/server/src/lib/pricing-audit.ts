/**
 * Pricing-gap audit.
 *
 * Walks the image/video registries on boot and logs any model marked
 * `isEnabled: true` with `providerCostUsd: 0`. At scale a $0 cost means
 * either:
 *
 *   1. The model is genuinely free at the provider (Z.AI free tier, etc.)
 *   2. The pricing was never looked up — we're paying real money but not
 *      tracking it in the cost ledger
 *
 * Case 2 is the one that quietly destroys margin. Loudest at boot so ops
 * can't miss it.
 *
 * Trigger on app start once. Set `LLM_PRICING_AUDIT_OFF=1` to suppress.
 */

import { IMAGE_MODELS } from '../services/image-models/registry';
import { VIDEO_MODELS } from '../services/video-models/registry';

interface PricingGap {
  registry: 'image' | 'video';
  id: string;
  provider: string;
  displayName: string;
}

/**
 * Returns the list of enabled-and-visible models with no provider cost set.
 * `bytedance` entries are flagged specifically because ByteDance Volces is
 * a paid API — any $0 entry there is almost certainly a missed lookup.
 */
export function findPricingGaps(): PricingGap[] {
  const gaps: PricingGap[] = [];
  for (const m of IMAGE_MODELS) {
    if (m.isEnabled && m.providerCostUsd === 0) {
      gaps.push({
        registry: 'image',
        id: m.id,
        provider: m.provider,
        displayName: m.displayName,
      });
    }
  }
  for (const m of VIDEO_MODELS) {
    if (m.isEnabled && m.providerCostUsd === 0) {
      gaps.push({
        registry: 'video',
        id: m.id,
        provider: m.provider,
        displayName: m.displayName,
      });
    }
  }
  return gaps;
}

let didLog = false;

export function auditPricingOnBoot(): void {
  if (didLog) return;
  didLog = true;
  if (process.env.LLM_PRICING_AUDIT_OFF === '1') return;

  const gaps = findPricingGaps();
  if (gaps.length === 0) return;

  const bytedanceGaps = gaps.filter((g) => g.provider === 'bytedance');
  const otherGaps = gaps.filter((g) => g.provider !== 'bytedance');

  if (bytedanceGaps.length > 0) {
    console.warn(
      `\n` +
        `╔═════════════════════════════════════════════════════════════════════╗\n` +
        `║  ⚠️  PRICING AUDIT — ByteDance $0 cost entries detected (${bytedanceGaps.length})            ║\n` +
        `╠═════════════════════════════════════════════════════════════════════╣\n` +
        `║  ByteDance Volces is a paid API. Models with providerCostUsd: 0     ║\n` +
        `║  are NOT being tracked in the cost ledger but ARE being billed.     ║\n` +
        `║  Verify against https://www.volcengine.com/ console and update      ║\n` +
        `║  apps/server/src/services/{image,video}-models/registry.ts.         ║\n` +
        `╚═════════════════════════════════════════════════════════════════════╝`
    );
    for (const g of bytedanceGaps) {
      console.warn(`   [${g.registry}] ${g.id}  —  ${g.displayName}`);
    }
  }

  if (otherGaps.length > 0) {
    console.warn(`[pricing-audit] Other $0-cost entries (likely intentional free tiers):`);
    for (const g of otherGaps) {
      console.warn(`   [${g.registry}] ${g.provider}/${g.id}  —  ${g.displayName}`);
    }
  }
}
