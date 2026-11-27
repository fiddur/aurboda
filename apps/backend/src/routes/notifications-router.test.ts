import type { RequestHandler } from 'express'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type {
  ListNotificationsOptions,
  NotificationPageRow,
  NotificationPreferenceRecord,
} from '../db/index.ts'
import type { RunNotificationAction } from '../services/notification-actions.ts'
import type { NotificationStore } from '../services/notifications.ts'
import type { WebPush } from '../services/web-push.ts'

import { encodeKeysetCursor } from '../services/keyset-cursor.ts'
import { createNotificationsRouter } from './notifications-router.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

const auth: RequestHandler = (req, _res, next) => {
  req.user = 'tester'
  next()
}

const row = (id: string, cursorTs: string): NotificationPageRow => ({
  actions: [],
  body: null,
  created_at: new Date('2026-11-01T10:00:00Z'),
  cursor_ts: cursorTs,
  data: { username: 'bob' },
  dedupe_key: null,
  id,
  in_app: true,
  link: '/admin/users/bob',
  push: true,
  read_at: null,
  title: 'New signup: bob',
  type: 'admin_signup',
})

const fakeStore = (overrides: Partial<NotificationStore> = {}) => {
  const listCalls: ListNotificationsOptions[] = []
  const upserts: [string, unknown][] = []
  const store: NotificationStore = {
    countUnread: async () => 3,
    get: async () => null,
    list: async (_user, options) => {
      listCalls.push(options)
      return []
    },
    listPreferences: async () => [],
    markAllRead: async () => 2,
    markRead: async () => null,
    revise: async () => null,
    upsertPreference: async (_user, type, patch) => {
      upserts.push([type, patch])
      return { in_app: patch.in_app ?? true, push: patch.push ?? true, type, updated_at: new Date() }
    },
    ...overrides,
  }
  return { listCalls, store, upserts }
}

const noAction: RunNotificationAction = async () => ({ status: 'not_found' })

const SUBSCRIPTION = {
  browser: 'Firefox on Android',
  created_at: '2026-11-01T10:00:00.000Z',
  current: true,
  id: ID,
  last_success_at: null,
}

const fakeWebPush = (overrides: Partial<WebPush> = {}) => {
  const calls: unknown[][] = []
  const webPush: WebPush = {
    config: async () => ({ enabled: true, public_key: 'pub' }),
    deliverNotification: async () => ({ failed: 0, reached: 0, removed: 0 }),
    enabled: true,
    list: async (user, endpoint) => {
      calls.push(['list', user, endpoint])
      return [SUBSCRIPTION]
    },
    remove: async (user, id) => {
      calls.push(['remove', user, id])
      return id === ID
    },
    sendTest: async (user) => {
      calls.push(['sendTest', user])
      return { reached: 1, total: 2 }
    },
    subscribe: async (user, body, userAgent) => {
      calls.push(['subscribe', user, body, userAgent])
      return { status: 'ok', subscription: SUBSCRIPTION }
    },
    ...overrides,
  }
  return { calls, webPush }
}

const app = (
  store: NotificationStore,
  admin = true,
  runAction: RunNotificationAction = noAction,
  webPush: WebPush = fakeWebPush().webPush,
) => {
  const server = express()
  server.use(express.json())
  server.use(
    '/notifications',
    createNotificationsRouter(auth, { isAdmin: async () => admin, runAction, store, webPush }),
  )
  return server
}

