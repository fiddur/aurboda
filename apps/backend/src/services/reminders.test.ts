import { describe, expect, test } from 'vitest'

import type { ReminderInsert, ReminderPatch, ReminderRecord } from '../db/index.ts'
import type { RaiseNotificationInput } from './notifications.ts'

import {
  addReminder,
  deleteReminderById,
  dueOccurrence,
  listRemindersView,
  nextOccurrence,
  occurrenceAt,
  raiseDueReminders,
  type ReminderDeps,
  updateReminderById,
} from './reminders.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const ALL = [1, 2, 3, 4, 5, 6, 7]

const reminder = (overrides: Partial<ReminderRecord> = {}): ReminderRecord => ({
  body: null,
  created_at: new Date('2026-11-01T00:00:00Z'),
  enabled: true,
  id: ID,
  link: null,
  not_before: new Date('2026-11-01T00:00:00Z'),
  time_of_day: '20:00',
  title: 'Evening questionnaire',
  updated_at: new Date('2026-11-01T00:00:00Z'),
  weekdays: ALL,
  ...overrides,
})

const at = (iso: string) => new Date(iso)

describe('occurrenceAt', () => {
  test('reads the time in the zone', () => {
    expect(occurrenceAt('2026-11-18', '20:00', 'Europe/Stockholm')).toEqual(at('2026-11-18T19:00:00Z'))
    expect(occurrenceAt('2026-07-01', '20:00', 'Europe/Stockholm')).toEqual(at('2026-07-01T18:00:00Z'))
  })

  test('a time in the spring-forward gap moves to the first valid instant after it', () => {
    expect(occurrenceAt('2026-03-29', '02:30', 'Europe/Stockholm')).toEqual(at('2026-03-29T01:00:00Z'))
  })

  test('a time that happens twice uses the first', () => {
    expect(occurrenceAt('2026-10-25', '02:30', 'Europe/Stockholm')).toEqual(at('2026-10-25T00:30:00Z'))
  })
})

describe('dueOccurrence', () => {
  test('due on time', () => {
    expect(dueOccurrence(reminder(), 'UTC', at('2026-11-18T20:00:00Z'))).toEqual({
      at: at('2026-11-18T20:00:00Z'),
      date: '2026-11-18',
    })
  })

  test('due 59 minutes late, not 61', () => {
    expect(dueOccurrence(reminder(), 'UTC', at('2026-11-18T20:59:00Z'))?.date).toBe('2026-11-18')
    expect(dueOccurrence(reminder(), 'UTC', at('2026-11-18T21:01:00Z'))).toBeNull()
  })

  test('not due before the time', () => {
    expect(dueOccurrence(reminder(), 'UTC', at('2026-11-18T19:59:00Z'))).toBeNull()
  })

  test('not due on a weekday outside the list', () => {
    expect(dueOccurrence(reminder({ weekdays: [1, 2] }), 'UTC', at('2026-11-18T20:10:00Z'))).toBeNull()
    expect(dueOccurrence(reminder({ weekdays: [3] }), 'UTC', at('2026-11-18T20:10:00Z'))?.date).toBe(
      '2026-11-18',
    )
  })

  test('not due when disabled', () => {
    expect(dueOccurrence(reminder({ enabled: false }), 'UTC', at('2026-11-18T20:10:00Z'))).toBeNull()
  })

  test('not due when created or rescheduled after today’s time', () => {
    const r = reminder({ not_before: at('2026-11-18T20:05:00Z') })
    expect(dueOccurrence(r, 'UTC', at('2026-11-18T20:10:00Z'))).toBeNull()
    expect(dueOccurrence(r, 'UTC', at('2026-11-19T20:10:00Z'))?.date).toBe('2026-11-19')
  })

  test('reads the time and the date in the user’s zone', () => {
    const r = reminder({ time_of_day: '00:30', weekdays: [4] })
    expect(dueOccurrence(r, 'Europe/Stockholm', at('2026-11-18T23:40:00Z'))).toEqual({
      at: at('2026-11-18T23:30:00Z'),
      date: '2026-11-19',
    })
    expect(dueOccurrence(r, 'UTC', at('2026-11-18T23:40:00Z'))).toBeNull()
  })

  test('an occurrence late in the evening stays due past local midnight', () => {
    const r = reminder({ time_of_day: '23:45' })
    expect(dueOccurrence(r, 'UTC', at('2026-11-19T00:10:00Z'))?.date).toBe('2026-11-18')
  })

  test('DST gap and overlap in Europe/Stockholm', () => {
    const gap = reminder({ not_before: at('2026-01-01T00:00:00Z'), time_of_day: '02:30' })
    expect(dueOccurrence(gap, 'Europe/Stockholm', at('2026-03-29T01:00:00Z'))?.date).toBe('2026-03-29')
    expect(dueOccurrence(gap, 'Europe/Stockholm', at('2026-03-29T00:59:00Z'))).toBeNull()
    expect(dueOccurrence(gap, 'Europe/Stockholm', at('2026-10-25T00:30:00Z'))?.date).toBe('2026-10-25')
  })
})

