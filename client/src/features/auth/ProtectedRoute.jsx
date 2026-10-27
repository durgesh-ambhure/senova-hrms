import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthProvider.jsx';
import { ErrorState, PageLoader } from '../../components/ui/index.js';
import { ForbiddenPage } from '../../pages/ForbiddenPage.jsx';

/** Requires a signed-in user; optionally one of `anyOf` permissions. */
export function ProtectedRoute({ anyOf, children }) {
  const { user, isLoading, error, refetch, canAny } = useAuth();
  const location = useLocation();

  if (isLoading) return <PageLoader label="Checking your session" />;
  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (anyOf?.length && !canAny(...anyOf)) return <ForbiddenPage />;
  return children ?? <Outlet />;
}

/** For /login etc.: signed-in users go straight to the app. */
export function GuestRoute({ children }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return children ?? <Outlet />;
}
