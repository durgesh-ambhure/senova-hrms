import { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post, setCsrfToken } from '../../lib/api.js';
import { ME_QUERY_KEY } from '../../app/queryClient.js';

const AuthContext = createContext(null);

async function fetchMe() {
  try {
    return await get('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/**
 * Holds the signed-in user and effective permissions (from the server). `can()` is for showing or
 * hiding UI only — the API enforces every permission independently.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, staleTime: 5 * 60_000 });

  const permissions = useMemo(() => new Set(data?.permissions ?? []), [data]);
  const can = useCallback((p) => permissions.has('*') || permissions.has(p), [permissions]);
  const canAny = useCallback((...ps) => ps.some(can), [can]);

  // Drop every cached response from the previous user (but not the session query itself, whose
  // observer would otherwise refetch immediately) so no data leaks across accounts.
  const clearUserData = useCallback(
    () => queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] }),
    [queryClient],
  );

  const login = useCallback(
    async (credentials) => {
      const session = await post('/auth/login', credentials);
      setCsrfToken(session.csrfToken);
      clearUserData();
      queryClient.setQueryData(ME_QUERY_KEY, { user: session.user, permissions: session.permissions });
      return session;
    },
    [queryClient, clearUserData],
  );

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setCsrfToken(null);
      clearUserData();
      queryClient.setQueryData(ME_QUERY_KEY, null);
    }
  }, [queryClient, clearUserData]);

  const value = useMemo(
    () => ({ user: data?.user ?? null, permissions, can, canAny, login, logout, isLoading, error, refetch }),
    [data, permissions, can, canAny, login, logout, isLoading, error, refetch],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
