import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { X } from 'lucide-react';
import { Sidebar, SidebarNav } from './Sidebar.jsx';
import { Header } from './Header.jsx';
import { Logo } from './Logo.jsx';
import { PageLoader } from '../ui/index.js';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Sidebar />

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-brand-900">
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
              <Logo inverted />
              <button type="button" onClick={() => setMobileOpen(false)} className="rounded-md p-1 text-brand-100 hover:bg-white/10" aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMobileNav={() => setMobileOpen(true)} />
        <main id="main" key={pathname} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
