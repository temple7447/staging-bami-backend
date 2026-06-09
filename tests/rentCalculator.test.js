/**
 * Rent Calculator Tests
 *
 * Tests the 26% biennial increase rule across many tenant scenarios.
 * Simulates getCurrentRent and calculateEffectiveRent at specific points in time
 * by overriding Date so results are deterministic regardless of when tests run.
 */

const { getCurrentRent, calculateEffectiveRent } = require('../utils/rentCalculator');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Freeze Date so getCurrentRent sees a fixed "now". */
function withDate(isoString, fn) {
  const RealDate = global.Date;
  const frozen = new RealDate(isoString);

  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(isoString);
      else super(...args);
    }
    static now() { return frozen.getTime(); }
  }
  // preserve static methods
  Object.setPrototypeOf(MockDate, RealDate);

  global.Date = MockDate;
  try { return fn(); }
  finally { global.Date = RealDate; }
}

const BASE_RENT   = 35_000;   // Flat 3 rent (₦35,000/month)
const BASE_SVC    =  10_000;  // Flat 3 service charge (₦10,000/month)
const INCREASE    = 1.26;

function increased(base, cycles = 1) {
  return Math.round(base * Math.pow(INCREASE, cycles));
}

// ─── Suite 1: getCurrentRent – point-in-time snapshots ──────────────────────

describe('getCurrentRent — 26% every 2 years (occupied)', () => {

  // Scenario 1: Day of move-in — no cycles yet
  test('S01: Move-in day → base rate', () => {
    withDate('2024-06-01', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2024-06-01'), false)).toBe(BASE_RENT);
    });
  });

  // Scenario 2: 1 year in — still no increase
  test('S02: 1 year after move-in (2025-06-01) → base rate', () => {
    withDate('2025-06-01', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2024-06-01'), false)).toBe(BASE_RENT);
    });
  });

  // Scenario 3: Exactly 2 years — first increase fires
  test('S03: Exactly 2 years (2026-06-01) → 1 cycle = ₦44,100', () => {
    withDate('2026-06-01', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2024-06-01'), false)).toBe(increased(BASE_RENT, 1));
    });
  });

  // Scenario 4: 3 years in — still on cycle 1
  test('S04: 3 years (2027-06-01) → still 1 cycle', () => {
    withDate('2027-06-01', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2024-06-01'), false)).toBe(increased(BASE_RENT, 1));
    });
  });

  // Scenario 5: Exactly 4 years — second increase fires
  test('S05: 4 years (2028-06-01) → 2 cycles = ₦55,566', () => {
    withDate('2028-06-01', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2024-06-01'), false)).toBe(increased(BASE_RENT, 2));
    });
  });

  // Scenario 6: Tenant from Jan 2023 — increase due Jan 2025
  test('S06: 2023 tenant checked Jan 2025 → 1 cycle', () => {
    withDate('2025-01-01', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2023-01-01'), false)).toBe(increased(BASE_RENT, 1));
    });
  });

  // Scenario 7: 2023 tenant checked Dec 2024 — increase NOT yet fired
  test('S07: 2023 tenant checked Dec 2024 → still base (increase fires Jan 2025)', () => {
    withDate('2024-12-31', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2023-01-01'), false)).toBe(BASE_RENT);
    });
  });

  // Scenario 8: 2025 tenant checked June 2026 — increase NOT yet due (due 2027)
  test('S08: 2025 tenant checked mid-2026 → base rate (increase due 2027)', () => {
    withDate('2026-06-01', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2025-06-01'), false)).toBe(BASE_RENT);
    });
  });

  // Scenario 9: 2025 tenant checked June 2027 — first increase fires
  test('S09: 2025 tenant checked June 2027 → 1 cycle', () => {
    withDate('2027-06-01', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2025-06-01'), false)).toBe(increased(BASE_RENT, 1));
    });
  });

  // Scenario 10: Service charge also increases by same rule
  test('S10: Service charge 2 years after move-in → 1 cycle', () => {
    withDate('2026-06-01', () => {
      expect(getCurrentRent(BASE_SVC, new Date('2024-06-01'), false)).toBe(increased(BASE_SVC, 1));
    });
  });

});

// ─── Suite 2: calculateEffectiveRent – 12-month payment periods ─────────────

