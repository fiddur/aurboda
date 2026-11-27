import type { ActivityItemGroup, ActivityItemHistory, StrengthScore } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { formatMeasure } from '../../utils/measures'
import { type SummaryInput, sessionSummaryView } from './summaryModel'

const start = new Date('2026-11-10T17:00:00.000Z')
const end = new Date('2026-11-10T17:52:00.000Z')

const sets = [
  { exercise: 'Bench press', reps: 10, set_type: 'warmup', weight: 40 },
  { exercise: 'Bench press', reps: 5, weight: 80 },
  { exercise: 'Bench press', reps: 5, weight: 80 },
  { exercise: 'Squat', reps: 5, weight: 100 },
]

const activity = { data: { in_progress: false, sets }, end_time: end, start_time: start }

const group = (
  value: string,
  records: ActivityItemGroup['records'],
  extra: Partial<ActivityItemGroup> = {},
): ActivityItemGroup => ({
  items: [],
  measures: { e1rm: 93.3, volume: 800 },
  previous: { id: 'p1', items: [], measures: {}, start_time: '2026-11-03T17:00:00.000Z' },
  records,
  trend: [],
  value,
  ...extra,
})

const history = (groups: ActivityItemGroup[]): ActivityItemHistory => ({
  activity_id: 'a1',
  field: 'sets.exercise',
  groups,
  totals: {},
  trend_half_life_days: 30,
})

const score = (
  overall: number | null,
  groups: Record<string, number | null>,
  missing = false,
): StrengthScore =>
  ({
    at: start.toISOString(),
    field: 'sets.exercise',
    groups: Object.entries(groups).map(([name, s]) => ({
      group: name.toLowerCase(),
      lifts: [],
      muscle_groups: [],
      name,
      score: s,
    })),
    missing: missing ? ['sex'] : [],
    score: overall,
    window_days: 90,
  }) as StrengthScore

const view = (extra: Partial<SummaryInput> = {}) => sessionSummaryView({ activity, ...extra })

describe('sessionSummaryView', () => {
  it('leads with a risen strength score and lists every group that rose', () => {
    const v = view({
      scoreAfter: score(106, { Chest: 96, Legs: 80 }),
      scoreBefore: score(104, { Chest: 91, Legs: 82 }),
    })
    expect(v.headline).toBe('Stronger: strength score up 2 points')
    expect(v.highlights).toEqual(['Strength score 104 → 106 (+2)', 'Chest 91 → 96 (+5)'])
  })

  it('names a group that rose when the overall score did not', () => {
    const v = view({ scoreAfter: score(104, { Chest: 92 }), scoreBefore: score(104, { Chest: 91 }) })
    expect(v.headline).toBe('Stronger: chest score up 1 point')
    expect(v.highlights).toEqual(['Chest 91 → 92 (+1)'])
  })

  it('celebrates a first score', () => {
    const v = view({ scoreAfter: score(88, { Chest: 88 }), scoreBefore: score(null, { Chest: null }) })
    expect(v.headline).toBe('First strength score: 88')
    expect(v.highlights).toEqual(['First chest score: 88'])
  })

  it('shows no score line when something is missing or nothing is known', () => {
    expect(
      view({ scoreAfter: score(null, {}, true), scoreBefore: score(null, {}, true) }).highlights,
    ).toEqual([])
    expect(view({ scoreAfter: null, scoreBefore: null }).highlights).toEqual([])
    expect(
      view({ scoreAfter: score(100, { Chest: 90 }), scoreBefore: score(102, { Chest: 95 }) }).highlights,
    ).toEqual([])
  })

  it('counts the records of exercises done before and lists them per exercise', () => {
    const v = view({
      history: history([
        group('Bench press', ['e1rm', 'volume']),
        group('Squat', ['volume'], { previous: undefined }),
      ]),
    })
    expect(v.headline).toBe('2 new records')
    expect(v.highlights).toEqual([])
    expect(v.exercises[0]).toMatchObject({ name: 'Bench press' })
    expect(v.exercises[0].records).toHaveLength(2)
    expect(v.exercises[1].records).toEqual([])
  })

  it('falls back to the minutes of movement and says a single record in the singular', () => {
    expect(view().headline).toBe('Session done: 52 minutes of movement added')
    expect(view({ history: history([group('Squat', ['volume'])]) }).headline).toBe('1 new record')
    const v = view({
      history: history([group('Squat', ['volume'])]),
      scoreAfter: score(106, {}),
      scoreBefore: score(104, {}),
    })
    expect(v.highlights).toEqual(['Strength score 104 → 106 (+2)', '1 new record'])
  })

  it('gives duration, exercises, working sets, volume and active calories', () => {
    expect(view({ activeCalories: 212.4 }).stats).toEqual([
      { label: 'Duration', value: '52 min' },
      { label: 'Exercises', value: '2' },
      { label: 'Sets (+1 warmup)', value: '3' },
      { label: 'Volume', value: formatMeasure('volume', 1300) },
      { label: 'Active calories', value: '212 kcal' },
    ])
  })

  it('gives total reps without a weight and leaves out zero calories', () => {
    const bodyweight = {
      ...activity,
      data: {
        sets: [
          { exercise: 'Pull-up', reps: 8 },
          { exercise: 'Pull-up', reps: 6 },
        ],
      },
    }
    expect(sessionSummaryView({ activeCalories: 0, activity: bodyweight }).stats).toEqual([
      { label: 'Duration', value: '52 min' },
      { label: 'Exercises', value: '1' },
      { label: 'Sets', value: '2' },
      { label: 'Total reps', value: '14' },
    ])
  })

  it('lists the exercise blocks in order with their summaries', () => {
    expect(view().exercises.map((e) => [e.name, e.summary])).toEqual([
      ['Bench press', '3 sets: 10, 5, 5 reps'],
      ['Squat', '1 set: 5 reps'],
    ])
  })
})
