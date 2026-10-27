import { useRef } from 'react';
import clsx from 'clsx';

/** Accessible tab list (arrow-key navigation). Panels are rendered by the caller. */
export function Tabs({ tabs, value, onChange, label }) {
  const refs = useRef({});
  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.value === value);
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].value);
    refs.current[tabs[next].value]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200" onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.value}
          ref={(el) => (refs.current[t.value] = el)}
          type="button"
          role="tab"
          id={`tab-${t.value}`}
          aria-selected={t.value === value}
          aria-controls={`panel-${t.value}`}
          tabIndex={t.value === value ? 0 : -1}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            t.value === value ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ value, children }) {
  return (
    <div role="tabpanel" id={`panel-${value}`} aria-labelledby={`tab-${value}`} className="pt-5">
      {children}
    </div>
  );
}
