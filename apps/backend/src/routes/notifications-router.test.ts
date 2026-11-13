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

const app = (store: NotificationStore, admin = true, runAction: RunNotificationAction = noAction) => {
  const server = express()
  server.use(express.json())
  server.use(
    '/notifications',
    createNotificationsRouter(auth, { isAdmin: async () => admin, runAction, store }),
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
    expect(upserts).toEqual([['admin_signup', { push: false }]])
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