describe('GET /notifications', () => {
  test('returns a page, the unread count and a cursor when there are more', async () => {
    const { store, listCalls } = fakeStore({
      list: async (_user, options) => {
        listCalls.push(options)
        return [row(ID, '2026-11-01 10:00:00.5+00'), row(ID2, '2026-11-01 09:00:00+00')]
      },
    })

    const res = await supertest(app(store)).get('/notifications').query({ limit: 1 })

    expect(res.status).toBe(200)
    expect(res.body.unread_count).toBe(3)
    expect(res.body.notifications).toEqual([
      expect.objectContaining({ created_at: '2026-11-01T10:00:00.000Z', id: ID, read_at: null }),
    ])
    expect(res.body.next_cursor).toBe(encodeKeysetCursor('2026-11-01 10:00:00.5+00', ID))
    expect(listCalls[0]).toMatchObject({ limit: 2 })
  })

  test('passes the filters and decodes the cursor', async () => {
    const { store, listCalls } = fakeStore()
    const cursor = encodeKeysetCursor('2026-11-01 10:00:00+00', ID)

    const res = await supertest(app(store)).get('/notifications').query({
      after: '2026-10-01T00:00:00Z',
      cursor,
      push_only: 'true',
      unread_only: 'true',
    })

    expect(res.status).toBe(200)
    expect(res.body.next_cursor).toBeNull()
    expect(listCalls[0]).toEqual({
      after: new Date('2026-10-01T00:00:00Z'),
      before: { created_at: '2026-11-01 10:00:00+00', id: ID },
      limit: 21,
      push_only: true,
      unread_only: true,
    })
  })

  test('passes ids split on commas', async () => {
    const { store, listCalls } = fakeStore()
    const other = '00000000-0000-4000-8000-000000000002'

    const res = await supertest(app(store))
      .get('/notifications')
      .query({ ids: `${ID},${other}`, push_only: 'true' })

    expect(res.status).toBe(200)
    expect(listCalls[0]).toMatchObject({ ids: [ID, other], push_only: true })
  })

  test('rejects ids that are not UUIDs', async () => {
    const res = await supertest(app(fakeStore().store))
      .get('/notifications')
      .query({ ids: `${ID},nope` })
    expect(res.status).toBe(400)
  })

  test('rejects more than 100 ids', async () => {
    const ids = Array.from({ length: 101 }, () => ID).join(',')
    const res = await supertest(app(fakeStore().store)).get('/notifications').query({ ids })
    expect(res.status).toBe(400)
  })

  test('rejects a limit out of range', async () => {
    const res = await supertest(app(fakeStore().store)).get('/notifications').query({ limit: 500 })
    expect(res.status).toBe(400)
  })
})

describe('GET /notifications/types', () => {
  test('lists admin-only types for an admin with stored switches', async () => {
    const prefs: NotificationPreferenceRecord[] = [
      { in_app: true, push: false, type: 'admin_signup', updated_at: new Date() },
    ]
    const { store } = fakeStore({ listPreferences: async () => prefs })

    const res = await supertest(app(store)).get('/notifications/types')

    expect(res.status).toBe(200)
    expect(res.body.types).toContainEqual(
      expect.objectContaining({ admin_only: true, in_app: true, push: false, type: 'admin_signup' }),
    )
  })

  test('hides admin-only types from a non-admin', async () => {
    const res = await supertest(app(fakeStore().store, false)).get('/notifications/types')
    const types = (res.body.types as { type: string }[]).map((setting) => setting.type)
    expect(types).not.toContain('admin_signup')
    expect(types).toContain('feed_like')
  })
})

describe('PUT /notifications/types/:type', () => {
  test('stores the switch and returns the type setting', async () => {
    const { store, upserts } = fakeStore()

    const res = await supertest(app(store)).put('/notifications/types/admin_signup').send({ push: false })

    expect(res.status).toBe(200)
    expect(res.body.type_setting).toMatchObject({ in_app: true, push: false, type: 'admin_signup' })
    expect(upserts).toEqual([['admin_signup', { in_app: true, push: false }]])
  })

  test('404s for an unknown type and for an admin-only type for a non-admin', async () => {
    const { store, upserts } = fakeStore()
    expect((await supertest(app(store)).put('/notifications/types/nope').send({ push: false })).status).toBe(
      404,
    )
    expect(
      (await supertest(app(store, false)).put('/notifications/types/admin_signup').send({ push: false }))
        .status,
    ).toBe(404)
    expect(upserts).toEqual([])
  })

  test('400s without either switch', async () => {
    const res = await supertest(app(fakeStore().store)).put('/notifications/types/admin_signup').send({})
    expect(res.status).toBe(400)
  })
})

describe('POST /notifications/read-all', () => {
  test('returns how many were marked', async () => {
    const res = await supertest(app(fakeStore().store)).post('/notifications/read-all')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, updated: 2 })
  })
})

describe('POST /notifications/:id/read', () => {
  test('returns the marked notification', async () => {
    const readAt = new Date('2026-11-02T10:00:00Z')
    const { store } = fakeStore({ markRead: async (_user, id) => ({ ...row(id, ''), read_at: readAt }) })

    const res = await supertest(app(store)).post(`/notifications/${ID}/read`)

    expect(res.status).toBe(200)
    expect(res.body.notification).toMatchObject({ id: ID, read_at: '2026-11-02T10:00:00.000Z' })
    expect(res.body.notification).not.toHaveProperty('cursor_ts')
  })

  test('404s for a missing row and for an id that is not a uuid', async () => {
    const { store } = fakeStore()
    expect((await supertest(app(store)).post(`/notifications/${ID}/read`)).status).toBe(404)
    expect((await supertest(app(store)).post('/notifications/not-a-uuid/read')).status).toBe(404)
  })
})

