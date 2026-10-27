import { useLocation, useNavigate } from 'react-router';
import { ChevronRight, KeyRound, LogOut, Menu as MenuIcon } from 'lucide-react';
import { useAuth } from '../../features/auth/AuthProvider.jsx';
import { Menu, useToast } from '../ui/index.js';
import { initials, humanize } from '../../lib/format.js';
import { breadcrumbLabel } from './navigation.js';
import { ROLE_LABELS } from '../../lib/labels.js';

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
      <ol className="flex items-center gap-1.5 text-sm text-slate-500">
        {parts.map((part, i) => {
          const to = `/${parts.slice(0, i + 1).join('/')}`;
          const label = breadcrumbLabel(part, humanize);
          const last = i === parts.length - 1;
          return (
            <li key={to} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-slate-900">
                  {label}
                </span>
              ) : (
                <span className="truncate">{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Header({ onOpenMobileNav }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const signOut = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      toast.error('Sign-out failed. Please try again.');
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <button type="button" onClick={onOpenMobileNav} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open navigation">
        <MenuIcon className="h-5 w-5" />
      </button>
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-2">
        <Menu
          label="Account menu"
          items={[
            { label: 'Password & security', icon: KeyRound, onSelect: () => navigate('/account/security') },
            { label: 'Sign out', icon: LogOut, onSelect: signOut, danger: true },
          ]}
          trigger={(props) => (
            <button type="button" className="flex items-center gap-2.5 rounded-lg p-1 pr-2 hover:bg-slate-100" {...props}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                {initials(user?.name)}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-medium text-slate-900">{user?.name}</span>
                <span className="block text-xs text-slate-500">{user?.roles.map((r) => ROLE_LABELS[r] ?? humanize(r)).join(', ')}</span>
              </span>
            </button>
          )}
        />
      </div>
    </header>
  );
}
