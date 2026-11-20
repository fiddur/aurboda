import type {
  AddPushSubscriptionBody,
  PushSubscription as PushSubscriptionInfo,
  WebPushPayload,
} from '@aurboda/api-spec'

export const NOTIFICATION_READ_PARAM = 'notification_read'
export const PUSH_OFFER_DISMISSED_KEY = 'aurboda_push_offer_dismissed'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Where this browser stands with push:
 * - `hidden`: not offered at all (embedded in the Android app, or the server does not offer push);
 * - `unsupported`: the browser lacks the Push API;
 * - `needs_home_screen`: an iPhone or iPad browser, which offers push only to an installed web app;
 * - `blocked`: the user or the browser denied notifications;
 * - `off` / `on`: whether this browser is subscribed.
 */
export type PushState = 'loading' | 'hidden' | 'unsupported' | 'needs_home_screen' | 'blocked' | 'off' | 'on'

export interface PushStateInput {
  embedded: boolean
  supported: boolean
  needsHomeScreen: boolean
  /** Undefined while the server's answer is loading. */
  serverEnabled: boolean | undefined
  permission: NotificationPermission | 'unsupported'
  /** Undefined while loading: whether this browser holds a subscription the server knows. */
  subscribed: boolean | undefined
}

export const derivePushState = (input: PushStateInput): PushState => {
  if (input.embedded) return 'hidden'
  if (input.serverEnabled === undefined) return 'loading'
  if (!input.serverEnabled) return 'hidden'
  if (input.needsHomeScreen) return 'needs_home_screen'
  if (!input.supported) return 'unsupported'
  if (input.permission === 'denied') return 'blocked'
  if (input.subscribed === undefined) return 'loading'
  return input.subscribed ? 'on' : 'off'
}

/** The bell offers push once, dismissibly, where turning it on is something the user can do here. */
export const shouldOfferPush = (state: PushState, dismissed: boolean): boolean =>
  !dismissed && (state === 'off' || state === 'needs_home_screen')

const IOS_RE = /\b(iPhone|iPad|iPod)\b/

/** An iPhone or iPad browser (an iPad asking for the desktop site says Macintosh, but has touch) that is not an installed web app. */
export const needsHomeScreen = (userAgent: string, maxTouchPoints: number, standalone: boolean): boolean =>
  !standalone && (IOS_RE.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** The push payload, or null when it is not one Aurboda sent. */
export const parsePushPayload = (raw: unknown): WebPushPayload | null => {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string') return null
  return {
    body: stringOrNull(raw.body),
    id: raw.id,
    link: stringOrNull(raw.link),
    title: raw.title,
    type: typeof raw.type === 'string' ? raw.type : '',
  }
}

/**
 * Where clicking a push opens: its in-app link (or the notifications page), on this origin, with
 * `notification_read` so the page marks it read. A link that is not an in-app path is ignored.
 */
export const pushTargetUrl = (link: string | null, id: string, origin: string): string => {
  const path = link?.startsWith('/') && !link.startsWith('//') ? link : '/notifications'
  const url = new URL(path, origin)
  if (url.origin !== origin) return new URL('/notifications', origin).toString()
  if (UUID_RE.test(id)) url.searchParams.set(NOTIFICATION_READ_PARAM, id)
  return url.toString()
}

/** The notification a push click asked to mark read, and the address without the parameter. */
export const takeNotificationRead = (href: string): { id: string; cleaned: string } | null => {
  const url = new URL(href)
  const id = url.searchParams.get(NOTIFICATION_READ_PARAM)
  if (id === null) return null
  url.searchParams.delete(NOTIFICATION_READ_PARAM)
  const cleaned = `${url.pathname}${url.search}${url.hash}`
  return UUID_RE.test(id) ? { cleaned, id } : { cleaned, id: '' }
}

/** SHA-256 of a text, as lowercase hex. */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The VAPID public key (URL-safe base64) as the bytes `pushManager.subscribe` takes. */
export const urlBase64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replaceAll('-', '+')
    .replaceAll('_', '/')
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export interface PushBrowser {
  supported: boolean
  needsHomeScreen: boolean
  permission: () => NotificationPermission | 'unsupported'
  requestPermission: () => Promise<NotificationPermission>
  /** This browser's subscription endpoint, or null when it has none. */
  endpoint: () => Promise<string | null>
  subscribe: (publicKey: string) => Promise<PushSubscriptionJSON>
  /** Resolves to the endpoint it dropped, or null when there was none. */
  unsubscribe: () => Promise<string | null>
}

export interface PushServerApi {
  add: (body: AddPushSubscriptionBody) => Promise<unknown>
  list: (endpoint: string) => Promise<PushSubscriptionInfo[]>
  remove: (id: string) => Promise<unknown>
}

export const toSubscriptionBody = (json: PushSubscriptionJSON): AddPushSubscriptionBody => {
  const { endpoint, keys } = json
  if (!endpoint || !keys?.auth || !keys.p256dh) {
    throw new Error('The browser gave an incomplete push subscription')
  }
  return { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } }
}

/**
 * A subscription in this browser that the signed-in account does not list belongs to another
 * account that used the browser, or was removed from elsewhere. It is dropped, so that account's
 * notifications stop showing here. Resolves to whether one was dropped.
 */
export const dropUnknownSubscription = async (
  browser: PushBrowser,
  api: Pick<PushServerApi, 'list'>,
): Promise<boolean> => {
  const endpoint = await browser.endpoint()
  if (endpoint === null) return false
  if ((await api.list(endpoint)).some((subscription) => subscription.current)) return false
  if ((await browser.endpoint()) !== endpoint) return false
  await browser.unsubscribe()
  return true
}

/** Asks for permission, subscribes this browser and tells the server. Resolves to the state it ends in. */
export const enablePush = async (
  browser: PushBrowser,
  api: PushServerApi,
  publicKey: string,
): Promise<'on' | 'off' | 'blocked'> => {
  const permission = await browser.requestPermission()
  if (permission === 'denied') return 'blocked'
  if (permission !== 'granted') return 'off'
  await dropUnknownSubscription(browser, api)
  await api.add(toSubscriptionBody(await browser.subscribe(publicKey)))
  return 'on'
}

/** Removes this browser's subscription from the server, then unsubscribes it. */
export const disablePush = async (browser: PushBrowser, api: PushServerApi): Promise<void> => {
  const endpoint = await browser.endpoint()
  if (endpoint !== null) {
    const current = (await api.list(endpoint)).find((subscription) => subscription.current)
    if (current) await api.remove(current.id)
  }
  await browser.unsubscribe()
}
