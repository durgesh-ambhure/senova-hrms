import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin API in development: cookies stay first-party and CORS is not involved.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    restoreMocks: true,
    // First render of a lazy route transforms its chunk on demand; slow under parallel workers.
    testTimeout: 20_000,
  },
});
