import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { setCsrfToken } from '../lib/api.js';

// Lazy-loaded routes can take longer than the 1s default when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
  cleanup();
  setCsrfToken(null);
});
