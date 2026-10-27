import clsx from 'clsx';
import { Spinner } from './Spinner.jsx';

const variants = {
  primary: 'bg-brand-800 text-white hover:bg-brand-700 disabled:bg-brand-300',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
};
const sizes = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  icon: 'h-9 w-9 justify-center',
};

/** Button styling, also used for links that should look like buttons. */
// eslint-disable-next-line react-refresh/only-export-components
export function buttonClass({ variant = 'primary', size = 'md', className } = {}) {
  return clsx(
    'inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ variant = 'primary', size = 'md', loading = false, className, children, disabled, type = 'button', ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
