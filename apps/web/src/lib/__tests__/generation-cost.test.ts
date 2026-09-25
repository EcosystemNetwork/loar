import { describe, expect, it } from 'vitest';
import {
  SPEND_CONFIRM_THRESHOLD_USD,
  batchCostLabel,
  formatUsd,
  needsSpendConfirm,
} from '../generation-cost';

describe('formatUsd', () => {
  it('shows Free for zero, negative or non-finite prices', () => {
    expect(formatUsd(0)).toBe('Free');
    expect(formatUsd(-1)).toBe('Free');
    expect(formatUsd(NaN)).toBe('Free');
  });
  it('uses three decimals for sub-dime prices and two otherwise', () => {
    expect(formatUsd(0.04)).toBe('~$0.040');
    expect(formatUsd(1.05)).toBe('~$1.05');
  });
});

describe('needsSpendConfirm', () => {
  it('triggers at and above the threshold, not below', () => {
    expect(needsSpendConfirm(SPEND_CONFIRM_THRESHOLD_USD)).toBe(true);
    expect(needsSpendConfirm(4.99)).toBe(false);
  });
  it('multiplies by count so a cheap batch can still trip it', () => {
    expect(needsSpendConfirm(1.25, 4)).toBe(true);
    expect(needsSpendConfirm(1.25, 3)).toBe(false);
  });
  it('never triggers on free or invalid prices', () => {
    expect(needsSpendConfirm(0, 4)).toBe(false);
    expect(needsSpendConfirm(NaN, 4)).toBe(false);
  });
});

describe('batchCostLabel', () => {
  it('shows only the price for a single item', () => {
    expect(batchCostLabel(0.04, 1)).toBe('~$0.040');
  });
  it('shows the arithmetic for a batch', () => {
    expect(batchCostLabel(0.04, 4)).toBe('~$0.040 each · 4× = ~$0.16');
  });
  it('shows Free for free batches', () => {
    expect(batchCostLabel(0, 4)).toBe('Free');
  });
});
