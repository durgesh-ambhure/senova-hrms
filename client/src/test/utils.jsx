import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { createQueryClient } from '../app/queryClient.js';
import { Providers } from '../app/App.jsx';
import { AppRoutes } from '../app/router.jsx';

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Installs a fetch mock. `routes` maps "METHOD /path" (path without /api/v1 and query) to a
 * handler `(req) => [status, body]` or a static `[status, body]`.
 */
export function mockApi(routes) {
  const calls = [];
  const fetchMock = vi.fn(async (input, init = {}) => {
    const url = new URL(input, 'http://localhost');
    const method = init.method ?? 'GET';
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, query: Object.fromEntries(url.searchParams), body, headers: init.headers });
    if (method === 'GET' && path === '/auth/csrf' && !routes['GET /auth/csrf']) return json(200, { data: { csrfToken: 'test-csrf' } });
    const handler = routes[`${method} ${path}`];
    if (!handler) return json(404, { error: { code: 'NOT_FOUND', message: `No mock for ${method} ${path}` } });
    const [status, resBody] = typeof handler === 'function' ? await handler({ body, query: Object.fromEntries(url.searchParams) }) : handler;
    return json(status, resBody);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const sessionFor = (permissions, user = {}) => [
  200,
  { data: { user: { id: 'u1', name: 'Priya Sharma', email: 'priya@senova.test', roles: ['employee'], status: 'active', ...user }, permissions } },
];

export function renderApp(path = '/') {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers queryClient={queryClient}>
        <AppRoutes />
      </Providers>
    </MemoryRouter>,
  );
}
