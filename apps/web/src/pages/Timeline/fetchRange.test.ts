import { addDays, differenceInCalendarDays, endOfDay, parseISO, startOfDay, subDays } from 'date-fns'
import { describe, expect, it } from 'vitest'

import { nextFetchRange } from './fetchRange'

const today = new Date('2026-09-26T12:00:00Z')
const day = (iso: string) => ({ end: endOfDay(parseISO(iso)), start: startOfDay(parseISO(iso)) })
const spanDays = (r: { from: string; to: string }) =>
  differenceInCalendarDays(parseISO(r.to), parseISO(r.from)) + 1

describe('nextFetchRange', () => {
  it('keeps the same range object when the view lies inside a normal range', () => {
    const current = { from: '2026-09-10', to: '2026-09-16' }
    expect(nextFetchRange(day('2026-09-13'), current, today)).toBe(current)
  })

  it('re-centres on the view when panning past the end instead of extending', () => {
    const current = { from: '2026-09-10', to: '2026-09-16' }
    expect(nextFetchRange(day('2026-09-18'), current, today)).toEqual({
      from: '2026-09-15',
      to: '2026-09-21',
    })
  })

  it('re-centres on the view when panning past the start', () => {
    const current = { from: '2026-09-10', to: '2026-09-16' }
    expect(nextFetchRange(day('2026-09-08'), current, today)).toEqual({
      from: '2026-09-05',
      to: '2026-09-11',
    })
  })

  it('does not accumulate when repeatedly jumping back from a 1-day view', () => {
    let view = day('2026-09-25')
    let range = { from: '2026-09-25', to: '2026-09-26' }
    for (let i = 0; i < 12; i++) {
      view = { end: subDays(view.end, 30), start: subDays(view.start, 30) }
      range = nextFetchRange(view, range, today)
      expect(spanDays(range)).toBe(7)
      expect(parseISO(range.from) <= view.start).toBe(true)
      expect(endOfDay(parseISO(range.to)) >= view.end).toBe(true)
    }
  })

  it('shrinks when zooming in to one day inside a 90-day range', () => {
    const current = { from: '2026-06-01', to: '2026-08-29' }
    expect(nextFetchRange(day('2026-07-15'), current, today)).toEqual({
      from: '2026-07-12',
      to: '2026-07-18',
    })
  })

  it('keeps a range moderately wider than the view', () => {
    const current = { from: '2026-06-01', to: '2026-08-29' }
    const view = { end: endOfDay(parseISO('2026-08-15')), start: startOfDay(parseISO('2026-07-15')) }
    expect(nextFetchRange(view, current, today)).toBe(current)
  })

  it('grows to the view plus margin when zooming out', () => {
    const current = { from: '2026-07-12', to: '2026-07-18' }
    const view = { end: endOfDay(parseISO('2026-08-31')), start: startOfDay(parseISO('2026-06-01')) }
    expect(nextFetchRange(view, current, today)).toEqual({ from: '2026-05-29', to: '2026-09-03' })
  })

  it('never lets `to` exceed today', () => {
    const current = { from: '2026-09-01', to: '2026-09-05' }
    const view = { end: endOfDay(today), start: startOfDay(subDays(today, 1)) }
    expect(nextFetchRange(view, current, today)).toEqual({ from: '2026-09-22', to: '2026-09-26' })
    const future = { end: addDays(today, 2), start: startOfDay(today) }
    expect(nextFetchRange(future, current, today).to).toBe('2026-09-26')
  })

  it('returns the current object when the desired range equals it by value', () => {
    const current = { from: '2026-09-22', to: '2026-09-26' }
    const view = { end: addDays(today, 1), start: startOfDay(subDays(today, 1)) }
    expect(nextFetchRange(view, current, today)).toBe(current)
  })
})
