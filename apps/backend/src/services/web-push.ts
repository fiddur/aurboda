import type { AddPushSubscriptionBody, PushSubscription, WebPushPayload } from '@aurboda/api-spec'

import { createHash } from 'node:crypto'
import https from 'node:https'
import webpush from 'web-push'

import type { VapidKeys } from './central-web-push.ts'

import {
  deletePushSubscription,
  getNotificationById,
  listPushSubscriptions,
  type NotificationRecord,
  type PushSubscriptionInsert,
  type PushSubscriptionRecord,
  recordPushFailure,
  recordPushSuccess,
  trimPushSubscriptions,
  upsertPushSubscription,
} from '../db/index.ts'
import { assertPublicUrl, createPublicOnlyLookup } from './safe-fetch.ts'

export const MAX_PUSH_SUBSCRIPTIONS = 20
export const MAX_PUSH_FAILURES = 20
export const PUSH_TTL_SECONDS = 86_400
export const USER_AGENT_MAX_LENGTH = 300
export const PUSH_TOPIC_MAX_LENGTH = 32
export const TEST_PUSH_TITLE = 'Aurboda can reach this browser'
const SEND_TIMEOUT_MS = 10_000

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const parseUrl = (raw: string): URL | null => {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

const isLocalhost = (hostname: string): boolean =>
  LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost')

/** Browsers offer push only to a secure origin: HTTPS, or `localhost` for development. */
export const isPushOriginAllowed = (webHost: string): boolean => {
  const url = parseUrl(webHost)
  if (url == null) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalhost(url.hostname))
}

/** The VAPID `sub` claim must be an https: or mailto: URL, so a development `http://localhost` origin is named as https. */
export const vapidSubject = (webHost: string): string => {
  const url = new URL(webHost)
  return `https://${url.host}`
}

/** A push service keeps one pending message per topic, so a revised notification replaces the unsent one. */
export const pushTopic = (dedupeKey: string): string =>
  createHash('sha256').update(dedupeKey).digest('base64url').slice(0, PUSH_TOPIC_MAX_LENGTH)

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/\bAndroid\b/, 'Android'],
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
]

const firstMatch = (value: string, table: [RegExp, string][]): string | undefined =>
  table.find(([pattern]) => pattern.test(value))?.[1]

/** "Firefox on Android", "Chrome on Windows", or "Browser" when the user agent says nothing usable. */
export const browserLabel = (userAgent: string | null | undefined): string => {
  if (!userAgent) return 'Browser'
  const browser = firstMatch(userAgent, BROWSERS) ?? 'Browser'
  const system = firstMatch(userAgent, SYSTEMS)
  return system ? `${browser} on ${system}` : browser
}

/** Why this endpoint may not be pushed to, or null when it may: HTTPS only, then the same outbound check federation uses. */
export const pushEndpointProblem = async (
  endpoint: string,
  assertPublic: (url: string) => Promise<void> = assertPublicUrl,
): Promise<string | null> => {
  const url = parseUrl(endpoint)
  if (url?.protocol !== 'https:') return 'The push endpoint must be an HTTPS URL'
  try {
    await assertPublic(endpoint)
    return null
  } catch (error) {
    return `The push endpoint is not on a public address: ${error instanceof Error ? error.message : String(error)}`
  }
}

export const pushPayload = (
  record: Pick<NotificationRecord, 'body' | 'id' | 'link' | 'title' | 'type'>,
): WebPushPayload => ({
  body: record.body,
  id: record.id,
  link: record.link,
  title: record.title,
  type: record.type,
})

/** How a browser names its own endpoint in a URL, so the endpoint itself stays out of access logs. */
export const pushEndpointHash = (endpoint: string): string =>
  createHash('sha256').update(endpoint).digest('hex')

export const serializePushSubscription = (
  record: PushSubscriptionRecord,
  currentEndpointHash?: string,
): PushSubscription => ({
  browser: browserLabel(record.user_agent),
  created_at: record.created_at.toISOString(),
  current: currentEndpointHash !== undefined && pushEndpointHash(record.endpoint) === currentEndpointHash,
  id: record.id,
  last_success_at: record.last_success_at?.toISOString() ?? null,
})

