import { describe, expect, it } from 'vitest'

import {
  exerciseListLabel,
  lastSetLabel,
  recentSessionSets,
  repeatCandidates,
  sessionDateLabel,
  startedLabel,
  unfinishedOnServer,
} from './startModel'

const now = new Date(2026, 10, 14, 18, 0)
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m)

const sets = (...names: string[]) => ({ sets: names.map((exercise) => ({ exercise, reps: 5 })) })

describe('unfinishedOnServer', () => {
  it('finds the newest in-progress session of the last seven days', () => {
    const rows = [
      { data: { in_progress: true }, id: 'old', start_time: at(1, 17) },
      { data: { in_progress: true }, id: 'a', start_time: at(12, 17) },
      { data: { in_progress: true }, id: 'b', start_time: at(13, 17) },
      { data: { in_progress: false }, end_time: at(14, 18), id: 'c', start_time: at(14, 17) },
    ]
    expect(unfinishedOnServer(rows, now)?.id).toBe('b')
    expect(unfinishedOnServer([rows[0], rows[3]], now)).toBeUndefined()
  })
})

describe('repeatCandidates', () => {
  it('lists the latest finished sessions with sets, newest first, at most five', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => ({
        data: sets('Bench press', 'Pull-up'),
        end_time: at(i + 1, 18),
        id: `s${i + 1}`,
        start_time: at(i + 1, 17, 2),
      })),
      { data: { ...sets('Squat'), in_progress: true }, id: 'open', start_time: at(13, 17) },
      { data: {}, end_time: at(12, 18), id: 'empty', start_time: at(12, 17) },
    ]
    const candidates = repeatCandidates(rows, 's6')
    expect(candidates.map((c) => c.id)).toEqual(['s5', 's4', 's3', 's2', 's1'])
    expect(candidates[0]).toEqual({
      id: 's5',
      minutes: 58,
      names: ['Bench press', 'Pull-up'],
      start_time: at(5, 17, 2),
    })
  })
})

describe('recentSessionSets', () => {
  it('gives the sets of sessions that have any, newest first, without the current one', () => {
    const rows = [
      { data: sets('A'), id: 'x', start_time: at(10, 17) },
      { data: sets('B'), id: 'y', start_time: at(11, 17) },
      { data: {}, id: 'z', start_time: at(12, 17) },
      { data: sets('C'), id: 'cur', start_time: at(13, 17) },
    ]
    expect(recentSessionSets(rows, 'cur').map((s) => s[0].exercise)).toEqual(['B', 'A'])
  })
})

describe('labels', () => {
  it('names up to three exercises and counts the rest', () => {
    expect(exerciseListLabel(['A', 'B'])).toBe('A, B')
    expect(exerciseListLabel(['Bench press', 'Pull-up', 'Overhead press', 'Row', 'Curl'])).toBe(
      'Bench press, Pull-up, Overhead press and 2 more',
    )
  })

  it('formats dates and durations', () => {
    expect(sessionDateLabel(at(10, 17), 58)).toBe('Tue 10 Nov, 58 min')
    expect(sessionDateLabel(at(10, 17))).toBe('Tue 10 Nov')
    expect(startedLabel(at(14, 17, 2), now)).toBe('Started today at 17:02')
    expect(startedLabel(at(13, 9, 5), now)).toBe('Started yesterday at 09:05')
    expect(startedLabel(at(10, 17), now)).toBe('Started Tue 10 Nov at 17:00')
    expect(lastSetLabel(new Date(2026, 10, 14, 17, 48).toISOString(), now)).toBe('Last set 12 minutes ago.')
    expect(lastSetLabel(undefined, now)).toBeUndefined()
  })
})