describe('calculateEffectiveRent — 12-month period totals', () => {

  // Scenario 11: First-year payment — all months at base rate
  test('S11: Pay 12 months starting move-in (2024-06-01) → 12 × ₦35,000', () => {
    const result = calculateEffectiveRent(BASE_RENT, new Date('2024-06-01'), 12, false, new Date('2024-06-01'));
    expect(result.totalAmount).toBe(BASE_RENT * 12);
    expect(result.finalRent).toBe(BASE_RENT);
  });

  // Scenario 12: Second-year payment — still all base (increase not hit)
  test('S12: Pay 12 months Jun 2025–May 2026 → 12 × ₦35,000 (increase fires Jun 2026)', () => {
    const result = calculateEffectiveRent(BASE_RENT, new Date('2025-06-01'), 12, false, new Date('2024-06-01'));
    expect(result.totalAmount).toBe(BASE_RENT * 12);
    expect(result.finalRent).toBe(BASE_RENT);
  });

  // Scenario 13: Third-year payment — ALL months at increased rate
  test('S13: Pay 12 months Jun 2026–May 2027 → 12 × ₦44,100', () => {
    const result = calculateEffectiveRent(BASE_RENT, new Date('2026-06-01'), 12, false, new Date('2024-06-01'));
    expect(result.totalAmount).toBe(increased(BASE_RENT, 1) * 12);
    expect(result.finalRent).toBe(increased(BASE_RENT, 1));
  });

  // Scenario 14: Receipt validation — Henry John's actual numbers
  // Rent ₦420,000/yr, Service ₦120,000/yr, next renewal Jun 2026 = ₦680,400 total
  test('S14: Henry John renewal year total matches receipt (₦680,400)', () => {
    const rent = calculateEffectiveRent(BASE_RENT, new Date('2026-06-01'), 12, false, new Date('2024-06-01'));
    const svc  = calculateEffectiveRent(BASE_SVC,  new Date('2026-06-01'), 12, false, new Date('2024-06-01'));
    expect(rent.totalAmount).toBe(529_200);   // ₦44,100 × 12
    expect(svc.totalAmount).toBe(151_200);    // ₦12,600 × 12
    expect(rent.totalAmount + svc.totalAmount).toBe(680_400);
  });

  // Scenario 15: Period that CROSSES the 2-year boundary mid-year
  // Origin: Jan 2024. Period: Jul 2025 – Jun 2026.
  // Months 0–5 (Jul–Dec 2025): 18–23 months since origin → 0 cycles
  // Month 6 (Jan 2026): 24 months since origin → 1 cycle
  test('S15: Period crossing 2-yr boundary (Jul 2025–Jun 2026 for Jan 2024 tenant)', () => {
    const result = calculateEffectiveRent(BASE_RENT, new Date('2025-07-01'), 12, false, new Date('2024-01-01'));
    const expected = BASE_RENT * 6 + increased(BASE_RENT, 1) * 6;
    expect(result.totalAmount).toBe(expected);
    expect(result.finalRent).toBe(increased(BASE_RENT, 1));
  });

  // Scenario 16: 2022 tenant paying in 2026 — should be on cycle 2
  test('S16: 2022 tenant (Jun) paying Jun 2026–May 2027 → 2 cycles', () => {
    const result = calculateEffectiveRent(BASE_RENT, new Date('2026-06-01'), 12, false, new Date('2022-06-01'));
    expect(result.totalAmount).toBe(increased(BASE_RENT, 2) * 12);
    expect(result.finalRent).toBe(increased(BASE_RENT, 2));
  });

  // Scenario 17: 2020 tenant paying in 2026 — should be on cycle 3
  test('S17: 2020 tenant (Jun) paying Jun 2026–May 2027 → 3 cycles', () => {
    const result = calculateEffectiveRent(BASE_RENT, new Date('2026-06-01'), 12, false, new Date('2020-06-01'));
    expect(result.totalAmount).toBe(increased(BASE_RENT, 3) * 12);
    expect(result.finalRent).toBe(increased(BASE_RENT, 3));
  });

  // Scenario 18: 6-month payment straddles a 2-year boundary
  // Origin: Jan 2024. Period: Oct 2025 – Mar 2026.
  // Months 0–2 (Oct–Dec 2025): 21–23 months → 0 cycles
  // Months 3–5 (Jan–Mar 2026): 24–26 months → 1 cycle
  test('S18: 6-month payment crossing 2-yr boundary', () => {
    const result = calculateEffectiveRent(BASE_RENT, new Date('2025-10-01'), 6, false, new Date('2024-01-01'));
    const expected = BASE_RENT * 3 + increased(BASE_RENT, 1) * 3;
    expect(result.totalAmount).toBe(expected);
  });

  // Scenario 19: Tenant whose origin is Dec 2023 — increase fires Dec 2025
  test('S19: Dec 2023 tenant, pay Dec 2025–Nov 2026 → all at increased rate', () => {
    const result = calculateEffectiveRent(BASE_RENT, new Date('2025-12-01'), 12, false, new Date('2023-12-01'));
    expect(result.totalAmount).toBe(increased(BASE_RENT, 1) * 12);
  });

  // Scenario 20: Back-to-back renewals — cycles stack correctly
  // Year 1 (2024): base. Year 2 (2025): base. Year 3 (2026): +26%. Year 4 (2027): +26%.
  // Year 5 (2028): +26% again (cycle 2).
  test('S20: Five consecutive annual payments from Jun 2024 origin', () => {
    const origin = new Date('2024-06-01');
    const years = [
      { start: '2024-06-01', expectedCycles: 0 },
      { start: '2025-06-01', expectedCycles: 0 },
      { start: '2026-06-01', expectedCycles: 1 },
      { start: '2027-06-01', expectedCycles: 1 },
      { start: '2028-06-01', expectedCycles: 2 },
    ];
    years.forEach(({ start, expectedCycles }) => {
      const result = calculateEffectiveRent(BASE_RENT, new Date(start), 12, false, origin);
      const expected = increased(BASE_RENT, expectedCycles) * 12;
      expect(result.totalAmount).toBe(expected);
    });
  });

  // Scenario 21: finalRent reflects the LAST month's rate in the period
  test('S21: finalRent is the rate for the last month of the payment period', () => {
    // Jan 2024 tenant, paying Oct 2025 – Mar 2026 (crosses boundary at Jan 2026)
    const result = calculateEffectiveRent(BASE_RENT, new Date('2025-10-01'), 6, false, new Date('2024-01-01'));
    // Last month (Mar 2026) = 26 months from Jan 2024 → 1 cycle
    expect(result.finalRent).toBe(increased(BASE_RENT, 1));
  });

  // Scenario 22: Zero base amount edge case
  test('S22: Zero base rent → always zero regardless of cycles', () => {
    const result = calculateEffectiveRent(0, new Date('2026-06-01'), 12, false, new Date('2024-06-01'));
    expect(result.totalAmount).toBe(0);
    expect(result.finalRent).toBe(0);
  });

  // Scenario 23: getCurrentRent day before 2-year mark — no increase yet
  test('S23: One day before 2-year anniversary → still base rate', () => {
    withDate('2026-05-31', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2024-06-01'), false)).toBe(BASE_RENT);
    });
  });

  // Scenario 24: getCurrentRent on exact 2-year anniversary — increase fires
  test('S24: Exact 2-year anniversary (same day) → increased rate', () => {
    withDate('2026-06-01', () => {
      expect(getCurrentRent(BASE_RENT, new Date('2024-06-01'), false)).toBe(increased(BASE_RENT, 1));
    });
  });

});