export interface PushSubscriptionStore {
  upsert: (user: string, input: PushSubscriptionInsert) => Promise<PushSubscriptionRecord>
  list: (user: string) => Promise<PushSubscriptionRecord[]>
  delete: (user: string, id: string) => Promise<boolean>
  trim: (user: string, keepId: string, max: number) => Promise<number>
  recordSuccess: (user: string, id: string) => Promise<void>
  recordFailure: (user: string, id: string) => Promise<number | null>
}

export const pushSubscriptionStore: PushSubscriptionStore = {
  delete: (user, id) => deletePushSubscription(user, id),
  list: (user) => listPushSubscriptions(user),
  recordFailure: (user, id) => recordPushFailure(user, id),
  recordSuccess: (user, id) => recordPushSuccess(user, id),
  trim: (user, keepId, max) => trimPushSubscriptions(user, keepId, max),
  upsert: (user, input) => upsertPushSubscription(user, input),
}

export interface PushSendOptions {
  ttl: number
  topic?: string
  subject: string
  vapid: VapidKeys
}

/** Rejects with an error carrying the push service's `statusCode` when it answered with a failure. */
export type PushSender = (
  subscription: Pick<PushSubscriptionRecord, 'auth' | 'endpoint' | 'p256dh'>,
  payload: string,
  options: PushSendOptions,
) => Promise<void>

/* v8 ignore start -- talks to a real push service */
const publicOnlyAgent = (): https.Agent =>
  new https.Agent({ keepAlive: true, lookup: createPublicOnlyLookup() })

export const createWebPushSender = (): PushSender => {
  let agent: https.Agent | undefined
  return async (subscription, payload, options) => {
    agent ??= publicOnlyAgent()
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { auth: subscription.auth, p256dh: subscription.p256dh } },
      payload,
      {
        TTL: options.ttl,
        agent,
        timeout: SEND_TIMEOUT_MS,
        ...(options.topic === undefined ? {} : { topic: options.topic }),
        vapidDetails: {
          privateKey: options.vapid.private_key,
          publicKey: options.vapid.public_key,
          subject: options.subject,
        },
      },
    )
  }
}
/* v8 ignore stop */

const statusCodeOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined

export type PushOutcome = 'reached' | 'removed' | 'failed'

export interface PushDelivery {
  reached: number
  removed: number
  failed: number
}

const tally = (outcomes: PushOutcome[]): PushDelivery => ({
  failed: outcomes.filter((o) => o === 'failed').length,
  reached: outcomes.filter((o) => o === 'reached').length,
  removed: outcomes.filter((o) => o === 'removed').length,
})

export interface WebPushDeps {
  webHost: string
  getVapidKeys: () => Promise<VapidKeys>
  store?: PushSubscriptionStore
  send?: PushSender
  assertPublic?: (url: string) => Promise<void>
  getNotification?: (user: string, id: string) => Promise<NotificationRecord | null>
  logError?: (message: string, error: unknown) => void
}

export type SubscribeOutcome =
  | { status: 'ok'; subscription: PushSubscription }
  | { status: 'disabled' }
  | { status: 'invalid_endpoint'; message: string }

export interface WebPush {
  enabled: boolean
  config: () => Promise<{ enabled: boolean; public_key?: string }>
  subscribe: (user: string, body: AddPushSubscriptionBody, userAgent?: string) => Promise<SubscribeOutcome>
  list: (user: string, currentEndpointHash?: string) => Promise<PushSubscription[]>
  remove: (user: string, id: string) => Promise<boolean>
  /** Null when this server does not offer push. */
  sendTest: (user: string) => Promise<{ reached: number; total: number } | null>
  /**
   * Sends a stored notification to the user's browsers. Nothing is sent for a notification that
   * is gone, not meant for push, or already read. On a `retry` only the subscriptions whose last
   * attempt failed are tried again.
   */
  deliverNotification: (
    user: string,
    notificationId: string,
    options?: { retry?: boolean },
  ) => Promise<PushDelivery>
}

