import { QueryClient } from '@tanstack/react-query'

// Create and export a singleton QueryClient instance
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 30 * 60 * 1000, // How long unused data stays cached
      refetchOnWindowFocus: false, // Disabled to prevent unnecessary reloads on focus
      retry: 2, // Number of retries for failed queries
      staleTime: 5 * 60 * 1000, // Default cache validity: 5 minutes
    },
  },
})
