/**
 * Distribution Service Tests
 *
 * Tests the pure calculateDistribution function which implements the nested
 * 50/30/20 budget allocation system across 3 engines and 9 sub-wallets.
 * No DB or mocks needed — all scenarios are deterministic.
 */

const { calculateDistribution, DISTRIBUTION_PERCENTAGES } = require('../utils/distributionService');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Sum all 9 sub-wallet amounts from a distribution result. */
function sumAllSubWallets(d) {
  return (
    d.growthEngine.marketing +
    d.growthEngine.operations +
    d.growthEngine.savings +
    d.fulfillmentEngine.marketing +
    d.fulfillmentEngine.operations +
    d.fulfillmentEngine.savings +
    d.innovationEngine.marketing +
    d.innovationEngine.operations +
    d.innovationEngine.savings
  );
}

/** Sum all three engine totals. */
function sumEngineTotals(d) {
  return d.growthEngine.total + d.fulfillmentEngine.total + d.innovationEngine.total;
}

const AMOUNT = 1_000;

// ─── Suite 1: Engine-level splits ───────────────────────────────────────────

describe('calculateDistribution — engine-level splits', () => {

  test('S01: growthEngine.total = 50% of input', () => {
    const d = calculateDistribution(AMOUNT);
    expect(d.growthEngine.total).toBe(AMOUNT * 0.50);
  });

  test('S02: fulfillmentEngine.total = 30% of input', () => {
    const d = calculateDistribution(AMOUNT);
    expect(d.fulfillmentEngine.total).toBe(AMOUNT * 0.30);
  });

  test('S03: innovationEngine.total = 20% of input', () => {
    const d = calculateDistribution(AMOUNT);
    expect(d.innovationEngine.total).toBe(AMOUNT * 0.20);
  });

  test('S04: three engine totals sum to input amount', () => {
    const d = calculateDistribution(AMOUNT);
    expect(sumEngineTotals(d)).toBeCloseTo(AMOUNT, 10);
  });

  test('S05: d.total equals input amount', () => {
    const d = calculateDistribution(AMOUNT);
    expect(d.total).toBe(AMOUNT);
  });

});

// ─── Suite 2: Sub-wallet amounts for ₦1,000 ─────────────────────────────────

describe('calculateDistribution — sub-wallet amounts (₦1,000 base)', () => {

  test('S06: growthEngine.marketing = ₦250 (25% of total)', () => {
    expect(calculateDistribution(AMOUNT).growthEngine.marketing).toBe(250);
  });

  test('S07: growthEngine.operations = ₦150 (15% of total)', () => {
    expect(calculateDistribution(AMOUNT).growthEngine.operations).toBe(150);
  });

  test('S08: growthEngine.savings = ₦100 (10% of total)', () => {
    expect(calculateDistribution(AMOUNT).growthEngine.savings).toBe(100);
  });

  test('S09: fulfillmentEngine.marketing = ₦150 (15% of total)', () => {
    expect(calculateDistribution(AMOUNT).fulfillmentEngine.marketing).toBe(150);
  });

  test('S10: fulfillmentEngine.operations = ₦90 (9% of total)', () => {
    expect(calculateDistribution(AMOUNT).fulfillmentEngine.operations).toBe(90);
  });

  test('S11: fulfillmentEngine.savings = ₦60 (6% of total — family)', () => {
    expect(calculateDistribution(AMOUNT).fulfillmentEngine.savings).toBe(60);
  });

  test('S12: innovationEngine.marketing = ₦100 (10% of total)', () => {
    expect(calculateDistribution(AMOUNT).innovationEngine.marketing).toBe(100);
  });

  test('S13: innovationEngine.operations = ₦60 (6% of total)', () => {
    expect(calculateDistribution(AMOUNT).innovationEngine.operations).toBe(60);
  });

  test('S14: innovationEngine.savings = ₦40 (4% of total)', () => {
    expect(calculateDistribution(AMOUNT).innovationEngine.savings).toBe(40);
  });

  test('S15: all 9 sub-wallets sum to input amount', () => {
    const d = calculateDistribution(AMOUNT);
    expect(sumAllSubWallets(d)).toBeCloseTo(AMOUNT, 10);
  });

});