const NOTHING: PushDelivery = { failed: 0, reached: 0, removed: 0 }

export const createWebPush = (deps: WebPushDeps): WebPush => {
  const enabled = isPushOriginAllowed(deps.webHost)
  const store = deps.store ?? pushSubscriptionStore
  const assertPublic = deps.assertPublic ?? assertPublicUrl
  const getNotification = deps.getNotification ?? getNotificationById
  const logError = deps.logError ?? ((message, error) => console.warn(message, error))
  let sender = deps.send

  const sendTo = async (
    user: string,
    subscription: PushSubscriptionRecord,
    payload: WebPushPayload,
    topic: string | undefined,
  ): Promise<PushOutcome> => {
    try {
      const problem = await pushEndpointProblem(subscription.endpoint, assertPublic)
      if (problem !== null) throw new Error(problem)
      sender ??= createWebPushSender()
      await sender(subscription, JSON.stringify(payload), {
        subject: vapidSubject(deps.webHost),
        topic,
        ttl: PUSH_TTL_SECONDS,
        vapid: await deps.getVapidKeys(),
      })
      await store.recordSuccess(user, subscription.id)
      return 'reached'
    } catch (error) {
      const status = statusCodeOf(error)
      if (status === 403 || status === 404 || status === 410) {
        await store.delete(user, subscription.id)
        return 'removed'
      }
      logError(`⚠️ Web Push to a browser of ${user} failed:`, error)
      const failures = await store.recordFailure(user, subscription.id)
      if (failures !== null && failures >= MAX_PUSH_FAILURES) {
        await store.delete(user, subscription.id)
        return 'removed'
      }
      return 'failed'
    }
  }

  const sendToAll = async (
    user: string,
    subscriptions: PushSubscriptionRecord[],
    payload: WebPushPayload,
    topic: string | undefined,
  ): Promise<PushDelivery> =>
    tally(await Promise.all(subscriptions.map((s) => sendTo(user, s, payload, topic))))

  return {
    config: async () =>
      enabled ? { enabled, public_key: (await deps.getVapidKeys()).public_key } : { enabled },

    deliverNotification: async (user, notificationId, options = {}) => {
      if (!enabled) return NOTHING
      const notification = await getNotification(user, notificationId)
      if (notification == null || !notification.push || notification.read_at != null) return NOTHING
      const all = await store.list(user)
      const subscriptions = options.retry === true ? all.filter((s) => s.failure_count > 0) : all
      if (subscriptions.length === 0) return NOTHING
      const topic = notification.dedupe_key == null ? undefined : pushTopic(notification.dedupe_key)
      return sendToAll(user, subscriptions, pushPayload(notification), topic)
    },

    enabled,

    list: async (user, currentEndpointHash) =>
      (await store.list(user)).map((record) => serializePushSubscription(record, currentEndpointHash)),

    remove: (user, id) => store.delete(user, id),

    sendTest: async (user) => {
      if (!enabled) return null
      const subscriptions = await store.list(user)
      const delivery = await sendToAll(
        user,
        subscriptions,
        {
          body: 'Notifications you choose to push will show here.',
          id: 'test',
          link: '/settings#notifications',
          title: TEST_PUSH_TITLE,
          type: 'test',
        },
        undefined,
      )
      return { reached: delivery.reached, total: subscriptions.length }
    },

    subscribe: async (user, body, userAgent) => {
      if (!enabled) return { status: 'disabled' }
      const problem = await pushEndpointProblem(body.endpoint, assertPublic)
      if (problem !== null) return { message: problem, status: 'invalid_endpoint' }
      const record = await store.upsert(user, {
        auth: body.keys.auth,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        user_agent: userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
      })
      await store.trim(user, record.id, MAX_PUSH_SUBSCRIPTIONS)
      return {
        status: 'ok',
        subscription: serializePushSubscription(record, pushEndpointHash(body.endpoint)),
      }
    },
  }
}
