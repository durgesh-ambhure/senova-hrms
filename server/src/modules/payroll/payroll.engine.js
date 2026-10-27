import { applyBp, mulDivRound, roundToRupee } from '../../shared/money.js';

/**
 * Pure payroll calculations: no database, no clock. Everything is integer paise.
 * Jurisdiction-specific values (PF, ESI, PT) come from the rule set; this file only applies them.
 * Decisions implemented: P2 (÷ calendar days), P3 (CTC template), P4 (PF on capped wage unless opted in),
 * P5 (ESI within wage limit), P6 (PT slabs incl. February), P7 (TDS supplied), P8 (gratuity as employer
 * cost), P9 (exact paise, net rounded to the rupee), P11 (calendar-day pro-rating), P12 (arrears lines).
 */

const pfWageOf = (basic, fixedAllowances) => basic + fixedAllowances.filter((a) => a.pfWage).reduce((s, a) => s + a.monthlyPaise, 0);

function employerCostFor(gross, ctx) {
  const { rules, basicBp, fixedAllowances, pfApplicable, pfOnFullWage, forceEsi } = ctx;
  const basic = applyBp(gross, basicBp);
  const pfWage = pfWageOf(basic, fixedAllowances);
  const pf = rules.pf.enabled && pfApplicable ? applyBp(pfOnFullWage ? pfWage : Math.min(pfWage, rules.pf.wageCeilingPaise), rules.pf.employerBp) : 0;
  const esiOn = forceEsi ?? (rules.esi.enabled && gross <= rules.esi.wageLimitPaise);
  const esi = esiOn ? applyBp(gross, rules.esi.employerBp) : 0;
  const gratuity = applyBp(basic, rules.gratuity.bpOfBasic);
  return { pf, esi, gratuity, total: gross + pf + esi + gratuity };
}

