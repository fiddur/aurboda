import { useEffect } from 'preact/hooks'

import { subscribeLiveEvents } from '../state/live-events'
import { queryClient } from '../state/queryClient'

/** Refetches the bell as soon as a notification is raised, revised or read elsewhere. */
export const useLiveNotifications = (): void => {
  useEffect(
    () =>
      subscribeLiveEvents('notification', () => {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      }),
    [],
  )
}
