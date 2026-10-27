import { Link } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { buttonClass } from '../components/ui/index.js';

export function ForbiddenPage() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <div className="mb-4 rounded-full bg-amber-50 p-4 text-amber-600">
        <ShieldAlert className="h-8 w-8" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-semibold text-slate-900">You don't have access to this page</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">If you need access, ask a Super Admin to update your role.</p>
      <Link to="/dashboard" className={buttonClass({ variant: 'secondary', className: 'mt-6' })}>
        Back to dashboard
      </Link>
    </div>
  );
}
