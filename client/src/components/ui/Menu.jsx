import { useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';

/**
 * Small dropdown menu. `trigger` is a render function receiving button props;
 * `items` are { label, onSelect, icon?, danger?, hidden? }.
 */
export function Menu({ trigger, items, align = 'right', label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;

  return (
    <div className="relative" ref={ref}>
      {trigger({
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': id,
        'aria-label': label,
        onClick: () => setOpen((o) => !o),
      })}
      {open && (
        <div
          id={id}
          role="menu"
          className={clsx(
            'absolute z-40 mt-1 min-w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-overlay',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50',
                item.danger ? 'text-red-600' : 'text-slate-700',
              )}
            >
              {item.icon && <item.icon className="h-4 w-4" aria-hidden="true" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
