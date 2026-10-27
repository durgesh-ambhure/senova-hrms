import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api.js';

export const ME_QUERY_KEY = ['auth', 'me'];

/** Any 401 means the session is gone: clear the user so routing sends them to /login. */
function handleUnauthenticated(error, client) {
  if (error instanceof ApiError && error.status === 401) client.setQueryData(ME_QUERY_KEY, null);
}

export function createQueryClient() {
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: (e) => handleUnauthenticated(e, client) }),
    mutationCache: new MutationCache({ onError: (e) => handleUnauthenticated(e, client) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
