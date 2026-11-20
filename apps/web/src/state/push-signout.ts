import { disablePush } from '../components/push'
import { deletePushSubscription, fetchPushSubscriptions } from './api/notifications'
import { browserPush } from './push-browser'

/** Best effort: the server forgets this browser and the browser unsubscribes, so a signed-out browser gets no pushes. */
export const forgetBrowserPush = async (token: string): Promise<void> => {
  if (!browserPush.supported) return
  try {
    await disablePush(browserPush, {
      add: async () => undefined,
      list: (endpoint) => fetchPushSubscriptions(endpoint, token),
      remove: (id) => deletePushSubscription(id, token),
    })
  } catch (error) {
    console.warn('Could not remove push from this browser on sign-out:', error)
    await browserPush.unsubscribe().catch(() => null)
  }
}