describe('nextOccurrence', () => {
  test('later today', () => {
    expect(nextOccurrence(reminder(), 'UTC', at('2026-11-18T10:00:00Z'))).toEqual(at('2026-11-18T20:00:00Z'))
  })

  test('tomorrow once today’s has passed', () => {
    expect(nextOccurrence(reminder(), 'UTC', at('2026-11-18T20:01:00Z'))).toEqual(at('2026-11-19T20:00:00Z'))
  })

  test('the next matching weekday', () => {
    expect(nextOccurrence(reminder({ weekdays: [1] }), 'UTC', at('2026-11-18T10:00:00Z'))).toEqual(
      at('2026-11-23T20:00:00Z'),
    )
    expect(nextOccurrence(reminder({ weekdays: [3] }), 'UTC', at('2026-11-18T20:01:00Z'))).toEqual(
      at('2026-11-25T20:00:00Z'),
    )
  })

  test('honours not_before', () => {
    const r = reminder({ not_before: at('2026-11-18T20:30:00Z') })
    expect(nextOccurrence(r, 'UTC', at('2026-11-18T10:00:00Z'))).toEqual(at('2026-11-19T20:00:00Z'))
  })

  test('disabled gives null', () => {
    expect(nextOccurrence(reminder({ enabled: false }), 'UTC', at('2026-11-18T10:00:00Z'))).toBeNull()
  })
})

const fakeDeps = (rows: ReminderRecord[] = [reminder()], now = at('2026-11-18T20:10:00Z')) => {
  const store = new Map(rows.map((r) => [r.id, r]))
  const raised: [string, RaiseNotificationInput][] = []
  const markCalls: [string, string, string | undefined][] = []
  const inserts: ReminderInsert[] = []
  const patches: ReminderPatch[] = []
  const deps: ReminderDeps = {
    delete: async (_user, id) => store.delete(id),
    get: async (_user, id) => store.get(id) ?? null,
    getTimezone: async () => 'UTC',
    insert: async (_user, input) => {
      inserts.push(input)
      const row = reminder({
        ...input,
        body: input.body ?? null,
        created_at: now,
        id: '22222222-2222-4222-8222-222222222222',
        link: input.link ?? null,
        updated_at: now,
      })
      store.set(row.id, row)
      return row
    },
    list: async () => [...store.values()],
    markRead: async (user, reminderId, except) => {
      markCalls.push([user, reminderId, except])
      return 0
    },
    now: () => now,
    raise: async (user, input) => {
      raised.push([user, input])
    },
    update: async (_user, id, patch) => {
      patches.push(patch)
      const existing = store.get(id)
      if (!existing) return null
      const next = { ...existing, ...patch } as ReminderRecord
      store.set(id, next)
      return next
    },
  }
  return { deps, inserts, markCalls, patches, raised }
}

describe('raiseDueReminders', () => {
  test('marks earlier unread read and raises with the dedupe key', async () => {
    const { deps, markCalls, raised } = fakeDeps([reminder({ body: 'How was today?', link: '/reports' })])
    expect(await raiseDueReminders(deps, 'alice')).toBe(1)
    expect(markCalls).toEqual([['alice', ID, `reminder:${ID}:2026-11-18`]])
    expect(raised).toEqual([
      [
        'alice',
        {
          body: 'How was today?',
          data: { occurrence_date: '2026-11-18', reminder_id: ID },
          dedupe_key: `reminder:${ID}:2026-11-18`,
          link: '/reports',
          title: 'Evening questionnaire',
          type: 'reminder',
        },
      ],
    ])
  })

  test('a reminder without a link raises without one', async () => {
    const { deps, raised } = fakeDeps()
    await raiseDueReminders(deps, 'alice')
    expect(raised[0]![1].link).toBeUndefined()
    expect(raised[0]![1].body).toBeUndefined()
  })

  test('does nothing when nothing is due', async () => {
    const { deps, markCalls, raised } = fakeDeps([reminder({ time_of_day: '08:00' })])
    expect(await raiseDueReminders(deps, 'alice')).toBe(0)
    expect(markCalls).toEqual([])
    expect(raised).toEqual([])
  })
})

