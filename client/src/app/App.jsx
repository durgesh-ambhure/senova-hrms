import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from './queryClient.js';
import { AppRoutes } from './router.jsx';
import { AuthProvider } from '../features/auth/AuthProvider.jsx';
import { ToastProvider } from '../components/ui/index.js';

export function Providers({ children, queryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <BrowserRouter>
      <Providers queryClient={queryClient}>
        <AppRoutes />
      </Providers>
    </BrowserRouter>
  );
}
