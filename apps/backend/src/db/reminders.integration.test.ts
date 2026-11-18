import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getNotificationById, insertNotification, markReminderNotificationsRead } from './notifications.ts'
import { deleteReminder, getReminder, insertReminder, listReminders, updateReminder } from './reminders.ts'

const CONTAINER_TIMEOUT = 120_000
const MISSING = '99999999-9999-4999-8999-999999999999'
const NOT_BEFORE = new Date('2026-11-18T10:00:00Z')

describe('Reminders Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('insertReminder stores every field with weekdays sorted and unique', async () => {
    const user = getTestUser()
    const row = await insertReminder(user, {
      body: 'Fill it in',
      enabled: true,
      link: '/reports',
      not_before: NOT_BEFORE,
      time_of_day: '20:00',
      title: 'Evening questionnaire',
      weekdays: [5, 1, 3, 1],
    })
    expect(row).toMatchObject({
      body: 'Fill it in',
      enabled: true,
      link: '/reports',
      not_before: NOT_BEFORE,
      time_of_day: '20:00',
      title: 'Evening questionnaire',
      weekdays: [1, 3, 5],
    })
    expect(row.created_at).toBeInstanceOf(Date)
    expect(await getReminder(user, row.id)).toEqual(row)
  })

  test('listReminders orders by time of day', async () => {
    const user = getTestUser()
    const base = { enabled: true, not_before: NOT_BEFORE, weekdays: [1] }
    await insertReminder(user, { ...base, time_of_day: '20:00', title: 'Late' })
    await insertReminder(user, { ...base, time_of_day: '07:30', title: 'Early' })
    expect((await listReminders(user)).map((r) => r.title)).toEqual(['Early', 'Late'])
  })

  test('updateReminder changes only the given fields and clears with null', async () => {
    const user = getTestUser()
    const row = await insertReminder(user, {
      body: 'Text',
      enabled: true,
      link: '/reports',
      not_before: NOT_BEFORE,
      time_of_day: '20:00',
      title: 'Evening',
      weekdays: [1, 2],
    })
    const later = new Date('2026-11-19T10:00:00Z')
    const updated = await updateReminder(user, row.id, {
      body: null,
      link: null,
      not_before: later,
      weekdays: [7, 6],
    })
    expect(updated).toMatchObject({
      body: null,
      enabled: true,
      link: null,
      not_before: later,
      time_of_day: '20:00',
      title: 'Evening',
      weekdays: [6, 7],
    })
    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(row.updated_at.getTime())
    expect(await updateReminder(user, MISSING, { title: 'x' })).toBeNull()
  })

  test('deleteReminder says whether a row went', async () => {
    const user = getTestUser()
    const row = await insertReminder(user, {
      enabled: true,
      not_before: NOT_BEFORE,
      time_of_day: '08:00',
      title: 'Morning',
      weekdays: [1],
    })
    expect(await deleteReminder(user, row.id)).toBe(true)
    expect(await deleteReminder(user, row.id)).toBe(false)
    expect(await getReminder(user, row.id)).toBeNull()
  })

  test("markReminderNotificationsRead marks only that reminder's unread notifications", async () => {
    const user = getTestUser()
    const raise = (reminderId: string, key: string, type = 'reminder') =>
      insertNotification(user, {
        data: { occurrence_date: key, reminder_id: reminderId },
        dedupe_key: `${type}:${reminderId}:${key}`,
        in_app: true,
        push: true,
        title: 'Reminder',
        type,
      })
    const mine = await raise('r1', '2026-11-17')
    const other = await raise('r2', '2026-11-17')
    const otherType = await raise('r1', '2026-11-17', 'admin_signup')

    expect(await markReminderNotificationsRead(user, 'r1')).toBe(1)
    expect((await getNotificationById(user, mine!.id))!.read_at).toBeInstanceOf(Date)
    expect((await getNotificationById(user, other!.id))!.read_at).toBeNull()
    expect((await getNotificationById(user, otherType!.id))!.read_at).toBeNull()
    expect(await markReminderNotificationsRead(user, 'r1')).toBe(0)
  })

  test('markReminderNotificationsRead leaves the excepted occurrence unread', async () => {
    const user = getTestUser()
    const raise = (date: string) =>
      insertNotification(user, {
        data: { occurrence_date: date, reminder_id: 'r1' },
        dedupe_key: `reminder:r1:${date}`,
        in_app: true,
        push: true,
        title: 'Reminder',
        type: 'reminder',
      })
    const yesterday = await raise('2026-11-17')
    const today = await raise('2026-11-18')

    expect(await markReminderNotificationsRead(user, 'r1', 'reminder:r1:2026-11-18')).toBe(1)
    expect((await getNotificationById(user, yesterday!.id))!.read_at).toBeInstanceOf(Date)
    expect((await getNotificationById(user, today!.id))!.read_at).toBeNull()
  })
})
