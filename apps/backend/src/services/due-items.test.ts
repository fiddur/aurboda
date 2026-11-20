import { describe, expect, test } from 'vitest'

import { currentDay, dayWindow, slotsForDay, slotStates } from './due-items.ts'

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
      [{ answered_at: at('15:00'), id: 'a', scheduled_for: slots[1]!.at }],
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
        { answered_at: at('09:00'), id: 'free', scheduled_for: null },
        { answered_at: at('08:30'), id: 'first', scheduled_for: slots[0]!.at },
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
      [{ answered_at: at('02:00'), id: 'early', scheduled_for: null }],
      at('13:00'),
    )
    expect(states.every((s) => s.check_in_id === null)).toBe(true)
  })
})