describe('listRemindersView', () => {
  test('gives each reminder its next_due_at and the earliest of them', async () => {
    const { deps } = fakeDeps(
      [
        reminder(),
        reminder({ id: '33333333-3333-4333-8333-333333333333', time_of_day: '21:00' }),
        reminder({ enabled: false, id: '44444444-4444-4444-8444-444444444444' }),
      ],
      at('2026-11-18T10:00:00Z'),
    )
    const view = await listRemindersView(deps, 'alice')
    expect(view.timezone).toBe('UTC')
    expect(view.reminders.map((r) => r.next_due_at)).toEqual([
      '2026-11-18T20:00:00.000Z',
      '2026-11-18T21:00:00.000Z',
      null,
    ])
    expect(view.next_due_at).toBe('2026-11-18T20:00:00.000Z')
  })

  test('next_due_at is null with nothing on', async () => {
    const { deps } = fakeDeps([reminder({ enabled: false })])
    expect((await listRemindersView(deps, 'alice')).next_due_at).toBeNull()
  })
})

describe('addReminder', () => {
  test('stores not_before as now, drops blank text, and serialises', async () => {
    const { deps, inserts } = fakeDeps([])
    const created = await addReminder(deps, 'alice', {
      body: '  ',
      enabled: true,
      time_of_day: '21:00',
      title: 'Stretch',
      weekdays: [3, 1],
    })
    expect(inserts[0]).toMatchObject({ body: null, link: null, not_before: at('2026-11-18T20:10:00Z') })
    expect(created.title).toBe('Stretch')
    expect(created.next_due_at).toBe('2026-11-18T21:00:00.000Z')
  })
})

describe('updateReminderById', () => {
  test('bumps not_before when the time changes', async () => {
    const { deps, patches } = fakeDeps()
    await updateReminderById(deps, 'alice', ID, { time_of_day: '21:00' })
    expect(patches[0]!.not_before).toEqual(at('2026-11-18T20:10:00Z'))
  })

  test('bumps not_before when the days change, not when they are the same', async () => {
    const { deps, patches } = fakeDeps([reminder({ weekdays: [1, 3] })])
    await updateReminderById(deps, 'alice', ID, { weekdays: [3, 1] })
    expect(patches[0]!.not_before).toBeUndefined()
    await updateReminderById(deps, 'alice', ID, { weekdays: [1] })
    expect(patches[1]!.not_before).toEqual(at('2026-11-18T20:10:00Z'))
  })

  test('bumps not_before when switched back on, not when switched off', async () => {
    const { deps, patches } = fakeDeps([reminder({ enabled: false })])
    await updateReminderById(deps, 'alice', ID, { enabled: true })
    expect(patches[0]!.not_before).toEqual(at('2026-11-18T20:10:00Z'))
    await updateReminderById(deps, 'alice', ID, { enabled: false })
    expect(patches[1]!.not_before).toBeUndefined()
  })

  test('leaves not_before on a text edit and clears with null', async () => {
    const { deps, patches } = fakeDeps([reminder({ body: 'Old', link: '/reports' })])
    const updated = await updateReminderById(deps, 'alice', ID, { body: null, link: null, title: 'New' })
    expect(patches[0]).toEqual({ body: null, link: null, title: 'New' })
    expect(updated).toMatchObject({ body: null, link: null, title: 'New' })
  })

  test('null for an unknown or malformed id', async () => {
    const { deps } = fakeDeps()
    expect(
      await updateReminderById(deps, 'alice', '99999999-9999-4999-8999-999999999999', { title: 'x' }),
    ).toBe(null)
    expect(await updateReminderById(deps, 'alice', 'nope', { title: 'x' })).toBeNull()
  })
})

describe('deleteReminderById', () => {
  test('deletes a known id, false otherwise', async () => {
    const { deps } = fakeDeps()
    expect(await deleteReminderById(deps, 'alice', 'nope')).toBe(false)
    expect(await deleteReminderById(deps, 'alice', ID)).toBe(true)
    expect(await deleteReminderById(deps, 'alice', ID)).toBe(false)
  })
})
