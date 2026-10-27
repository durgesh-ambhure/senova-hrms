import { Logo } from '../../components/layout/Logo.jsx';

export function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-bg relative flex min-h-screen overflow-hidden">
      <aside className="relative hidden w-[44%] flex-col justify-between p-12 text-white lg:flex">
        <div aria-hidden="true" className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent-500/20 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl" />
        <Logo inverted size="lg" />
        <div className="relative">
          <p className="text-4xl font-semibold leading-tight tracking-tight">
            People. Purpose.
            <br />
            <span className="text-accent-300">Progress.</span>
          </p>
          <p className="mt-4 max-w-md text-base text-brand-100">
            One place for your team — from the first day to every payday.
          </p>
        </div>
        <p className="relative text-xs text-brand-200">Internal system · Authorized personnel only</p>
      </aside>
      <main className="neu flex flex-1 items-center justify-center px-4 py-12 sm:px-8">
        <div className="neu-card w-full max-w-md px-6 py-9 sm:px-10">
          <div className="neu-logo mb-8 inline-flex lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
