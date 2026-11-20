import { useEffect } from 'preact/hooks'

import { markNotificationRead } from '../state/api'
import { auth } from '../state/auth'
import { queryClient } from '../state/queryClient'
import { takeNotificationRead } from './push'

/**
 * A click on a browser push opens its link with `notification_read=<id>`: the service worker has
 * no token, so the page marks the notification read and drops the parameter from the address.
 */
export const useNotificationReadParam = (): void => {
  useEffect(() => {
    const taken = takeNotificationRead(window.location.href)
    if (taken === null) return
    history.replaceState(history.state, '', taken.cleaned)
    if (taken.id === '' || !auth.value.token) return
    markNotificationRead(taken.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
      .catch((error: unknown) => console.warn('Could not mark the pushed notification read:', error))
  }, [])
}
