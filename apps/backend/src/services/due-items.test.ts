import { describe, expect, test } from 'vitest'

import { currentDay, dayWindow, slotsBetween, slotsForDay, slotStates } from './due-items.ts'

const TZ = 'Europe/Stockholm'
const every = { day_starts_at: '04:00', times: ['08:00', '00:30'], weekdays: [1, 2, 3, 4, 5, 6, 7] }

const iso = (date: Date) => date.toISOString()

describe('slotsForDay', () => {
  test('a slot before day_starts_at belongs to the day before, on the next calendar date', () => {
    const slots = slotsForDay(every, '2026-11-20', TZ)
    expect(slots.map((slot) => [slot.time, iso(slot.at), slot.date])).toEqual([
      ['08:00', '2026-11-20T07:00:00.000Z', '2026-11-20'],
      ['00:30', '2026-11-20T23:30:00.000Z', '2026-11-20'],
    ])
    expect(iso(slots[0]!.day_start)).toBe('2026-11-20T03:00:00.000Z')
    expect(iso(slots[0]!.day_end)).toBe('2026-11-21T03:00:00.000Z')
  })

  test('a slot on the 04:00 boundary is the first of its day', () => {
    const slots = slotsForDay({ ...every, times: ['03:55', '04:00'] }, '2026-11-20', TZ)
    expect(slots.map((slot) => iso(slot.at))).toEqual([
      '2026-11-20T03:00:00.000Z',
      '2026-11-21T02:55:00.000Z',
    ])
  })

  test('the weekday is that of the day, not of the calendar date of a late slot', () => {
    expect(slotsForDay({ ...every, weekdays: [5] }, '2026-11-20', TZ)).toHaveLength(2)
    expect(slotsForDay({ ...every, weekdays: [6] }, '2026-11-20', TZ)).toEqual([])
  })

  test('the start and end dates bound the days', () => {
    expect(slotsForDay({ ...every, start_date: '2026-11-21' }, '2026-11-20', TZ)).toEqual([])
    expect(slotsForDay({ ...every, end_date: '2026-11-19' }, '2026-11-20', TZ)).toEqual([])
    expect(
      slotsForDay({ ...every, end_date: '2026-11-20', start_date: '2026-11-20' }, '2026-11-20', TZ),
    ).toHaveLength(2)
  })

  test('a slot in the spring-forward gap moves to the jump, and the day is 23 hours', () => {
    const slots = slotsForDay({ ...every, times: ['02:30'] }, '2026-03-28', TZ)
    expect(iso(slots[0]!.at)).toBe('2026-03-29T01:00:00.000Z')
    const { end, start } = dayWindow('2026-03-28', '04:00', TZ)
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23)
  })

  test('an autumn day is 25 hours and a doubled time uses the first', () => {
    const slots = slotsForDay({ ...every, times: ['02:30'] }, '2026-10-24', TZ)
    expect(iso(slots[0]!.at)).toBe('2026-10-25T00:30:00.000Z')
    const { end, start } = dayWindow('2026-10-24', '04:00', TZ)
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25)
  })
})

describe('currentDay', () => {
  test('before day_starts_at it is still the day before', () => {
    expect(currentDay(new Date('2026-11-21T02:59:00Z'), '04:00', TZ)).toBe('2026-11-20')
    expect(currentDay(new Date('2026-11-21T03:00:00Z'), '04:00', TZ)).toBe('2026-11-21')
    expect(currentDay(new Date('2026-11-21T03:00:00Z'), '00:00', TZ)).toBe('2026-11-21')
  })
})

describe('slotStates', () => {
  const slots = slotsForDay({ ...every, times: ['08:00', '12:00', '20:00'] }, '2026-11-20', TZ)
  const at = (time: string) => new Date(`2026-11-20T${time}:00Z`)

  test('upcoming before its time, due after it, missed once the day is over', () => {
    expect(slotStates(slots, [], at('10:00')).map((s) => s.state)).toEqual(['due', 'upcoming', 'upcoming'])
    expect(slotStates(slots, [], new Date('2026-11-21T03:00:00Z')).map((s) => s.state)).toEqual([
      'missed',
      'missed',
      'missed',
    ])
  })

  test('a check-in for a slot does that slot', () => {
    const states = slotStates(
      slots,
      [{ answered_at: at('15:00'), status: 'answered', id: 'a', scheduled_for: slots[1]!.at }],
      at('16:00'),
    )
    expect(states.map((s) => [s.state, s.check_in_id])).toEqual([
      ['due', null],
      ['done', 'a'],
      ['upcoming', null],
    ])
  })

  test('an unscheduled check-in does the earliest slot of its day no other has taken', () => {
    const states = slotStates(
      slots,
      [
        { answered_at: at('09:00'), status: 'answered', id: 'free', scheduled_for: null },
        { answered_at: at('08:30'), status: 'answered', id: 'first', scheduled_for: slots[0]!.at },
      ],
      at('13:00'),
    )
    expect(states.map((s) => [s.state, s.check_in_id])).toEqual([
      ['done', 'first'],
      ['done', 'free'],
      ['upcoming', null],
    ])
  })

  test('an unscheduled check-in outside the day does nothing', () => {
    const states = slotStates(
      slots,
      [{ answered_at: at('02:00'), status: 'answered', id: 'early', scheduled_for: null }],
      at('13:00'),
    )
    expect(states.every((s) => s.check_in_id === null)).toBe(true)
  })
})

describe('skipped slots', () => {
  const day = slotsForDay(
    { times: ['08:00', '21:00'], weekdays: [1, 2, 3, 4, 5, 6, 7] },
    '2026-11-20',
    'Europe/Stockholm',
  )
  const now = new Date('2026-11-20T12:00:00Z')

  test('a skip of a slot makes it skipped', () => {
    const states = slotStates(
      day,
      [{ answered_at: now, id: 's', scheduled_for: day[0]!.at, status: 'skipped' }],
      now,
    )
    expect(states.map((s) => [s.state, s.check_in_id])).toEqual([
      ['skipped', 's'],
      ['upcoming', null],
    ])
  })

  test('an answer to the same slot wins over a skip', () => {
    const states = slotStates(
      day,
      [
        { answered_at: now, id: 's', scheduled_for: day[0]!.at, status: 'skipped' },
        { answered_at: now, id: 'a', scheduled_for: day[0]!.at, status: 'answered' },
      ],
      now,
    )
    expect(states[0]).toMatchObject({ check_in_id: 'a', state: 'done' })
  })
})

describe('slotsBetween', () => {
  test('lists every day, empty on days the schedule skips', () => {
    const days = slotsBetween(
      { times: ['08:00'], weekdays: [1] },
      '2026-11-15',
      '2026-11-17',
      'Europe/Stockholm',
    )
    expect(days.map((d) => [d.date, d.slots.length])).toEqual([
      ['2026-11-15', 0],
      ['2026-11-16', 1],
      ['2026-11-17', 0],
    ])
  })
})