// ─── Suite 3: Dashboard yearly breakdown simulation ─────────────────────────

describe('Dashboard yearly breakdown — Current Year vs Renewal Year', () => {

  /**
   * Simulates what the dashboard calculates for Current/Renewal year given:
   *   - nextDueDate  (anchor for the periods)
   *   - entryDate    (origin for cycle counting)
   *   - baseRent
   */
  function yearlyBreakdown(nextDueDateStr, entryDateStr, base = BASE_RENT, baseSvc = BASE_SVC) {
    const rentOrigin   = new Date(entryDateStr);
    const renewalStart = new Date(nextDueDateStr);
    const billingStart = new Date(renewalStart);
    billingStart.setFullYear(billingStart.getFullYear() - 1);

    const currentRent = calculateEffectiveRent(base,    billingStart, 12, false, rentOrigin);
    const currentSvc  = calculateEffectiveRent(baseSvc, billingStart, 12, false, rentOrigin);
    const renewalRent = calculateEffectiveRent(base,    renewalStart, 12, false, rentOrigin);
    const renewalSvc  = calculateEffectiveRent(baseSvc, renewalStart, 12, false, rentOrigin);

    return {
      current: { rent: currentRent.totalAmount, svc: currentSvc.totalAmount, total: currentRent.totalAmount + currentSvc.totalAmount },
      renewal: { rent: renewalRent.totalAmount, svc: renewalSvc.totalAmount, total: renewalRent.totalAmount + renewalSvc.totalAmount },
      increased: renewalRent.finalRent > currentRent.finalRent,
    };
  }

  // Scenario 25a: Henry John — nextDueDate = June 1 (first day of new period) → full 12 months increased
  test('S25a: Henry John nextDueDate Jun 1 2026 → renewal all 12 months at ₦680,400', () => {
    const bd = yearlyBreakdown('2026-06-01', '2024-06-01');
    expect(bd.current.total).toBe(540_000);  // ₦420k rent + ₦120k svc
    expect(bd.renewal.total).toBe(680_400);  // ₦529,200 + ₦151,200
    expect(bd.increased).toBe(true);
  });

  // Scenario 25b: Henry John — nextDueDate = May 31 (expiry day) → month 0 is still pre-increase
  // NOTE: Admin should use Jun 1 (start of new period) not May 31 (expiry day) for full accuracy.
  test('S25b: Henry John nextDueDate May 31 2026 → 1 pre-increase month + 11 increased = ₦668,700', () => {
    const bd = yearlyBreakdown('2026-05-31', '2024-06-01');
    expect(bd.current.total).toBe(540_000);
    // May 2026 = month 23 from Jun 2024 → still 0 cycles (₦35k+₦10k)
    // Jun 2026 – Apr 2027 (11 months) → 1 cycle (₦44,100+₦12,600)
    expect(bd.renewal.total).toBe(45_000 + (56_700 * 11));  // 668,700
    expect(bd.increased).toBe(true);
  });

  // Scenario 26: New tenant (Jun 2025), due Jun 2026 — no increase yet in renewal
  test('S26: New tenant (entry Jun 2025, next due Jun 2026) → both years same rate', () => {
    const bd = yearlyBreakdown('2026-06-01', '2025-06-01');
    expect(bd.current.total).toBe(540_000);
    expect(bd.renewal.total).toBe(540_000);  // increase not due until Jun 2027
    expect(bd.increased).toBe(false);
  });

  // Scenario 27: New tenant (Jun 2025), due Jun 2027 (first day) → full renewal at increased rate
  test('S27: New tenant (entry Jun 2025, next due Jun 2027) → renewal all 12 months increased ₦680,400', () => {
    const bd = yearlyBreakdown('2027-06-01', '2025-06-01');
    expect(bd.current.total).toBe(540_000);
    expect(bd.renewal.total).toBe(680_400);
    expect(bd.increased).toBe(true);
  });

  // Scenario 28: 2022 tenant on 4th renewal (Jun 2026) — should be on cycle 2
  test('S28: 2022 tenant (entry Jun 2022, next due Jun 2026) → renewal on cycle 2', () => {
    const bd = yearlyBreakdown('2026-06-01', '2022-06-01');
    // Current period Jun 2025–Jun 2026: 36–47 months from Jun 2022 → cycle 1 (24–47 = 1)
    // Renewal Jun 2026–Jun 2027: 48–59 months → cycle 2
    expect(bd.current.rent).toBe(increased(BASE_RENT, 1) * 12);
    expect(bd.renewal.rent).toBe(increased(BASE_RENT, 2) * 12);
    expect(bd.increased).toBe(true);
  });

});