describe('POST /notifications/:id/actions/:key', () => {
  test('runs the action and returns the revised notification', async () => {
    const calls: [string, string, string][] = []
    const res = await supertest(
      app(fakeStore().store, true, async (user, id, key) => {
        calls.push([user, id, key])
        return {
          notification: { ...row(id, ''), actions: [], title: 'Your run will not be shared' },
          status: 'ok',
        }
      }),
    ).post(`/notifications/${ID}/actions/skip`)

    expect(res.status).toBe(200)
    expect(res.body.notification).toMatchObject({ actions: [], id: ID, title: 'Your run will not be shared' })
    expect(calls).toEqual([['tester', ID, 'skip']])
  })

  test('404s when there is no such action', async () => {
    const res = await supertest(app(fakeStore().store)).post(`/notifications/${ID}/actions/skip`)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Notification action not found', success: false })
  })

  test('409s with the handler message', async () => {
    const res = await supertest(
      app(fakeStore().store, true, async () => ({
        message: 'This activity was already shared',
        status: 'conflict',
      })),
    ).post(`/notifications/${ID}/actions/skip`)
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'This activity was already shared', success: false })
  })
})

describe('browser push routes', () => {
  const pushApp = (webPush: WebPush) => app(fakeStore().store, true, noAction, webPush)
  const ENDPOINT = 'https://push.example/send/abc'
  const body = { endpoint: ENDPOINT, expirationTime: null, keys: { auth: 'a', p256dh: 'p' } }

  test('GET /push/config answers the configuration', async () => {
    const res = await supertest(pushApp(fakeWebPush().webPush)).get('/notifications/push/config')
    expect(res.body).toEqual({ enabled: true, public_key: 'pub', success: true })
  })

  test('GET /push/subscriptions lists, naming the current endpoint by its hash', async () => {
    const { webPush, calls } = fakeWebPush()
    const hash = 'a'.repeat(64)
    const res = await supertest(pushApp(webPush))
      .get('/notifications/push/subscriptions')
      .query({ endpoint_hash: hash })
    expect(res.body).toEqual({ subscriptions: [SUBSCRIPTION], success: true })
    expect(calls).toEqual([['list', 'tester', hash]])
  })

  test('GET /push/subscriptions refuses an endpoint itself in the address', async () => {
    const res = await supertest(pushApp(fakeWebPush().webPush))
      .get('/notifications/push/subscriptions')
      .query({ endpoint_hash: ENDPOINT })
    expect(res.status).toBe(400)
  })

  test('POST /push/subscriptions stores the browser subscription with its user agent', async () => {
    const { webPush, calls } = fakeWebPush()
    const res = await supertest(pushApp(webPush))
      .post('/notifications/push/subscriptions')
      .set('User-Agent', 'Firefox')
      .send(body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ subscription: SUBSCRIPTION, success: true })
    expect(calls).toEqual([
      ['subscribe', 'tester', { endpoint: ENDPOINT, keys: { auth: 'a', p256dh: 'p' } }, 'Firefox'],
    ])
  })

  test('POST /push/subscriptions refuses an invalid body, a bad endpoint and a disabled server', async () => {
    const invalid = await supertest(pushApp(fakeWebPush().webPush))
      .post('/notifications/push/subscriptions')
      .send({ endpoint: ENDPOINT })
    expect(invalid.status).toBe(400)

    const bad = fakeWebPush({
      subscribe: async () => ({ message: 'not public', status: 'invalid_endpoint' }),
    })
    const badRes = await supertest(pushApp(bad.webPush)).post('/notifications/push/subscriptions').send(body)
    expect(badRes.status).toBe(400)
    expect(badRes.body).toEqual({ error: 'not public', success: false })

    const off = fakeWebPush({ subscribe: async () => ({ status: 'disabled' }) })
    expect(
      (await supertest(pushApp(off.webPush)).post('/notifications/push/subscriptions').send(body)).status,
    ).toBe(409)
  })

  test('DELETE /push/subscriptions/:id removes one, 404 when there is none', async () => {
    const { webPush } = fakeWebPush()
    expect(
      (await supertest(pushApp(webPush)).delete(`/notifications/push/subscriptions/${ID}`)).body,
    ).toEqual({
      success: true,
    })
    expect(
      (await supertest(pushApp(webPush)).delete(`/notifications/push/subscriptions/${ID2}`)).status,
    ).toBe(404)
    expect((await supertest(pushApp(webPush)).delete('/notifications/push/subscriptions/nope')).status).toBe(
      404,
    )
  })

  test('POST /push/test answers how many browsers were reached, 409 when push is off', async () => {
    const res = await supertest(pushApp(fakeWebPush().webPush)).post('/notifications/push/test')
    expect(res.body).toEqual({ reached: 1, success: true, total: 2 })

    const off = fakeWebPush({ sendTest: async () => null })
    expect((await supertest(pushApp(off.webPush)).post('/notifications/push/test')).status).toBe(409)
  })
})