// ─── Suite 3: Internal ratios within each engine (50/30/20) ─────────────────

describe('calculateDistribution — internal 50/30/20 ratios per engine', () => {

  test('S16: growthEngine marketing:operations:savings = 50:30:20', () => {
    const g = calculateDistribution(AMOUNT).growthEngine;
    expect(g.marketing / g.total).toBeCloseTo(0.50, 10);
    expect(g.operations / g.total).toBeCloseTo(0.30, 10);
    expect(g.savings / g.total).toBeCloseTo(0.20, 10);
  });

  test('S17: fulfillmentEngine marketing:operations:savings = 50:30:20', () => {
    const f = calculateDistribution(AMOUNT).fulfillmentEngine;
    expect(f.marketing / f.total).toBeCloseTo(0.50, 10);
    expect(f.operations / f.total).toBeCloseTo(0.30, 10);
    expect(f.savings / f.total).toBeCloseTo(0.20, 10);
  });

  test('S18: innovationEngine marketing:operations:savings = 50:30:20', () => {
    const i = calculateDistribution(AMOUNT).innovationEngine;
    expect(i.marketing / i.total).toBeCloseTo(0.50, 10);
    expect(i.operations / i.total).toBeCloseTo(0.30, 10);
    expect(i.savings / i.total).toBeCloseTo(0.20, 10);
  });

});

// ─── Suite 4: Edge cases & scaling ──────────────────────────────────────────

describe('calculateDistribution — edge cases', () => {

  test('S19: zero amount → all values are 0', () => {
    const d = calculateDistribution(0);
    expect(d.growthEngine.marketing).toBe(0);
    expect(d.fulfillmentEngine.savings).toBe(0);
    expect(d.innovationEngine.operations).toBe(0);
    expect(d.total).toBe(0);
  });

  test('S20: scales linearly — ₦10,000 gives 10× the ₦1,000 values', () => {
    const d1 = calculateDistribution(1_000);
    const d10 = calculateDistribution(10_000);
    expect(d10.growthEngine.marketing).toBeCloseTo(d1.growthEngine.marketing * 10, 10);
    expect(d10.fulfillmentEngine.savings).toBeCloseTo(d1.fulfillmentEngine.savings * 10, 10);
    expect(d10.innovationEngine.operations).toBeCloseTo(d1.innovationEngine.operations * 10, 10);
  });

  test('S21: large amount ₦1,000,000 — all 9 sub-wallets still sum to total', () => {
    const d = calculateDistribution(1_000_000);
    expect(sumAllSubWallets(d)).toBeCloseTo(1_000_000, 5);
  });

  test('S22: fractional input ₦333.33 — d.total reflects input', () => {
    const amount = 333.33;
    const d = calculateDistribution(amount);
    expect(d.total).toBe(amount);
  });

  test('S23: fractional input — 9 sub-wallets still sum to total', () => {
    const amount = 777.77;
    const d = calculateDistribution(amount);
    expect(sumAllSubWallets(d)).toBeCloseTo(amount, 8);
  });

});

// ─── Suite 5: DISTRIBUTION_PERCENTAGES constant shape ───────────────────────

describe('DISTRIBUTION_PERCENTAGES — constant integrity', () => {

  test('S24: each engine sub-percentages sum to 1.00', () => {
    for (const engine of ['growthEngine', 'fulfillmentEngine', 'innovationEngine']) {
      const e = DISTRIBUTION_PERCENTAGES[engine];
      expect(e.marketing + e.operations + e.savings).toBeCloseTo(1.0, 10);
    }
  });

  test('S25: all three engines have marketing = 0.50', () => {
    expect(DISTRIBUTION_PERCENTAGES.growthEngine.marketing).toBe(0.50);
    expect(DISTRIBUTION_PERCENTAGES.fulfillmentEngine.marketing).toBe(0.50);
    expect(DISTRIBUTION_PERCENTAGES.innovationEngine.marketing).toBe(0.50);
  });

});