// ─── Suite 4: getCurrentRent — extended year/month coverage ─────────────────

describe('getCurrentRent — extended scenarios across many entry months', () => {

  // S29–S38: Different move-in months, checking the increase fires on correct month
  const moveinIncreasePairs = [
    { entry: '2023-01-01', noIncrease: '2024-12-31', increase: '2025-01-01', label: 'Jan 2023' },
    { entry: '2023-03-15', noIncrease: '2025-03-14', increase: '2025-03-15', label: 'Mar 2023' },
    { entry: '2023-07-01', noIncrease: '2025-06-30', increase: '2025-07-01', label: 'Jul 2023' },
    { entry: '2023-09-01', noIncrease: '2025-08-31', increase: '2025-09-01', label: 'Sep 2023' },
    { entry: '2023-11-01', noIncrease: '2025-10-31', increase: '2025-11-01', label: 'Nov 2023' },
    { entry: '2024-02-01', noIncrease: '2026-01-31', increase: '2026-02-01', label: 'Feb 2024' },
    { entry: '2024-04-01', noIncrease: '2026-03-31', increase: '2026-04-01', label: 'Apr 2024' },
    { entry: '2024-08-01', noIncrease: '2026-07-31', increase: '2026-08-01', label: 'Aug 2024' },
    { entry: '2024-10-01', noIncrease: '2026-09-30', increase: '2026-10-01', label: 'Oct 2024' },
    { entry: '2024-12-01', noIncrease: '2026-11-30', increase: '2026-12-01', label: 'Dec 2024' },
  ];

  moveinIncreasePairs.forEach(({ entry, noIncrease, increase, label }, idx) => {
    test(`S${29 + idx * 2}: ${label} tenant — day before 2yr → base rate`, () => {
      withDate(noIncrease, () => {
        expect(getCurrentRent(BASE_RENT, new Date(entry), false)).toBe(BASE_RENT);
      });
    });
    test(`S${30 + idx * 2}: ${label} tenant — exact 2yr anniversary → increased rate`, () => {
      withDate(increase, () => {
        expect(getCurrentRent(BASE_RENT, new Date(entry), false)).toBe(increased(BASE_RENT, 1));
      });
    });
  });

});

