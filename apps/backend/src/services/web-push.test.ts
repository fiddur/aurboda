import { addPushSubscriptionBodySchema, sendTestPushResponseSchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import type { NotificationRecord, PushSubscriptionRecord } from '../db/index.ts'

import {
  browserLabel,
  createWebPush,
  isPushOriginAllowed,
  MAX_PUSH_FAILURES,
  MAX_PUSH_SUBSCRIPTIONS,
  type PushSender,
  type PushSendOptions,
  pushEndpointProblem,
  type PushSubscriptionStore,
  pushTopic,
  pushEndpointHash,
  serializePushSubscription,
  TEST_PUSH_TITLE,
  USER_AGENT_MAX_LENGTH,
  vapidSubject,
  type WebPushDeps,
} from './web-push.ts'

const ENDPOINT = 'https://push.example/send/abc'
const VAPID = { private_key: 'private', public_key: 'public' }
const NOTIFICATION_ID = '11111111-1111-4111-8111-111111111111'

const subscription = (
  id: string,
  overrides: Partial<PushSubscriptionRecord> = {},
): PushSubscriptionRecord => ({
  auth: 'auth',
  created_at: new Date('2026-11-01T10:00:00Z'),
  endpoint: `${ENDPOINT}/${id}`,
  failure_count: 0,
  id,
  last_success_at: null,
  p256dh: 'p256dh',
  user_agent: null,
  ...overrides,
})

const notification = (overrides: Partial<NotificationRecord> = {}): NotificationRecord => ({
  actions: [],
  body: 'Time to stretch',
  created_at: new Date('2026-11-20T10:00:00Z'),
  data: null,
  dedupe_key: 'reminder:r1:2026-11-20',
  id: NOTIFICATION_ID,
  in_app: true,
  link: '/reminders',
  push: true,
  read_at: null,
  title: 'Stretch',
  type: 'reminder',
  ...overrides,
})

const fakeStore = (initial: PushSubscriptionRecord[] = []) => {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]))
  const calls: string[] = []
  const store: PushSubscriptionStore = {
    delete: async (_user, id) => {
      calls.push(`delete ${id}`)
      return rows.delete(id)
    },
    list: async () => [...rows.values()],
    recordFailure: async (_user, id) => {
      const row = rows.get(id)
      if (!row) return null
      row.failure_count += 1
      calls.push(`failure ${id}`)
      return row.failure_count
    },
    recordSuccess: async (_user, id) => {
      const row = rows.get(id)
      if (row) row.failure_count = 0
      calls.push(`success ${id}`)
    },
    trim: async (_user, keepId, max) => {
      calls.push(`trim ${keepId} ${max}`)
      return 0
    },
    upsert: async (_user, input) => {
      const row = subscription('new', { ...input, endpoint: input.endpoint })
      rows.set(row.id, row)
      return row
    },
  }
  return { calls, rows, store }
}

const statusError = (statusCode: number) => Object.assign(new Error(`status ${statusCode}`), { statusCode })

const setup = (
  overrides: Partial<WebPushDeps> = {},
  rows: PushSubscriptionRecord[] = [],
  answer: (endpoint: string) => Promise<void> = async () => {},
) => {
  const sent: { endpoint: string; payload: unknown; options: PushSendOptions }[] = []
  const send: PushSender = async (sub, payload, options) => {
    sent.push({ endpoint: sub.endpoint, options, payload: JSON.parse(payload) })
    await answer(sub.endpoint)
  }
  const fake = fakeStore(rows)
  const webPush = createWebPush({
    assertPublic: async () => {},
    getNotification: async () => notification(),
    getVapidKeys: async () => VAPID,
    logError: () => {},
    send,
    store: fake.store,
    webHost: 'https://aurboda.example',
    ...overrides,
  })
  return { ...fake, sent, webPush }
}

describe('isPushOriginAllowed', () => {
  test.each([
    ['https://aurboda.example', true],
    ['http://localhost:5173', true],
    ['http://127.0.0.1:5173', true],
    ['http://app.localhost', true],
    ['http://aurboda.example', false],
    ['http://192.168.1.2', false],
    ['not a url', false],
  ])('%s → %s', (host, allowed) => expect(isPushOriginAllowed(host)).toBe(allowed))
})

describe('vapidSubject', () => {
  test('is the web origin, as https', () => {
    expect(vapidSubject('https://aurboda.example/')).toBe('https://aurboda.example')
    expect(vapidSubject('http://localhost:5471')).toBe('https://localhost:5471')
  })
})

describe('pushTopic', () => {
  test('is stable, URL-safe and at most 32 characters', () => {
    const topic = pushTopic('autoshare_pending:abc')
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(pushTopic('autoshare_pending:abc')).toBe(topic)
    expect(pushTopic('autoshare_pending:abd')).not.toBe(topic)
  })
})

