import { useEffect } from 'preact/hooks'

import { isEmbedded } from '../embed'
import { fetchPushConfig } from '../state/api'
import { auth } from '../state/auth'
import { browserPush } from '../state/push-browser'
import { queryClient } from '../state/queryClient'
import { reconcilePushSubscription } from './push'
import { PUSH_CONFIG_STALE_MS, PUSH_KEY, pushServerApi } from './usePush'

/**
 * On sign-in, a push subscription left in this browser by another account is dropped, and the
 * account's own one is renewed when the server's VAPID key changed since it was made.
 */
export const usePushReconcile = (): void => {
  const token = auth.value.token
  useEffect(() => {
    if (!token || isEmbedded() || !browserPush.supported) return
    const publicKey = async () =>
      (
        await queryClient.fetchQuery({
          queryFn: fetchPushConfig,
          queryKey: [...PUSH_KEY, 'config'],
          staleTime: PUSH_CONFIG_STALE_MS,
        })
      ).public_key
    reconcilePushSubscription(browserPush, pushServerApi, publicKey)
      .then((changed) => (changed ? queryClient.invalidateQueries({ queryKey: PUSH_KEY }) : undefined))
      .catch((error: unknown) => console.warn('Could not check this browser’s push subscription:', error))
  }, [token])
}
