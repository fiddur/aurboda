import { exerciseMuscleGroups, NO_MUSCLE_GROUP_NAME, UNMAPPED_MUSCLE_GROUP_NAME } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { muscleGroupSummary } from './muscleGroupSummary'

const now = new Date('2026-11-12T12:00:00Z')
const thisWeek = '2026-11-09T00:00:00.000Z'
const lastWeek = '2026-11-02T00:00:00.000Z'
const earlier = '2026-10-05T00:00:00.000Z'

describe('muscleGroupSummary', () => {
  test('counts this week and the average per week over the period', () => {
    const rows = muscleGroupSummary({
      buckets: [
        { bucket_start: earlier, series: { Chest: 6 } },
        { bucket_start: lastWeek, series: { Chest: 4 } },
        { bucket_start: thisWeek, series: { Chest: 4 } },
      ],
      now,
      period_days: 28,
    })
    expect(rows[0]).toMatchObject({
      kind: 'group',
      muscle_group: 'chest',
      name: 'Chest',
      per_week: 3.5,
      this_week: 4,
      trained: true,
    })
  })

  test('lists the trained groups most sets first', () => {
    const rows = muscleGroupSummary({
      buckets: [
        { bucket_start: lastWeek, series: { Biceps: 2, Chest: 8, Quadriceps: 5 } },
        { bucket_start: thisWeek, series: { Biceps: 1.5 } },
      ],
      now,
      period_days: 14,
    })
    expect(rows.filter((r) => r.trained).map((r) => r.name)).toEqual(['Chest', 'Quadriceps', 'Biceps'])
    expect(rows.find((r) => r.name === 'Biceps')).toMatchObject({ per_week: 1.75, this_week: 1.5 })
  })

  test('lists every untrained group after the trained ones, at zero', () => {
    const rows = muscleGroupSummary({
      buckets: [{ bucket_start: thisWeek, series: { Chest: 3 } }],
      now,
      period_days: 7,
    })
    expect(rows).toHaveLength(exerciseMuscleGroups.length)
    expect(rows[0].name).toBe('Chest')
    expect(rows.slice(1).every((r) => !r.trained && r.per_week === 0 && r.this_week === 0)).toBe(true)
    expect(rows[1].name).toBe('Shoulders')
    expect(rows.map((r) => r.muscle_group)).toEqual(expect.arrayContaining([...exerciseMuscleGroups]))
  })

  test('puts the groups outside the catalogue last, "Not in the catalogue" at the very end', () => {
    const rows = muscleGroupSummary({
      buckets: [
        {
          bucket_start: thisWeek,
          series: { Chest: 1, [NO_MUSCLE_GROUP_NAME]: 9, [UNMAPPED_MUSCLE_GROUP_NAME]: 12 },
        },
      ],
      now,
      period_days: 7,
    })
    expect(rows[0].name).toBe('Chest')
    expect(rows.at(-2)).toMatchObject({ kind: 'no_muscle_group', per_week: 9, trained: true })
    expect(rows.at(-1)).toMatchObject({ kind: 'not_in_catalogue', per_week: 12, trained: true })
    expect(rows.at(-2)?.muscle_group).toBeUndefined()
    expect(rows.at(-1)?.muscle_group).toBeUndefined()
  })

  test('leaves out the rows outside the catalogue when they have no sets', () => {
    const rows = muscleGroupSummary({ buckets: [], now, period_days: 7 })
    expect(rows.some((r) => r.kind !== 'group')).toBe(false)
  })

  test('scales the bars to the largest weekly average', () => {
    const rows = muscleGroupSummary({
      buckets: [{ bucket_start: lastWeek, series: { Chest: 8, Lats: 2 } }],
      now,
      period_days: 14,
    })
    expect(rows.find((r) => r.name === 'Chest')?.bar).toBe(1)
    expect(rows.find((r) => r.name === 'Lats')?.bar).toBe(0.25)
    expect(rows.find((r) => r.name === 'Calves')?.bar).toBe(0)
  })

  test('takes this week from the bucket that started within the last seven days', () => {
    const rows = muscleGroupSummary({
      buckets: [{ bucket_start: '2026-11-08T23:00:00.000Z', series: { Chest: 5 } }],
      now,
      period_days: 7,
    })
    expect(rows[0].this_week).toBe(5)
  })
})