describe('browserLabel', () => {
  test.each([
    ['Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0', 'Firefox on Android'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Chrome on Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Safari on macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Chrome on Linux',
    ],
    ['curl/8.0', 'Browser'],
    ['', 'Browser'],
    [null, 'Browser'],
  ])('%s → %s', (userAgent, label) => expect(browserLabel(userAgent)).toBe(label))
})

describe('pushEndpointProblem', () => {
  test('accepts a public https endpoint', async () => {
    expect(await pushEndpointProblem(ENDPOINT, async () => {})).toBeNull()
  })

  test('refuses plain http and a non-URL', async () => {
    expect(await pushEndpointProblem('http://push.example/x', async () => {})).toMatch(/HTTPS/)
    expect(await pushEndpointProblem('nope', async () => {})).toMatch(/HTTPS/)
  })

  test('refuses what the outbound check refuses', async () => {
    const problem = await pushEndpointProblem('https://10.0.0.1/x', async () => {
      throw new Error('private address')
    })
    expect(problem).toMatch(/public address: private address/)
  })
})

describe('serializePushSubscription', () => {
  test('never includes the keys, and marks the endpoint whose hash is named current', () => {
    const record = subscription('s1', {
      last_success_at: new Date('2026-11-02T10:00:00Z'),
      user_agent: 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0',
    })
    expect(serializePushSubscription(record, pushEndpointHash(record.endpoint))).toEqual({
      browser: 'Firefox on Android',
      created_at: '2026-11-01T10:00:00.000Z',
      current: true,
      id: 's1',
      last_success_at: '2026-11-02T10:00:00.000Z',
    })
    expect(serializePushSubscription(record).current).toBe(false)
    expect(serializePushSubscription(record, pushEndpointHash('https://push.example/other')).current).toBe(
      false,
    )
  })
})

describe('createWebPush().config', () => {
  test('answers the public key when enabled', async () => {
    expect(await setup().webPush.config()).toEqual({ enabled: true, public_key: 'public' })
  })

  test('is disabled without the key on a plain http host', async () => {
    let asked = false
    const { webPush } = setup({
      getVapidKeys: async () => {
        asked = true
        return VAPID
      },
      webHost: 'http://aurboda.example',
    })
    expect(await webPush.config()).toEqual({ enabled: false })
    expect(asked).toBe(false)
  })
})

describe('createWebPush().subscribe', () => {
  const body = { endpoint: ENDPOINT, keys: { auth: 'a', p256dh: 'p' } }

  test('stores the subscription with a truncated user agent and trims to the cap', async () => {
    const { webPush, rows, calls } = setup()
    const outcome = await webPush.subscribe('alice', body, 'x'.repeat(500))
    expect(outcome).toMatchObject({ status: 'ok', subscription: { current: true, id: 'new' } })
    expect(rows.get('new')?.user_agent).toHaveLength(USER_AGENT_MAX_LENGTH)
    expect(calls).toEqual([`trim new ${MAX_PUSH_SUBSCRIPTIONS}`])
  })

  test('refuses an endpoint that fails the outbound check', async () => {
    const { webPush, rows } = setup({
      assertPublic: async () => {
        throw new Error('private address')
      },
    })
    expect(await webPush.subscribe('alice', body)).toMatchObject({ status: 'invalid_endpoint' })
    expect(rows.size).toBe(0)
  })

  test('refuses everything when push is off', async () => {
    const { webPush } = setup({ webHost: 'http://aurboda.example' })
    expect(await webPush.subscribe('alice', body)).toEqual({ status: 'disabled' })
  })
})

