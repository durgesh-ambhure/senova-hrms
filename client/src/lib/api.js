/**
 * Thin fetch wrapper for the Senova API.
 * - Cookies carry the session (HttpOnly; JavaScript never sees it).
 * - Every non-GET request sends the CSRF token, fetched lazily and refreshed once on rejection.
 * - Errors are normalized into ApiError with the server's code, message and field details.
 */
const BASE = '/api/v1';
let csrfToken = null;

export class ApiError extends Error {
  constructor(status, { code = 'UNKNOWN', message = 'Request failed', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setCsrfToken(token) {
  csrfToken = token;
}

async function fetchCsrfToken() {
  const res = await fetch(`${BASE}/auth/csrf`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, { message: 'Could not reach the server' });
  csrfToken = (await res.json()).data.csrfToken;
}

function toQueryString(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function api(path, { method = 'GET', body, query, signal } = {}, retried = false) {
  const unsafe = method !== 'GET';
  if (unsafe && !csrfToken) await fetchCsrfToken();
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  let res;
  try {
    res = await fetch(`${BASE}${path}${toQueryString(query)}`, {
      method,
      credentials: 'include',
      signal,
      headers: {
        Accept: 'application/json',
        // FormData sets its own multipart boundary header.
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(unsafe ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection and try again.' });
  }

  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (json?.error?.code === 'CSRF_INVALID' && !retried) {
      csrfToken = null;
      return api(path, { method, body, query, signal }, true);
    }
    throw new ApiError(res.status, json?.error);
  }
  return json;
}

/** Convenience: unwraps `{ data }`. */
export const get = (path, query, opts) => api(path, { ...opts, query }).then((r) => r.data);
export const post = (path, body) => api(path, { method: 'POST', body: body ?? {} }).then((r) => r?.data ?? null);
export const patch = (path, body) => api(path, { method: 'PATCH', body }).then((r) => r?.data ?? null);
export const put = (path, body) => api(path, { method: 'PUT', body }).then((r) => r?.data ?? null);
export const del = (path) => api(path, { method: 'DELETE' }).then((r) => r?.data ?? null);
export const upload = (path, formData) => api(path, { method: 'POST', body: formData }).then((r) => r?.data ?? null);

/** Downloads an authenticated file and hands it to the browser without exposing a public URL. */
export async function download(path, fileName) {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new ApiError(res.status, json?.error ?? { message: 'Download failed' });
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies server-side field errors into react-hook-form. Returns true if any were applied. */
export function applyFieldErrors(error, setError, fields) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return false;
  let applied = false;
  for (const d of error.details) {
    const name = d.path?.split('.')[0];
    if (name && (!fields || fields.includes(name))) {
      setError(name, { type: 'server', message: d.message });
      applied = true;
    }
  }
  return applied;
}
