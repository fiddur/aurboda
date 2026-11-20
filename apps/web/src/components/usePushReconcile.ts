import { useEffect } from 'preact/hooks'

import { isEmbedded } from '../embed'
import { auth } from '../state/auth'
import { browserPush } from '../state/push-browser'
import { queryClient } from '../state/queryClient'
import { dropUnknownSubscription } from './push'
import { PUSH_KEY, pushServerApi } from './usePush'

/** On sign-in, a push subscription left in this browser by another account is dropped. */
export const usePushReconcile = (): void => {
  const token = auth.value.token
  useEffect(() => {
    if (!token || isEmbedded() || !browserPush.supported) return
    dropUnknownSubscription(browserPush, pushServerApi)
      .then((dropped) => (dropped ? queryClient.invalidateQueries({ queryKey: PUSH_KEY }) : undefined))
      .catch((error: unknown) => console.warn('Could not check this browser’s push subscription:', error))
  }, [token])
}