// ─── Suite 5: calculateEffectiveRent — all 12 starting months ───────────────

describe('calculateEffectiveRent — 12 starting months, Jun 2024 origin', () => {
  // S49–S60: Pay 12 months starting from each calendar month of 2026
  // Tenant moved in Jun 2024. Increase fires Jun 2026.
  // For months starting before Jun 2026, some months are pre-increase.
  // For months starting Jun 2026 or later, all months are at increased rate.

  const origin = new Date('2024-06-01');

  const monthCases = [
    { start: '2026-01-01', preIncrease: 5, postIncrease: 7  }, // Jan–May = 0 cycles; Jun–Jul = 1 cycle
    { start: '2026-02-01', preIncrease: 4, postIncrease: 8  },
    { start: '2026-03-01', preIncrease: 3, postIncrease: 9  },
    { start: '2026-04-01', preIncrease: 2, postIncrease: 10 },
    { start: '2026-05-01', preIncrease: 1, postIncrease: 11 },
    { start: '2026-06-01', preIncrease: 0, postIncrease: 12 }, // all at increased rate
    { start: '2026-07-01', preIncrease: 0, postIncrease: 12 },
    { start: '2026-09-01', preIncrease: 0, postIncrease: 12 },
    { start: '2026-12-01', preIncrease: 0, postIncrease: 12 },
    { start: '2027-01-01', preIncrease: 0, postIncrease: 12 },
    { start: '2027-06-01', preIncrease: 0, postIncrease: 12 }, // still cycle 1 (48 months = cycle 2 not yet)
    { start: '2028-06-01', preIncrease: 0, postIncrease: 12 }, // 48 months = cycle 2
  ];

  monthCases.forEach(({ start, preIncrease, postIncrease }, idx) => {
    test(`S${49 + idx}: 12-month payment starting ${start} (pre=${preIncrease}, post=${postIncrease})`, () => {
      const result = calculateEffectiveRent(BASE_RENT, new Date(start), 12, false, origin);
      // For the Jun 2028 case, it's cycle 2, not cycle 1
      const cycleForPost = start >= '2028-06-01' ? 2 : 1;
      const expected = BASE_RENT * preIncrease + increased(BASE_RENT, cycleForPost) * postIncrease;
      expect(result.totalAmount).toBe(expected);
    });
  });

});

// ─── Suite 6: Real estate flat rates — all 3 flats from receipts ────────────

