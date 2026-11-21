import {
  needsHomeScreen,
  type PushBrowser,
  uint8ArrayToUrlBase64,
  urlBase64ToUint8Array,
} from '../components/push'

const SERVICE_WORKER_URL = '/sw.js'

declare global {
  interface Navigator {
    /** Safari on iOS: true when the page runs as a web app added to the home screen. */
    standalone?: boolean
  }
}

const isSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

const isStandalone = (): boolean =>
  navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true

const existingRegistration = async (): Promise<ServiceWorkerRegistration | undefined> =>
  isSupported() ? navigator.serviceWorker.getRegistration('/') : undefined

const currentSubscription = async (): Promise<PushSubscription | null> =>
  (await (await existingRegistration())?.pushManager.getSubscription()) ?? null

export const browserPush: PushBrowser = {
  endpoint: async () => (await currentSubscription())?.endpoint ?? null,
  needsHomeScreen:
    typeof navigator !== 'undefined' &&
    needsHomeScreen(navigator.userAgent, navigator.maxTouchPoints, isStandalone()),
  permission: () => (isSupported() ? Notification.permission : 'unsupported'),
  requestPermission: () => Notification.requestPermission(),
  subscribe: async (publicKey) => {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' })
    const registration = await navigator.serviceWorker.ready
    const existing = await registration.pushManager.getSubscription()
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        applicationServerKey: urlBase64ToUint8Array(publicKey),
        userVisibleOnly: true,
      }))
    return subscription.toJSON()
  },
  subscriptionKey: async () => {
    const key = (await currentSubscription())?.options.applicationServerKey
    return key ? uint8ArrayToUrlBase64(new Uint8Array(key)) : null
  },
  supported: isSupported(),
  unsubscribe: async () => {
    const subscription = await currentSubscription()
    if (!subscription) return null
    await subscription.unsubscribe()
    return subscription.endpoint
  },
}
