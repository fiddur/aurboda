import type { ExerciseShare, SharedExerciseData } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import { exerciseNoteContent, formatExerciseDate, renderExerciseShareHtml } from './exercise-object.ts'

const exercise: ExerciseShare = {
  activity_type: 'strength_training',
  field: 'sets.exercise',
  include_records: true,
  include_sessions: true,
  name: 'Dumbbell Bench Press',
  url: 'https://aurboda.example/u/fiddur/db-bench',
  value: 'Dumbbell Bench Press',
}

const done = { count: 43, first: '2025-03-11T07:00:00.000Z', last: '2026-11-04T07:00:00.000Z' }

const data: SharedExerciseData = {
  done,
  history: [
    {
      items: [
        { reps: 12, set_type: 'warmup', weight: 12 },
        { reps: 11, weight: 22 },
        { reps: 11, weight: 20 },
      ],
      measures: { e1rm: 30.066, volume: 462 },
      records: ['max_reps'],
      start_time: '2026-11-04T07:00:00.000Z',
    },
  ],
  per_week: null,
  records: [
    { measure: 'e1rm', set: { reps: 7, weight: 32 }, start_time: '2025-12-21T09:00:00.000Z', value: 39.466 },
    { measure: 'max_time', start_time: '2025-12-22T09:00:00.000Z', value: 90 },
  ],
  trend: null,
}

const snapshot = { activity_type_name: 'Strength training', data }

describe('renderExerciseShareHtml', () => {
  test('a table in the note comes out as lines, not a table', () => {
    const html = renderExerciseShareHtml(
      exercise,
      snapshot,
      '| Metric | Value |\n|---|---|\n| HRV | 42 |',
      'UTC',
    )
    expect(html).toContain('<p><em>Metric</em><br /><strong>HRV</strong>: Value 42</p>')
    expect(html).not.toContain('<table')
  })

  test('heading, note, records with the session count, sessions and link', () => {
    expect(renderExerciseShareHtml(exercise, snapshot, 'New **PR**', 'Europe/Stockholm')).toBe(
      [
        '<p><strong>Dumbbell Bench Press</strong> · Strength training</p>',
        '<p>New <strong>PR</strong></p>\n',
        '<p>Best e1RM 39.5 kg (21 Dec 2025, 7×32 kg)<br>Longest hold 1:30 (22 Dec 2025)<br>43 sessions since 11 Mar 2025</p>',
        '<p>4 Nov 2026: 12×12 kg (w), 11×22 kg, 11×20 kg · e1RM 30.1 kg · volume 462 kg · PR reps</p>',
        '<p><a href="https://aurboda.example/u/fiddur/db-bench" rel="nofollow noopener noreferrer" target="_blank">https://aurboda.example/u/fiddur/db-bench</a></p>',
      ].join('\n'),
    )
  })

  test('leaves out records and sessions not opted into, and a single session reads as one', () => {
    const one = { ...snapshot, data: { ...data, done: { ...done, count: 1 } } }
    const html = renderExerciseShareHtml(
      { ...exercise, include_sessions: false, url: undefined },
      one,
      null,
      'UTC',
    )
    expect(html).toContain('1 session, 11 Mar 2025')
    expect(html).not.toContain('4 Nov 2026')
    expect(html).not.toContain('<a ')

    const bare = renderExerciseShareHtml({ ...exercise, include_records: false }, snapshot, null, 'UTC')
    expect(bare).not.toContain('Best e1RM')
    expect(bare).not.toContain('sessions since')
  })

  test('without a snapshot: name, note and link only', () => {
    expect(renderExerciseShareHtml(exercise, null, 'Hi', 'UTC')).toBe(
      [
        '<p><strong>Dumbbell Bench Press</strong></p>',
        '<p>Hi</p>\n',
        '<p><a href="https://aurboda.example/u/fiddur/db-bench" rel="nofollow noopener noreferrer" target="_blank">https://aurboda.example/u/fiddur/db-bench</a></p>',
      ].join('\n'),
    )
  })

  test('escapes the name and type', () => {
    const html = renderExerciseShareHtml(
      { ...exercise, name: '<b>x</b>' },
      { ...snapshot, activity_type_name: 'A & B' },
      null,
      'UTC',
    )
    expect(html).toContain('<strong>&lt;b&gt;x&lt;/b&gt;</strong> · A &amp; B')
  })
})

describe('formatExerciseDate', () => {
  test("formats in the owner's timezone, falling back to UTC on an invalid one", () => {
    expect(formatExerciseDate('2026-11-04T23:30:00.000Z', 'Europe/Stockholm')).toBe('5 Nov 2026')
    expect(formatExerciseDate('2026-11-04T23:30:00.000Z', 'Not/AZone')).toBe('4 Nov 2026')
  })
})

describe('exerciseNoteContent', () => {
  test('renders from the resolved data, and name + note + link when resolving fails', async () => {
    const post = { exercise, include_chart: false, message: null }
    const resolved = await exerciseNoteContent('fiddur', post, {
      getUserTimezone: async () => 'UTC',
      structured: {
        getActivityTypeDefinition: async () => ({ display_name: 'Strength training' }),
        resolveSharedExerciseData: async () => data,
      },
    })
    expect(resolved).toContain('Strength training')
    expect(resolved).toContain('43 sessions since 11 Mar 2025')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failed = await exerciseNoteContent('fiddur', post, {
      getUserTimezone: async () => 'UTC',
      structured: {
        getActivityTypeDefinition: async () => null,
        resolveSharedExerciseData: async () => {
          throw new Error('db down')
        },
      },
    })
    warn.mockRestore()
    expect(failed).toBe(renderExerciseShareHtml(exercise, null, null, 'UTC'))
  })
})
