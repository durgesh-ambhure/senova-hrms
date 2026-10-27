import clsx from 'clsx';

export function Spinner({ className, label }) {
  return (
    <svg className={clsx('animate-spin', className ?? 'h-5 w-5')} viewBox="0 0 24 24" fill="none" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-brand-700">
      <Spinner className="h-8 w-8" label={label} />
    </div>
  );
}
