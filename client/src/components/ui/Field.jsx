import { forwardRef, useId } from 'react';
import clsx from 'clsx';

const control =
  'block w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-500';
const controlState = (error) =>
  error ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-100';

/** Label + control + hint/error wrapper. Children receive the generated id and aria props. */
export function FormField({ label, error, hint, required, children, className }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
        </label>
      )}
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ label, error, hint, required, className, ...props }, ref) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={className}>
      {(a11y) => <input ref={ref} className={clsx(control, controlState(error), 'h-10')} required={required} {...a11y} {...props} />}
    </FormField>
  );
});

export const Select = forwardRef(function Select({ label, error, hint, required, className, children, ...props }, ref) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={className}>
      {(a11y) => (
        <select ref={ref} className={clsx(control, controlState(error), 'h-10 pr-8')} required={required} {...a11y} {...props}>
          {children}
        </select>
      )}
    </FormField>
  );
});

export const Textarea = forwardRef(function Textarea({ label, error, hint, required, className, rows = 3, ...props }, ref) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={className}>
      {(a11y) => <textarea ref={ref} rows={rows} className={clsx(control, controlState(error), 'py-2')} required={required} {...a11y} {...props} />}
    </FormField>
  );
});

export const Checkbox = forwardRef(function Checkbox({ label, description, className, ...props }, ref) {
  const id = useId();
  return (
    <div className={clsx('flex items-start gap-3', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700 accent-brand-700 focus:ring-brand-500 disabled:opacity-50"
        {...props}
      />
      <label htmlFor={id} className="text-sm leading-tight">
        <span className="font-medium text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </label>
    </div>
  );
});
