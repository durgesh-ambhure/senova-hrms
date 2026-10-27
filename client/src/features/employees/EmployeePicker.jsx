import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { useEmployees } from './api.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue.js';

/** Searchable single-employee picker (combobox). `value` is { id, fullName } or null. */
export function EmployeePicker({ label, value, onChange, excludeId, error, hint }) {
  const id = useId();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useDebouncedValue(term.trim(), 250);
  const results = useEmployees({ search, limit: 8, sort: 'fullName', page: 1 }, open);
  const options = (results.data?.data ?? []).filter((e) => e.id !== excludeId && ['active', 'notice_period'].includes(e.lifecycleStatus));

  const choose = (e) => {
    onChange({ id: e.id, fullName: e.fullName });
    setTerm('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {value ? (
        <div className="flex h-10 items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-sm">
          <span className="truncate text-slate-900">{value.fullName}</span>
          <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-slate-700" aria-label={`Clear ${label}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          value={term}
          placeholder="Search by name or code"
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setTerm(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            else if (e.key === 'Enter' && options[active]) {
              e.preventDefault();
              choose(options[active]);
            } else return;
            e.preventDefault();
          }}
          className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      )}
      {open && !value && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-overlay">
          {results.isLoading && <li className="px-3 py-2 text-sm text-slate-500">Searching…</li>}
          {!results.isLoading && options.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No current employees found</li>}
          {options.map((e, i) => (
            <li
              key={e.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(ev) => {
                ev.preventDefault();
                choose(e);
              }}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-brand-50' : ''}`}
            >
              <span className="font-medium text-slate-900">{e.fullName}</span>
              <span className="ml-2 text-xs text-slate-500">
                {e.employeeCode} · {e.designation?.title}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-1.5 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
