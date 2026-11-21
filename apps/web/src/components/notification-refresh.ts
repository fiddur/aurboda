import type { QueryClient } from '@tanstack/react-query'

import { CHECK_INS_KEY } from '../pages/CheckIns/queries'

/**
 * Refetches the notifications and what a notification's action or a change elsewhere may have
 * written: a Done or Skip from the bell saves a check-in, so the check-in pages and Home's card follow.
 */
export const refreshAfterNotificationChange = (queryClient: QueryClient): Promise<void[]> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    queryClient.invalidateQueries({ queryKey: CHECK_INS_KEY }),
  ])