describe('Real estate data — Flat 1, Flat 3, Flat 4 receipt validation', () => {

  // Flat 3: Henry John — ₦35,000/month rent, ₦10,000/month service, entry Jun 2024
  test('S61: Flat 3 current year (Jun 2025–May 2026) = ₦540,000', () => {
    const rent = calculateEffectiveRent(35_000, new Date('2025-06-01'), 12, false, new Date('2024-06-01'));
    const svc  = calculateEffectiveRent(10_000, new Date('2025-06-01'), 12, false, new Date('2024-06-01'));
    expect(rent.totalAmount + svc.totalAmount).toBe(540_000);
  });

  test('S62: Flat 3 renewal year (Jun 2026–May 2027) = ₦680,400', () => {
    const rent = calculateEffectiveRent(35_000, new Date('2026-06-01'), 12, false, new Date('2024-06-01'));
    const svc  = calculateEffectiveRent(10_000, new Date('2026-06-01'), 12, false, new Date('2024-06-01'));
    expect(rent.totalAmount).toBe(529_200);
    expect(svc.totalAmount).toBe(151_200);
    expect(rent.totalAmount + svc.totalAmount).toBe(680_400);
  });

  test('S63: Flat 3 — 4th year (Jun 2028–May 2029) = cycle 2', () => {
    const rent = calculateEffectiveRent(35_000, new Date('2028-06-01'), 12, false, new Date('2024-06-01'));
    // cycle 2: 35,000 × 1.26² = 55,566
    expect(rent.finalRent).toBe(increased(35_000, 2));
    expect(rent.totalAmount).toBe(increased(35_000, 2) * 12);
  });

  // Flat 1: Olumide — ₦10,000/month rent, ₦1,000/month service, entry Jun 2025
  test('S64: Flat 1 current year (Jun 2025–May 2026) = ₦132,000', () => {
    const rent = calculateEffectiveRent(10_000, new Date('2025-06-01'), 12, false, new Date('2025-06-01'));
    const svc  = calculateEffectiveRent(1_000,  new Date('2025-06-01'), 12, false, new Date('2025-06-01'));
    expect(rent.totalAmount + svc.totalAmount).toBe(132_000);
  });

  test('S65: Flat 1 renewal year (Jun 2026–May 2027) = ₦132,000 (no increase until Jun 2027)', () => {
    const rent = calculateEffectiveRent(10_000, new Date('2026-06-01'), 12, false, new Date('2025-06-01'));
    const svc  = calculateEffectiveRent(1_000,  new Date('2026-06-01'), 12, false, new Date('2025-06-01'));
    expect(rent.totalAmount + svc.totalAmount).toBe(132_000);
  });

  test('S66: Flat 1 year 3 (Jun 2027–May 2028) = ₦166,320 (26% increase)', () => {
    const rent = calculateEffectiveRent(10_000, new Date('2027-06-01'), 12, false, new Date('2025-06-01'));
    const svc  = calculateEffectiveRent(1_000,  new Date('2027-06-01'), 12, false, new Date('2025-06-01'));
    // 10,000 × 1.26 = 12,600; 1,000 × 1.26 = 1,260
    expect(rent.finalRent).toBe(12_600);
    expect(svc.finalRent).toBe(1_260);
    expect(rent.totalAmount + svc.totalAmount).toBe(166_320);
  });

  // getCurrentRent snapshots for all flats
  test('S67: Flat 3 getCurrentRent today (Jun 2026 snapshot) = ₦44,100', () => {
    withDate('2026-06-15', () => {
      expect(getCurrentRent(35_000, new Date('2024-06-01'), false)).toBe(44_100);
    });
  });

  test('S68: Flat 1 getCurrentRent today (Jun 2026 snapshot) = ₦10,000 (not increased yet)', () => {
    withDate('2026-06-15', () => {
      expect(getCurrentRent(10_000, new Date('2025-06-01'), false)).toBe(10_000);
    });
  });

  test('S69: Flat 1 getCurrentRent Jun 2027 = ₦12,600 (increased)', () => {
    withDate('2027-06-15', () => {
      expect(getCurrentRent(10_000, new Date('2025-06-01'), false)).toBe(12_600);
    });
  });

  // Multi-year stack: Flat 3 from 2024, check rates at each 2-year mark
  test('S70: Flat 3 rent at Jun 2024 = ₦35,000', () => {
    withDate('2024-06-01', () => expect(getCurrentRent(35_000, new Date('2024-06-01'), false)).toBe(35_000));
  });
  test('S71: Flat 3 rent at Jun 2026 = ₦44,100 (cycle 1)', () => {
    withDate('2026-06-01', () => expect(getCurrentRent(35_000, new Date('2024-06-01'), false)).toBe(44_100));
  });
  test('S72: Flat 3 rent at Jun 2028 = ₦55,566 (cycle 2)', () => {
    withDate('2028-06-01', () => expect(getCurrentRent(35_000, new Date('2024-06-01'), false)).toBe(55_566));
  });
  test('S73: Flat 3 rent at Jun 2030 = ₦70,013 (cycle 3)', () => {
    withDate('2030-06-01', () => expect(getCurrentRent(35_000, new Date('2024-06-01'), false)).toBe(70_013));
  });

  // Service charge stacks independently
  test('S74: Flat 3 service charge at Jun 2026 = ₦12,600 (cycle 1)', () => {
    withDate('2026-06-01', () => expect(getCurrentRent(10_000, new Date('2024-06-01'), false)).toBe(12_600));
  });
  test('S75: Flat 3 service charge at Jun 2028 = ₦15,876 (cycle 2)', () => {
    withDate('2028-06-01', () => expect(getCurrentRent(10_000, new Date('2024-06-01'), false)).toBe(15_876));
  });

  // Partial year — 6-month payment
  test('S76: Flat 3 6-month payment Jun–Nov 2026 (all cycle 1) = ₦264,600', () => {
    const rent = calculateEffectiveRent(35_000, new Date('2026-06-01'), 6, false, new Date('2024-06-01'));
    const svc  = calculateEffectiveRent(10_000, new Date('2026-06-01'), 6, false, new Date('2024-06-01'));
    expect(rent.totalAmount).toBe(44_100 * 6);
    expect(svc.totalAmount).toBe(12_600 * 6);
    expect(rent.totalAmount + svc.totalAmount).toBe(264_600 + 75_600);
  });

  test('S77: Flat 1 6-month payment Jun–Nov 2027 (all cycle 1) = ₦83,160', () => {
    const rent = calculateEffectiveRent(10_000, new Date('2027-06-01'), 6, false, new Date('2025-06-01'));
    const svc  = calculateEffectiveRent(1_000,  new Date('2027-06-01'), 6, false, new Date('2025-06-01'));
    expect(rent.totalAmount).toBe(12_600 * 6);
    expect(svc.totalAmount).toBe(1_260 * 6);
    expect(rent.totalAmount + svc.totalAmount).toBe(83_160);
  });

  // Edge: tenant with exactly 10-year history — should be on cycle 5
  test('S78: 10-year tenant (2016–2026) → cycle 5', () => {
    withDate('2026-06-01', () => {
      expect(getCurrentRent(35_000, new Date('2016-06-01'), false)).toBe(increased(35_000, 5));
    });
  });

  // Edge: future entry date — getCurrentRent should return base amount
  test('S79: Future move-in (2027) checked today (2026) → base rate', () => {
    withDate('2026-01-01', () => {
      expect(getCurrentRent(35_000, new Date('2027-01-01'), false)).toBe(35_000);
    });
  });

});

