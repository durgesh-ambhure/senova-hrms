import clsx from 'clsx';

const tones = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  accent: 'bg-accent-50 text-accent-700 ring-accent-100',
};

export function Badge({ tone = 'neutral', className, children }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONES = { active: 'success', invited: 'warning', disabled: 'neutral' };

export function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}