describe('createWebPush().deliverNotification', () => {
  test('sends the payload with a day TTL and a topic from the dedupe key, and records the success', async () => {
    const { webPush, sent, calls } = setup({}, [subscription('s1', { failure_count: 3 })])
    expect(await webPush.deliverNotification('alice', NOTIFICATION_ID)).toEqual({
      failed: 0,
      reached: 1,
      removed: 0,
    })
    expect(sent).toEqual([
      {
        endpoint: `${ENDPOINT}/s1`,
        options: {
          subject: 'https://aurboda.example',
          topic: pushTopic('reminder:r1:2026-11-20'),
          ttl: 86_400,
          vapid: VAPID,
        },
        payload: {
          body: 'Time to stretch',
          id: NOTIFICATION_ID,
          link: '/reminders',
          title: 'Stretch',
          type: 'reminder',
        },
      },
    ])
    expect(calls).toEqual(['success s1'])
  })

  test('omits the topic without a dedupe key', async () => {
    const { webPush, sent } = setup({ getNotification: async () => notification({ dedupe_key: null }) }, [
      subscription('s1'),
    ])
    await webPush.deliverNotification('alice', NOTIFICATION_ID)
    expect(sent[0]?.options.topic).toBeUndefined()
  })

  test.each([403, 404, 410])('a %s deletes the subscription', async (status) => {
    const { webPush, rows } = setup({}, [subscription('s1')], async () => {
      throw statusError(status)
    })
    expect(await webPush.deliverNotification('alice', NOTIFICATION_ID)).toEqual({
      failed: 0,
      reached: 0,
      removed: 1,
    })
    expect(rows.size).toBe(0)
  })

  test('another failure counts, and the subscription goes at the limit', async () => {
    const { webPush, rows } = setup(
      {},
      [subscription('s1'), subscription('s2', { failure_count: MAX_PUSH_FAILURES - 1 })],
      async () => {
        throw statusError(500)
      },
    )
    expect(await webPush.deliverNotification('alice', NOTIFICATION_ID)).toEqual({
      failed: 1,
      reached: 0,
      removed: 1,
    })
    expect(rows.get('s1')?.failure_count).toBe(1)
    expect(rows.has('s2')).toBe(false)
  })

  test('an endpoint that no longer passes the outbound check is not sent to', async () => {
    const { webPush, sent, rows } = setup(
      {
        assertPublic: async () => {
          throw new Error('private address')
        },
      },
      [subscription('s1')],
    )
    expect((await webPush.deliverNotification('alice', NOTIFICATION_ID)).failed).toBe(1)
    expect(sent).toEqual([])
    expect(rows.get('s1')?.failure_count).toBe(1)
  })

  test('a retry only tries the subscriptions whose last attempt failed', async () => {
    const { webPush, sent } = setup({}, [subscription('ok'), subscription('bad', { failure_count: 1 })])
    await webPush.deliverNotification('alice', NOTIFICATION_ID, { retry: true })
    expect(sent.map((s) => s.endpoint)).toEqual([`${ENDPOINT}/bad`])
  })

  test.each([
    ['gone', null],
    ['not for push', notification({ push: false })],
    ['already read', notification({ read_at: new Date() })],
  ])('sends nothing for a notification that is %s', async (_label, row) => {
    const { webPush, sent } = setup({ getNotification: async () => row }, [subscription('s1')])
    expect(await webPush.deliverNotification('alice', NOTIFICATION_ID)).toEqual({
      failed: 0,
      reached: 0,
      removed: 0,
    })
    expect(sent).toEqual([])
  })

  test('sends nothing when push is off', async () => {
    const { webPush, sent } = setup({ webHost: 'http://aurboda.example' }, [subscription('s1')])
    await webPush.deliverNotification('alice', NOTIFICATION_ID)
    expect(sent).toEqual([])
  })
})

describe('createWebPush().sendTest', () => {
  test('sends the test message to every browser and counts those reached', async () => {
    const { webPush, sent } = setup({}, [subscription('s1'), subscription('s2')], async (endpoint) => {
      if (endpoint.endsWith('s2')) throw statusError(500)
    })
    expect(await webPush.sendTest('alice')).toEqual({ reached: 1, total: 2 })
    expect(sent[0]?.payload).toMatchObject({ title: TEST_PUSH_TITLE, type: 'test' })
    expect(sent[0]?.options.topic).toBeUndefined()
  })

  test('is null when push is off', async () => {
    expect(await setup({ webHost: 'http://aurboda.example' }).webPush.sendTest('alice')).toBeNull()
  })
})

describe('push schemas', () => {
  test('a browser PushSubscription JSON parses, its extra fields dropped', () => {
    const parsed = addPushSubscriptionBodySchema.parse({
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { auth: 'a', p256dh: 'p' },
    })
    expect(parsed).toEqual({ endpoint: ENDPOINT, keys: { auth: 'a', p256dh: 'p' } })
  })

  test('a subscription without keys or with a non-URL endpoint is refused', () => {
    expect(addPushSubscriptionBodySchema.safeParse({ endpoint: ENDPOINT }).success).toBe(false)
    expect(
      addPushSubscriptionBodySchema.safeParse({ endpoint: 'nope', keys: { auth: 'a', p256dh: 'p' } }).success,
    ).toBe(false)
    expect(
      addPushSubscriptionBodySchema.safeParse({ endpoint: ENDPOINT, keys: { auth: '', p256dh: 'p' } })
        .success,
    ).toBe(false)
  })

  test('the test answer carries the counts', () => {
    expect(sendTestPushResponseSchema.parse({ reached: 1, success: true, total: 2 })).toEqual({
      reached: 1,
      success: true,
      total: 2,
    })
  })
})
