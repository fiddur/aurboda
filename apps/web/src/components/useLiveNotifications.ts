import { useEffect } from 'preact/hooks'

import { subscribeLiveEvents } from '../state/live-events'
import { queryClient } from '../state/queryClient'
import { refreshAfterNotificationChange } from './notification-refresh'

/**
 * Refetches the bell, and the check-ins a notification's action may have saved, as soon as a
 * notification is raised, revised or read elsewhere.
 */
export const useLiveNotifications = (): void => {
  useEffect(
    () =>
      subscribeLiveEvents('notification', () => {
        void refreshAfterNotificationChange(queryClient)
      }),
    [],
  )
}
