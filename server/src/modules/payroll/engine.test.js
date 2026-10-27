import { describe, expect, it } from 'vitest';
import { arrearsForMonth, computeEarnings, computeEntry, ptFor, salaryBreakdown } from './payroll.engine.js';
import { applyBp, mulDivRound, roundToRupee } from '../../shared/money.js';

// TEST VALUES ONLY — chosen to exercise the engine, not a statement of current statutory rates.
const rules = {
  template: { basicBpOfGross: 5000, hraBpOfBasic: 4000 },
  pf: { enabled: true, employeeBp: 1200, employerBp: 1200, epsBp: 833, wageCeilingPaise: 1_500_000, epsCeilingPaise: 1_500_000 },
  esi: { enabled: true, employeeBp: 75, employerBp: 325, wageLimitPaise: 2_100_000 },
  pt: {
    enabled: true,
    state: 'MH',
    slabs: [
      { fromPaise: 0, toPaise: 750_000, monthlyPaise: 0, februaryPaise: null },
      { fromPaise: 750_001, toPaise: 1_000_000, monthlyPaise: 17_500, februaryPaise: null },
      { fromPaise: 1_000_001, toPaise: null, monthlyPaise: 20_000, februaryPaise: 30_000 },
    ],
  },
  gratuity: { bpOfBasic: 0 },
};
const noAdj = { tdsPaise: 0, earnings: [], deductions: [] };

describe('money helpers', () => {
  it('rounds half away from zero, exactly', () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(-1, 1, 2)).toBe(-1);
    expect(mulDivRound(5, 1, 3)).toBe(2);
    expect(mulDivRound(1_000_000_000_01, 31, 31)).toBe(1_000_000_000_01);
    expect(applyBp(1_500_000, 1200)).toBe(180_000);
    expect(roundToRupee(12_349)).toBe(12_300);
    expect(roundToRupee(12_350)).toBe(12_400);
  });
});

describe('salary breakdown (P3)', () => {
  it('splits an ₹18 lakh CTC with PF capped at the ceiling and no ESI', () => {
    const b = salaryBreakdown({ annualCtcPaise: 180_000_000, rules });
    expect(b).toMatchObject({ ctcMonthlyPaise: 15_000_000, grossPaise: 14_820_000, esiApplicable: false, unallocatedPaise: 0, valid: true });
    expect(b.employer).toEqual({ pfPaise: 180_000, esiPaise: 0, gratuityPaise: 0 });
    expect(b.components.map((c) => [c.code, c.monthlyPaise])).toEqual([
      ['BASIC', 7_410_000],
      ['HRA', 2_964_000],
      ['SPECIAL', 4_446_000],
    ]);
  });

  it('maximizes gross under the CTC for an ESI-eligible salary', () => {
    const b = salaryBreakdown({ annualCtcPaise: 24_000_000, rules });
    expect(b.esiApplicable).toBe(true);
    expect(b.grossPaise).toBeLessThanOrEqual(rules.esi.wageLimitPaise);
    const total = b.grossPaise + b.employer.pfPaise + b.employer.esiPaise;
    expect(total).toBeLessThanOrEqual(2_000_000);
    expect(b.unallocatedPaise).toBe(2_000_000 - total);
    expect(b.unallocatedPaise).toBeLessThan(5);
  });

  it('honours overrides and fixed allowances, and flags impossible structures', () => {
    const b = salaryBreakdown({ annualCtcPaise: 120_000_000, rules: { ...rules, esi: { ...rules.esi, enabled: false } }, basicBpOfGross: 4000, fixedAllowances: [{ code: 'CONV', label: 'Conveyance', monthlyPaise: 160_000 }] });
    expect(b.components.find((c) => c.code === 'FA_CONV').monthlyPaise).toBe(160_000);
    expect(b.components.reduce((s, c) => s + c.monthlyPaise, 0)).toBe(b.grossPaise);
    const bad = salaryBreakdown({ annualCtcPaise: 1_200_000, rules, fixedAllowances: [{ code: 'X', label: 'Big', monthlyPaise: 500_000 }] });
    expect(bad.valid).toBe(false);
  });

  it('applies PF on the full wage only for opted-in employees (P4)', () => {
    const capped = salaryBreakdown({ annualCtcPaise: 180_000_000, rules });
    const full = salaryBreakdown({ annualCtcPaise: 180_000_000, rules, pfOnFullWage: true });
    expect(full.employer.pfPaise).toBeGreaterThan(capped.employer.pfPaise);
    expect(full.grossPaise).toBeLessThan(capped.grossPaise);
  });
});

const comps = (basic, hra, special) => [
  { code: 'BASIC', label: 'Basic', monthlyPaise: basic, pfWage: true },
  { code: 'HRA', label: 'HRA', monthlyPaise: hra, pfWage: false },
  { code: 'SPECIAL', label: 'Special', monthlyPaise: special, pfWage: false },
];