// ─── Suite 7: All entry years 2018–2030 — full cycle ladder ─────────────────
//
// For every entry year, we verify:
//   a) getCurrentRent at each 2-year anniversary (cycles 0→1, 1→2, …)
//   b) calculateEffectiveRent for each annual payment period
//   c) the dashboard renewal card at the relevant nextDueDate
//
// Entry year → increase dates:
//   2018: 2020, 2022, 2024, 2026, 2028, 2030
//   2019: 2021, 2023, 2025, 2027, 2029
//   2020: 2022, 2024, 2026, 2028, 2030
//   2021: 2023, 2025, 2027, 2029
//   2022: 2024, 2026, 2028
//   2023: 2025, 2027
//   2024: 2026, 2028
//   2025: 2027, 2029
//   2026: 2028
//   2027: 2029
// ─────────────────────────────────────────────────────────────────────────────

describe('All entry years 2018–2030 — cycle ladder', () => {

  const BASE = 35_000;

  /**
   * Build the full expected cycle ladder for a given entry year (June 1).
   * Returns array of { checkYear, expectedCycles }.
   */
  function cycleLadder(entryYear) {
    const rows = [];
    for (let y = entryYear; y <= 2032; y++) {
      const monthsSince = (y - entryYear) * 12;  // checking June 1 of year y
      const cycles = Math.floor(monthsSince / 24);
      rows.push({ checkYear: y, expectedCycles: cycles });
    }
    return rows;
  }

  // For every entry year, verify getCurrentRent at every June 1 up to 2032
  const entryYears = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];

  entryYears.forEach(entryYear => {
    const entry = `${entryYear}-06-01`;
    const ladder = cycleLadder(entryYear);

    describe(`Entry ${entryYear}`, () => {

      // a) getCurrentRent at each anniversary year
      ladder.forEach(({ checkYear, expectedCycles }) => {
        test(`getCurrentRent at ${checkYear}-06-01 → cycle ${expectedCycles} = ₦${increased(BASE, expectedCycles).toLocaleString()}`, () => {
          withDate(`${checkYear}-06-01`, () => {
            expect(getCurrentRent(BASE, new Date(entry), false))
              .toBe(increased(BASE, expectedCycles));
          });
        });
      });

      // b) calculateEffectiveRent: each 12-month annual payment period
      for (let payYear = entryYear; payYear <= Math.min(entryYear + 8, 2032); payYear++) {
        const periodStart = `${payYear}-06-01`;
        // months since entry at period start
        const startMonths = (payYear - entryYear) * 12;
        const expectedCycles = Math.floor(startMonths / 24);
        const expectedTotal  = increased(BASE, expectedCycles) * 12;

        test(`pay 12 months from ${payYear}-06-01 → cycle ${expectedCycles} = ₦${expectedTotal.toLocaleString()}/yr`, () => {
          const result = calculateEffectiveRent(BASE, new Date(periodStart), 12, false, new Date(entry));
          // All 12 months of a payment period that starts ON a cycle boundary
          // are at the same rate. Periods that DON'T cross a boundary are uniform.
          // A period starting exactly on an anniversary (e.g. Jun 2026 for 2024 entry)
          // starts at the new cycle for ALL months → no boundary crossing.
          expect(result.totalAmount).toBe(expectedTotal);
          expect(result.finalRent).toBe(increased(BASE, expectedCycles));
        });
      }

      // c) Dashboard renewal card: nextDueDate = 2 years after entry (first increase)
      const firstIncreaseYear = entryYear + 2;
      const nextDue = `${firstIncreaseYear}-06-01`;
      const cyclesAtRenewal = 1; // the renewal period starts at the first increase

      test(`dashboard renewal card at nextDueDate ${nextDue} → shows increased rate`, () => {
        const rentOrigin   = new Date(entry);
        const renewalStart = new Date(nextDue);
        const billingStart = new Date(renewalStart);
        billingStart.setFullYear(billingStart.getFullYear() - 1);

        const current = calculateEffectiveRent(BASE, billingStart, 12, false, rentOrigin);
        const renewal = calculateEffectiveRent(BASE, renewalStart, 12, false, rentOrigin);

        // current period (year before nextDueDate) is still at base rate
        expect(current.totalAmount).toBe(BASE * 12);
        expect(current.finalRent).toBe(BASE);
        // renewal period starts at first increase
        expect(renewal.totalAmount).toBe(increased(BASE, cyclesAtRenewal) * 12);
        expect(renewal.finalRent).toBe(increased(BASE, cyclesAtRenewal));
      });

    });
  });

});

