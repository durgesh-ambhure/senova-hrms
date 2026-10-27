import { NavLink } from 'react-router';
import clsx from 'clsx';
import { Logo } from './Logo.jsx';
import { visibleNavigation } from './navigation.js';
import { useAuth } from '../../features/auth/AuthProvider.jsx';

export function SidebarNav({ onNavigate }) {
  const { canAny } = useAuth();
  const sections = visibleNavigation(canAny);
  return (
    <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.section}>
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-brand-300">{section.section}</p>
          <ul className="space-y-0.5">
            {section.items.map(({ to, label, icon: Icon }) => (
              <li key={label}>
                <NavLink
                  to={to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-white/10 text-white' : 'text-brand-100 hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={clsx('h-[18px] w-[18px]', isActive ? 'text-accent-300' : 'text-brand-300')} aria-hidden="true" />
                      {label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-brand-900 lg:flex">
      <div className="flex h-16 items-center border-b border-white/10 px-5">
        <Logo inverted />
      </div>
      <SidebarNav />
      <p className="border-t border-white/10 px-5 py-3 text-[11px] text-brand-300">People. Purpose. Progress.</p>
    </aside>
  );
}
