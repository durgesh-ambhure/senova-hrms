import { Link } from 'react-router';
import { buttonClass } from '../components/ui/index.js';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-accent-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">The page you're looking for doesn't exist or has moved.</p>
      <Link to="/dashboard" className={buttonClass({ className: 'mt-6' })}>
        Go to dashboard
      </Link>
    </div>
  );
}
