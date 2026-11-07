'use client';
import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider, isServer } from '@tanstack/react-query';
import { Provider as JotaiProvider } from 'jotai';

let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (isServer) return new QueryClient();
  return browserQueryClient ??= new QueryClient();
}

export function Providers({ children }: PropsWithChildren) {
  return <QueryClientProvider client={getQueryClient()}><JotaiProvider>{children}</JotaiProvider></QueryClientProvider>;
}