describe('earnings: pro-rating and LOP (P2, P11)', () => {
  it('pays a full month, and deducts LOP at monthly ÷ calendar days', () => {
    const segments = [{ from: '2025-02-01', to: '2025-02-28', days: 28, components: comps(2_800_000, 1_120_000, 1_400_000) }];
    const full = computeEarnings({ daysInMonth: 28, segments, unpaidDays: [] });
    expect(full.map((e) => e.earnedPaise)).toEqual([2_800_000, 1_120_000, 1_400_000]);
    const lop = computeEarnings({ daysInMonth: 28, segments, unpaidDays: [{ date: '2025-02-10', units: 2 }, { date: '2025-02-11', units: 1 }] });
    expect(lop[0]).toMatchObject({ lopPaise: 150_000, earnedPaise: 2_650_000 }); // 1.5 days × 1,00,000/day
  });

  it('pro-rates a mid-month joiner and splits at a revision date', () => {
    const joiner = computeEarnings({ daysInMonth: 30, segments: [{ from: '2025-06-16', to: '2025-06-30', days: 15, components: comps(3_000_000, 0, 0) }], unpaidDays: [] });
    expect(joiner[0].earnedPaise).toBe(1_500_000);
    const split = computeEarnings({
      daysInMonth: 31,
      segments: [
        { from: '2025-07-01', to: '2025-07-10', days: 10, components: comps(3_100_000, 0, 0) },
        { from: '2025-07-11', to: '2025-07-31', days: 21, components: comps(6_200_000, 0, 0) },
      ],
      unpaidDays: [{ date: '2025-07-20', units: 2 }],
    });
    // 10/31 × 31,000 + 21/31 × 62,000 − 1 day at 62,000/31
    expect(split[0].earnedPaise).toBe(1_000_000 + 4_200_000 - 200_000);
  });
});

describe('payroll entry', () => {
  const earnings = computeEarnings({ daysInMonth: 30, segments: [{ from: '2025-06-01', to: '2025-06-30', days: 30, components: comps(7_410_000, 2_964_000, 4_446_000) }], unpaidDays: [] });
  const flags = { pfApplicable: true, pfOnFullWage: false, esiApplicable: false };

  it('applies capped PF, PT slab, imported TDS, and rounds only net (P4, P6, P7, P9)', () => {
    const e = computeEntry({ earnings, flags, adjustments: { ...noAdj, tdsPaise: 1_234_567 }, rules, isFebruary: false, daysInMonth: 30, paidUnits: 60 });
    const by = Object.fromEntries(e.lines.map((l) => [l.code, l.amountPaise]));
    expect(by).toMatchObject({ PF_EE: 180_000, PT: 20_000, TDS: 1_234_567, PF_ER: 180_000 - 124_950, EPS_ER: 124_950 });
    expect(e.totals.grossPaise).toBe(14_820_000);
    expect(e.totals.netBeforeRoundingPaise).toBe(14_820_000 - 180_000 - 20_000 - 1_234_567);
    expect(e.totals.netPaise % 100).toBe(0);
    expect(e.totals.netPaise - e.totals.netBeforeRoundingPaise).toBe(e.totals.roundingPaise);
    expect(e.totals.employerCostPaise).toBe(14_820_000 + 180_000);
  });

  it('uses the February PT amount and blocks negative net pay', () => {
    expect(ptFor(1_500_000, rules, true)).toBe(30_000);
    expect(ptFor(800_000, rules, true)).toBe(17_500);
    const e = computeEntry({ earnings, flags, adjustments: { ...noAdj, deductions: [{ label: 'Loan', amountPaise: 99_000_000 }] }, rules, isFebruary: false, daysInMonth: 30, paidUnits: 60 });
    expect(e.blockers).toEqual(['Deductions exceed gross pay']);
  });

  it('adds arrears to gross and to PF wages (P12)', () => {
    const paid = new Map([['BASIC', 1_000_000], ['SPECIAL', 500_000]]);
    const recomputed = [
      { code: 'BASIC', label: 'Basic', pfWage: true, earnedPaise: 1_200_000 },
      { code: 'SPECIAL', label: 'Special', pfWage: false, earnedPaise: 500_000 },
    ];
    const arrears = arrearsForMonth(recomputed, paid);
    expect(arrears).toEqual([{ code: 'BASIC', label: 'Basic', pfWage: true, amountPaise: 200_000 }]);
    const small = computeEarnings({ daysInMonth: 30, segments: [{ from: '2025-06-01', to: '2025-06-30', days: 30, components: comps(1_000_000, 0, 0) }], unpaidDays: [] });
    const e = computeEntry({ earnings: small, arrears: arrears.map((a) => ({ ...a, basis: 'May' })), flags, adjustments: noAdj, rules: { ...rules, pt: { ...rules.pt, enabled: false } }, isFebruary: false, daysInMonth: 30, paidUnits: 60 });
    expect(e.totals.grossPaise).toBe(1_200_000);
    expect(e.lines.find((l) => l.code === 'PF_EE').amountPaise).toBe(applyBp(1_200_000, 1200));
  });

  it('calculates nothing statutory when rule packs are disabled', () => {
    const off = { ...rules, pf: { ...rules.pf, enabled: false }, esi: { ...rules.esi, enabled: false }, pt: { ...rules.pt, enabled: false } };
    const e = computeEntry({ earnings, flags: { ...flags, esiApplicable: true }, adjustments: noAdj, rules: off, isFebruary: false, daysInMonth: 30, paidUnits: 60 });
    expect(e.lines.filter((l) => l.type === 'deduction')).toEqual([]);
    expect(e.totals.netPaise).toBe(14_820_000);
  });
});
