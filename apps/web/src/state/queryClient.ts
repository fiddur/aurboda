import { focusManager, QueryClient } from '@tanstack/react-query'

// TanStack Query's default focusManager only listens to `visibilitychange`,
// which fires when switching browser tabs but NOT when alt-tabbing between
// applications (e.g. terminal ↔ browser on Linux). Add a `focus` listener
// so stale queries also refetch when the browser window regains OS-level focus.
focusManager.setEventListener((handleFocus) => {
  const onVisibilityChange = () => handleFocus()
  const onFocus = () => handleFocus()

  window.addEventListener('visibilitychange', onVisibilityChange, false)
  window.addEventListener('focus', onFocus, false)

  return () => {
    window.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onFocus)
  }
})

// Create and export a singleton QueryClient instance
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 30 * 60 * 1000, // How long unused data stays cached
      refetchOnWindowFocus: true, // Refetch stale data when window regains focus
      retry: 2, // Number of retries for failed queries
      staleTime: 5 * 60 * 1000, // Default cache validity: 5 minutes
    },
  },
})
