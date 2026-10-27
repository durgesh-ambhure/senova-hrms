import { z } from 'zod';

/**
 * Money is stored as integer paise. Inputs arrive as rupee amounts ("1250000", "1250000.5", 1250000.75)
 * and are converted by string arithmetic — never by multiplying floats.
 */
export const MAX_RUPEES = 1_000_000_000; // ₹100 crore: far above any salary, catches unit mistakes

export function rupeesToPaise(value) {
  const s = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export const paiseToRupees = (paise) => (paise === null || paise === undefined ? null : paise / 100);

/** zod: a non-negative rupee amount with at most 2 decimals, parsed to integer paise. */
export const rupees = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    if (typeof v === 'number' && (!Number.isFinite(v) || v < 0 || Math.round(v * 100) !== Number((v * 100).toFixed(4)))) {
      ctx.addIssue({ code: 'custom', message: 'Enter an amount in rupees with at most 2 decimals' });
      return z.NEVER;
    }
    const paise = rupeesToPaise(v);
    if (paise === null || paise > MAX_RUPEES * 100) {
      ctx.addIssue({ code: 'custom', message: 'Enter an amount in rupees with at most 2 decimals' });
      return z.NEVER;
    }
    return paise;
  });

/**
 * round(amount × num / den), half away from zero, computed exactly with BigInt so pro-rating,
 * percentages and per-day rates never pick up floating-point error.
 */
export function mulDivRound(amount, num, den) {
  if (den === 0 || den === 0n) throw new Error('Division by zero');
  const a = BigInt(amount) * BigInt(num);
  const d = BigInt(den);
  const negative = (a < 0n) !== (d < 0n);
  const absA = a < 0n ? -a : a;
  const absD = d < 0n ? -d : d;
  const q = (absA * 2n + absD) / (absD * 2n);
  return Number(negative ? -q : q);
}

/** Percentages are stored in basis points: 1200 bp = 12%. */
export const applyBp = (amount, bp) => mulDivRound(amount, bp, 10_000);

/** Rounds paise to the nearest rupee, half away from zero. */
export const roundToRupee = (paise) => mulDivRound(paise, 1, 100) * 100;
