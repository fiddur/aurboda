import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import {
  countUnreadNotifications,
  getNotificationById,
  getNotificationPreference,
  insertNotification,
  listNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationInsert,
  pruneNotifications,
  reviseNotification,
  upsertNotificationPreference,
} from './notifications.ts'

const CONTAINER_TIMEOUT = 120_000

const base: NotificationInsert = { in_app: true, push: true, title: 'Hello', type: 'admin_signup' }

const insertAt = async (user: string, createdAt: string, input: Partial<NotificationInsert> = {}) => {
  const row = await insertNotification(user, { ...base, ...input })
  await query(user, 'UPDATE notifications SET created_at = $1 WHERE id = $2', [createdAt, row!.id])
  return row!.id
}

describe('Notifications Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('insertNotification', () => {
    test('stores every field and returns the row', async () => {
      const user = getTestUser()
      const row = await insertNotification(user, {
        body: 'alice created an account.',
        data: { username: 'alice' },
        dedupe_key: 'admin_signup:alice',
        in_app: true,
        link: '/admin/users/alice',
        push: false,
        title: 'New signup: alice',
        type: 'admin_signup',
      })

      expect(row).toMatchObject({
        body: 'alice created an account.',
        data: { username: 'alice' },
        dedupe_key: 'admin_signup:alice',
        in_app: true,
        link: '/admin/users/alice',
        push: false,
        read_at: null,
        title: 'New signup: alice',
        type: 'admin_signup',
      })
      expect(row!.created_at).toBeInstanceOf(Date)
    })

    test('returns null for a dedupe key already used, keeping the first row', async () => {
      const user = getTestUser()
      const first = await insertNotification(user, { ...base, dedupe_key: 'k', title: 'first' })
      const second = await insertNotification(user, { ...base, dedupe_key: 'k', title: 'second' })

      expect(first).not.toBeNull()
      expect(second).toBeNull()
      const rows = await listNotifications(user, { limit: 10 })
      expect(rows.map((r) => r.title)).toEqual(['first'])
    })

    test('stores actions, defaulting to none', async () => {
      const user = getTestUser()
      const withActions = await insertNotification(user, {
        ...base,
        actions: [{ key: 'skip', label: "Don't share" }],
      })
      const without = await insertNotification(user, base)

      expect(withActions!.actions).toEqual([{ key: 'skip', label: "Don't share" }])
      expect(without!.actions).toEqual([])
    })

    test('allows any number of rows without a dedupe key', async () => {
      const user = getTestUser()
      await insertNotification(user, base)
      await insertNotification(user, base)
      expect(await listNotifications(user, { limit: 10 })).toHaveLength(2)
    })
  })

  describe('listNotifications', () => {
    test('lists in-app rows newest first and pages with a keyset cursor', async () => {
      const user = getTestUser()
      await insertAt(user, '2026-01-01T10:00:00Z', { title: 'a' })
      await insertAt(user, '2026-01-02T10:00:00Z', { title: 'b' })
      await insertAt(user, '2026-01-03T10:00:00Z', { title: 'c' })
      await insertAt(user, '2026-01-04T10:00:00Z', { in_app: false, title: 'push only' })

      const first = await listNotifications(user, { limit: 2 })
      expect(first.map((r) => r.title)).toEqual(['c', 'b'])

      const last = first[1]!
      const second = await listNotifications(user, {
        before: { created_at: last.cursor_ts, id: last.id },
        limit: 2,
      })
      expect(second.map((r) => r.title)).toEqual(['a'])
    })

    test('push_only lists push rows whatever their in-app switch', async () => {
      const user = getTestUser()
      await insertAt(user, '2026-01-01T10:00:00Z', { in_app: false, push: true, title: 'push only' })
      await insertAt(user, '2026-01-02T10:00:00Z', { in_app: true, push: false, title: 'in-app only' })
      await insertAt(user, '2026-01-03T10:00:00Z', { title: 'both' })

      const rows = await listNotifications(user, { limit: 10, push_only: true })
      expect(rows.map((r) => r.title)).toEqual(['both', 'push only'])
    })

    test('unread_only and after narrow the list', async () => {
      const user = getTestUser()
      const readId = await insertAt(user, '2026-01-03T10:00:00Z', { title: 'read' })
      await insertAt(user, '2026-01-02T10:00:00Z', { title: 'old unread' })
      await insertAt(user, '2026-01-04T10:00:00Z', { title: 'new unread' })
      await markNotificationRead(user, readId)

      const unread = await listNotifications(user, { limit: 10, unread_only: true })
      expect(unread.map((r) => r.title)).toEqual(['new unread', 'old unread'])

      const after = await listNotifications(user, {
        after: new Date('2026-01-02T10:00:00Z'),
        limit: 10,
        unread_only: true,
      })
      expect(after.map((r) => r.title)).toEqual(['new unread'])
    })

    test('after is not passed by the microseconds its own row lost on the wire', async () => {
      const user = getTestUser()
      await insertAt(user, '2026-01-02T10:00:00.123456Z', { title: 'seen' })
      await insertAt(user, '2026-01-02T10:00:00.124Z', { title: 'next' })

      const rows = await listNotifications(user, { after: new Date('2026-01-02T10:00:00.123Z'), limit: 10 })
      expect(rows.map((r) => r.title)).toEqual(['next'])
    })
  })

  describe('read state', () => {
    test('countUnreadNotifications counts unread in-app rows only', async () => {
      const user = getTestUser()
      await insertNotification(user, base)
      await insertNotification(user, { ...base, in_app: false })
      const readable = await insertNotification(user, base)
      await markNotificationRead(user, readable!.id)

      expect(await countUnreadNotifications(user)).toBe(1)
    })

    test('markNotificationRead sets read_at once and returns null for an unknown id', async () => {
      const user = getTestUser()
      const row = await insertNotification(user, base)

      const read = await markNotificationRead(user, row!.id)
      expect(read!.read_at).toBeInstanceOf(Date)

      const again = await markNotificationRead(user, row!.id)
      expect(again!.read_at!.getTime()).toBe(read!.read_at!.getTime())

      expect(await markNotificationRead(user, '00000000-0000-4000-8000-000000000000')).toBeNull()
    })

    test('markAllNotificationsRead marks every unread row and returns the count', async () => {
      const user = getTestUser()
      await insertNotification(user, base)
      await insertNotification(user, base)
      const already = await insertNotification(user, base)
      await markNotificationRead(user, already!.id)

      expect(await markAllNotificationsRead(user)).toBe(2)
      expect(await countUnreadNotifications(user)).toBe(0)
    })
  })

  describe('getNotificationById', () => {
    test('returns the row, or null for an unknown id', async () => {
      const user = getTestUser()
      const row = await insertNotification(user, { ...base, title: 'Hi' })

      expect(await getNotificationById(user, row!.id)).toMatchObject({ id: row!.id, title: 'Hi' })
      expect(await getNotificationById(user, '00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  describe('reviseNotification', () => {
    test('by dedupe key: updates only the given fields and keeps created_at and read state', async () => {
      const user = getTestUser()
      const row = await insertNotification(user, {
        ...base,
        actions: [{ key: 'skip', label: 'Skip' }],
        body: 'old body',
        data: { a: 1 },
        dedupe_key: 'k1',
        link: '/old',
        title: 'Old',
      })

      const revised = await reviseNotification(user, { dedupe_key: 'k1' }, { link: '/new', title: 'New' })

      expect(revised).toMatchObject({
        actions: [{ key: 'skip', label: 'Skip' }],
        body: 'old body',
        data: { a: 1 },
        link: '/new',
        read_at: null,
        title: 'New',
      })
      expect(revised!.created_at).toEqual(row!.created_at)
    })

    test('by id: clears actions, nulls fields, marks read and keeps the first read_at', async () => {
      const user = getTestUser()
      const row = await insertNotification(user, {
        ...base,
        actions: [{ key: 'skip', label: 'Skip' }],
        body: 'b',
        data: { a: 1 },
      })

      const revised = await reviseNotification(
        user,
        { id: row!.id },
        { actions: [], body: null, data: null, mark_read: true },
      )
      expect(revised).toMatchObject({ actions: [], body: null, data: null })
      expect(revised!.read_at).toBeInstanceOf(Date)

      const again = await reviseNotification(user, { id: row!.id }, { mark_read: true })
      expect(again!.read_at).toEqual(revised!.read_at)
    })

    test('an empty patch returns the row unchanged', async () => {
      const user = getTestUser()
      const row = await insertNotification(user, { ...base, dedupe_key: 'k2' })
      expect(await reviseNotification(user, { dedupe_key: 'k2' }, {})).toMatchObject({ id: row!.id })
    })

    test('returns null when nothing matched', async () => {
      const user = getTestUser()
      expect(await reviseNotification(user, { dedupe_key: 'missing' }, { title: 'x' })).toBeNull()
      expect(
        await reviseNotification(user, { id: '00000000-0000-0000-0000-000000000000' }, { title: 'x' }),
      ).toBeNull()
    })
  })

  describe('pruneNotifications', () => {
    test('deletes old read rows and anything older than the hard limit', async () => {
      const user = getTestUser()
      const oldRead = await insertAt(user, '2026-01-01T10:00:00Z', { title: 'old read' })
      await markNotificationRead(user, oldRead)
      await insertAt(user, '2026-01-01T10:00:00Z', { title: 'old unread' })
      await insertAt(user, '2025-01-01T10:00:00Z', { title: 'ancient unread' })
      const recentRead = await insertAt(user, '2026-06-01T10:00:00Z', { title: 'recent read' })
      await markNotificationRead(user, recentRead)

      const deleted = await pruneNotifications(
        user,
        new Date('2026-03-01T00:00:00Z'),
        new Date('2025-06-01T00:00:00Z'),
      )

      expect(deleted).toBe(2)
      const rows = await listNotifications(user, { limit: 10 })
      expect(rows.map((r) => r.title).sort()).toEqual(['old unread', 'recent read'])
    })
  })

  describe('preferences', () => {
    test('a type without a row has no preference', async () => {
      expect(await getNotificationPreference(getTestUser(), 'admin_signup')).toBeNull()
      expect(await listNotificationPreferences(getTestUser())).toEqual([])
    })

    test('upsert defaults a missing side to on and later keeps its stored value', async () => {
      const user = getTestUser()
      const created = await upsertNotificationPreference(user, 'admin_signup', { push: false })
      expect(created).toMatchObject({ in_app: true, push: false, type: 'admin_signup' })

      const updated = await upsertNotificationPreference(user, 'admin_signup', { in_app: false })
      expect(updated).toMatchObject({ in_app: false, push: false })

      expect(await getNotificationPreference(user, 'admin_signup')).toMatchObject({
        in_app: false,
        push: false,
      })
      expect((await listNotificationPreferences(user)).map((p) => p.type)).toEqual(['admin_signup'])
    })
  })
})