// ─── Suite 8: Backward compatibility — very old tenants ─────────────────────

describe('Very old tenants — entry years before 2018', () => {
  const BASE = 35_000;
  const oldEntries = [
    { year: 2010, cyclesAt2026: 8 },   // (2026-2010)/2 = 8
    { year: 2012, cyclesAt2026: 7 },
    { year: 2014, cyclesAt2026: 6 },
    { year: 2015, cyclesAt2026: 5 },   // (2026-2015)/2 = 5.5 → floor = 5
    { year: 2016, cyclesAt2026: 5 },
    { year: 2017, cyclesAt2026: 4 },   // (2026-2017)/2 = 4.5 → floor = 4
  ];

  oldEntries.forEach(({ year, cyclesAt2026 }) => {
    test(`${year} tenant at Jun 2026 → ${cyclesAt2026} cycles = ₦${increased(BASE, cyclesAt2026).toLocaleString()}/month`, () => {
      withDate('2026-06-01', () => {
        expect(getCurrentRent(BASE, new Date(`${year}-06-01`), false))
          .toBe(increased(BASE, cyclesAt2026));
      });
    });

    test(`${year} tenant: 12-month payment Jun 2026–May 2027 = ₦${(increased(BASE, cyclesAt2026) * 12).toLocaleString()}`, () => {
      const result = calculateEffectiveRent(BASE, new Date('2026-06-01'), 12, false, new Date(`${year}-06-01`));
      expect(result.totalAmount).toBe(increased(BASE, cyclesAt2026) * 12);
    });
  });
});

// ─── Suite 9: Future entry years (onboarding planned ahead) ─────────────────

describe('Future entry years 2026–2030 — first increase date is correct', () => {
  const BASE = 35_000;

  const futureEntries = [
    { entry: '2026-01-01', firstIncreaseDate: '2028-01-01', noIncreaseDate: '2027-12-31' },
    { entry: '2026-06-01', firstIncreaseDate: '2028-06-01', noIncreaseDate: '2028-05-31' },
    { entry: '2026-09-01', firstIncreaseDate: '2028-09-01', noIncreaseDate: '2028-08-31' },
    { entry: '2027-01-01', firstIncreaseDate: '2029-01-01', noIncreaseDate: '2028-12-31' },
    { entry: '2027-06-01', firstIncreaseDate: '2029-06-01', noIncreaseDate: '2029-05-31' },
    { entry: '2028-01-01', firstIncreaseDate: '2030-01-01', noIncreaseDate: '2029-12-31' },
    { entry: '2029-06-01', firstIncreaseDate: '2031-06-01', noIncreaseDate: '2031-05-31' },
    { entry: '2030-01-01', firstIncreaseDate: '2032-01-01', noIncreaseDate: '2031-12-31' },
  ];

  futureEntries.forEach(({ entry, firstIncreaseDate, noIncreaseDate }) => {
    test(`Entry ${entry}: no increase day before → base rate`, () => {
      withDate(noIncreaseDate, () => {
        expect(getCurrentRent(BASE, new Date(entry), false)).toBe(BASE);
      });
    });

    test(`Entry ${entry}: first increase fires on ${firstIncreaseDate}`, () => {
      withDate(firstIncreaseDate, () => {
        expect(getCurrentRent(BASE, new Date(entry), false)).toBe(increased(BASE, 1));
      });
    });
  });
});