/** Largest gross in [lo, hi] whose total employer cost fits the monthly CTC (total is monotone within a branch). */
function maxGross(ctc, lo, hi, ctx) {
  if (lo > hi || employerCostFor(lo, ctx).total > ctc) return null;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (employerCostFor(mid, ctx).total <= ctc) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Monthly breakdown of an annual CTC (P3): CTC = gross + employer PF + employer ESI + gratuity.
 * Basic = basicBp × gross, HRA = hraBp × Basic, fixed allowances as entered, Special = remainder.
 * Any paise that cannot be allocated without breaking the CTC are reported as `unallocatedPaise`.
 */
export function salaryBreakdown({ annualCtcPaise, rules, basicBpOfGross, hraBpOfBasic, fixedAllowances = [], pfApplicable = true, pfOnFullWage = false }) {
  const ctc = mulDivRound(annualCtcPaise, 1, 12);
  const basicBp = basicBpOfGross ?? rules.template.basicBpOfGross;
  const hraBp = hraBpOfBasic ?? rules.template.hraBpOfBasic;
  const base = { rules, basicBp, fixedAllowances, pfApplicable, pfOnFullWage };

  let gross;
  if (rules.esi.enabled) {
    // ESI has a cliff at the wage limit, so search each side separately and keep the larger gross.
    const limit = rules.esi.wageLimitPaise;
    const below = maxGross(ctc, 0, Math.min(limit, ctc), { ...base, forceEsi: true });
    const above = maxGross(ctc, limit + 1, ctc, { ...base, forceEsi: false });
    gross = Math.max(below ?? -1, above ?? -1);
    if (gross < 0) gross = 0;
  } else gross = maxGross(ctc, 0, ctc, base) ?? 0;

  const employer = employerCostFor(gross, base);
  const basic = applyBp(gross, basicBp);
  const hra = applyBp(basic, hraBp);
  const fixedTotal = fixedAllowances.reduce((s, a) => s + a.monthlyPaise, 0);
  const special = gross - basic - hra - fixedTotal;
  const components = [
    { code: 'BASIC', label: 'Basic', monthlyPaise: basic, pfWage: true },
    { code: 'HRA', label: 'House rent allowance', monthlyPaise: hra, pfWage: false },
    ...fixedAllowances.map((a) => ({ code: `FA_${a.code}`, label: a.label, monthlyPaise: a.monthlyPaise, pfWage: Boolean(a.pfWage) })),
    { code: 'SPECIAL', label: 'Special allowance', monthlyPaise: special, pfWage: false },
  ];
  return {
    ctcMonthlyPaise: ctc,
    grossPaise: gross,
    components,
    employer: { pfPaise: employer.pf, esiPaise: employer.esi, gratuityPaise: employer.gratuity },
    esiApplicable: rules.esi.enabled && gross <= rules.esi.wageLimitPaise,
    unallocatedPaise: ctc - employer.total,
    valid: special >= 0,
    problem: special < 0 ? 'Basic, HRA and fixed allowances add up to more than the gross pay this CTC allows' : null,
  };
}

/**
 * Earnings for one month. `segments` split the month at revision effective dates (P11); each has
 * { from, to, days, components }. `unpaidDays` are { date, units } in half-day units (P2: per-day rate =
 * monthly ÷ calendar days). Rounds once per component, after summing exact numerators.
 */
export function computeEarnings({ daysInMonth, segments, unpaidDays }) {
  const proNum = new Map();
  const lopNum = new Map();
  const meta = new Map();
  for (const seg of segments) {
    for (const c of seg.components) {
      meta.set(c.code, c);
      proNum.set(c.code, (proNum.get(c.code) ?? 0) + c.monthlyPaise * seg.days);
    }
  }
  for (const day of unpaidDays) {
    const seg = segments.find((s) => day.date >= s.from && day.date <= s.to);
    if (!seg) continue;
    for (const c of seg.components) lopNum.set(c.code, (lopNum.get(c.code) ?? 0) + c.monthlyPaise * day.units);
  }
  return [...meta.values()].map((c) => {
    const proRated = mulDivRound(proNum.get(c.code) ?? 0, 1, daysInMonth);
    const lop = mulDivRound(lopNum.get(c.code) ?? 0, 1, 2 * daysInMonth);
    return { code: c.code, label: c.label, pfWage: c.pfWage, proRatedPaise: proRated, lopPaise: lop, earnedPaise: Math.max(0, proRated - lop) };
  });
}

export function ptFor(gross, rules, isFebruary) {
  if (!rules.pt.enabled || gross <= 0) return 0;
  const slab = rules.pt.slabs.find((s) => gross >= s.fromPaise && (s.toPaise === null || s.toPaise === undefined || gross <= s.toPaise));
  if (!slab) return 0;
  return isFebruary && slab.februaryPaise !== null && slab.februaryPaise !== undefined ? slab.februaryPaise : slab.monthlyPaise;
}

/**
 * A full payroll entry. Inputs:
 *   earnings   — from computeEarnings
 *   arrears    — [{ code, label, amountPaise, pfWage, basis }] (P12; may be negative for recoveries)
 *   flags      — { pfApplicable, pfOnFullWage, esiApplicable } from the employee's latest revision
 *   adjustments — { tdsPaise, earnings: [{label, amountPaise}], deductions: [{label, amountPaise}] }
 */
export function computeEntry({ earnings, arrears = [], flags, adjustments, rules, isFebruary, daysInMonth, paidUnits }) {
  const lines = [];
  for (const e of earnings) {
    if (e.earnedPaise || e.proRatedPaise) {
      lines.push({ code: e.code, label: e.label, type: 'earning', amountPaise: e.earnedPaise, basis: e.lopPaise ? `${paidUnits / 2} of ${daysInMonth} days paid` : '' });
    }
  }
  for (const a of arrears) if (a.amountPaise) lines.push({ code: `ARR_${a.code}`, label: `Arrears: ${a.label}`, type: 'earning', amountPaise: a.amountPaise, basis: a.basis });
  adjustments.earnings.forEach((a, i) => lines.push({ code: `ADJ_E${i + 1}`, label: a.label, type: 'earning', amountPaise: a.amountPaise, basis: 'One-off' }));
  const gross = lines.filter((l) => l.type === 'earning').reduce((s, l) => s + l.amountPaise, 0);

  const pfWage = earnings.filter((e) => e.pfWage).reduce((s, e) => s + e.earnedPaise, 0) + arrears.filter((a) => a.pfWage).reduce((s, a) => s + a.amountPaise, 0);
  const pfBase = flags.pfOnFullWage ? pfWage : Math.min(pfWage, rules.pf.wageCeilingPaise);
  const pfOn = rules.pf.enabled && flags.pfApplicable && pfWage > 0;
  const pfEmployee = pfOn ? applyBp(pfBase, rules.pf.employeeBp) : 0;
  const pfEmployer = pfOn ? applyBp(pfBase, rules.pf.employerBp) : 0;
  const eps = pfOn ? Math.min(pfEmployer, applyBp(Math.min(pfWage, rules.pf.epsCeilingPaise), rules.pf.epsBp)) : 0;
  const esiOn = rules.esi.enabled && flags.esiApplicable && gross > 0;
  const esiEmployee = esiOn ? applyBp(gross, rules.esi.employeeBp) : 0;
  const esiEmployer = esiOn ? applyBp(gross, rules.esi.employerBp) : 0;
  const pt = ptFor(gross, rules, isFebruary);
  const basic = earnings.find((e) => e.code === 'BASIC')?.earnedPaise ?? 0;
  const gratuity = applyBp(basic, rules.gratuity.bpOfBasic);

  if (pfEmployee) lines.push({ code: 'PF_EE', label: 'Provident fund', type: 'deduction', amountPaise: pfEmployee, basis: `${rules.pf.employeeBp / 100}% of ${pfBase / 100}` });
  if (esiEmployee) lines.push({ code: 'ESI_EE', label: 'ESI', type: 'deduction', amountPaise: esiEmployee, basis: `${rules.esi.employeeBp / 100}% of gross` });
  if (pt) lines.push({ code: 'PT', label: 'Professional tax', type: 'deduction', amountPaise: pt, basis: rules.pt.state });
  if (adjustments.tdsPaise) lines.push({ code: 'TDS', label: 'Income tax (TDS)', type: 'deduction', amountPaise: adjustments.tdsPaise, basis: 'As provided' });
  adjustments.deductions.forEach((a, i) => lines.push({ code: `ADJ_D${i + 1}`, label: a.label, type: 'deduction', amountPaise: a.amountPaise, basis: 'One-off' }));

  if (pfEmployer) {
    lines.push({ code: 'PF_ER', label: 'Employer PF', type: 'employer', amountPaise: pfEmployer - eps, basis: '' });
    if (eps) lines.push({ code: 'EPS_ER', label: 'Employer pension (EPS)', type: 'employer', amountPaise: eps, basis: '' });
  }
  if (esiEmployer) lines.push({ code: 'ESI_ER', label: 'Employer ESI', type: 'employer', amountPaise: esiEmployer, basis: '' });
  if (gratuity) lines.push({ code: 'GRATUITY', label: 'Gratuity provision', type: 'employer', amountPaise: gratuity, basis: '' });

  const deductions = lines.filter((l) => l.type === 'deduction').reduce((s, l) => s + l.amountPaise, 0);
  const netBefore = gross - deductions;
  const rounding = netBefore > 0 ? roundToRupee(netBefore) - netBefore : 0;
  if (rounding) lines.push({ code: 'ROUNDING', label: 'Rounding', type: 'rounding', amountPaise: rounding, basis: 'Net rounded to the rupee' });
  const employerCost = gross + lines.filter((l) => l.type === 'employer').reduce((s, l) => s + l.amountPaise, 0);

  return {
    lines,
    totals: { grossPaise: gross, deductionsPaise: deductions, netBeforeRoundingPaise: netBefore, roundingPaise: rounding, netPaise: netBefore + rounding, employerCostPaise: employerCost },
    blockers: netBefore < 0 ? ['Deductions exceed gross pay'] : [],
  };
}

/** Per-component arrears for one past month: what should have been earned minus what was paid. */
export function arrearsForMonth(recomputed, paid) {
  return recomputed
    .map((e) => ({ code: e.code, label: e.label, pfWage: e.pfWage, amountPaise: e.earnedPaise - (paid.get(e.code) ?? 0) }))
    .concat([...paid.entries()].filter(([code]) => !recomputed.some((e) => e.code === code)).map(([code, amount]) => ({ code, label: code, pfWage: false, amountPaise: -amount })))
    .filter((a) => a.amountPaise !== 0);
}
