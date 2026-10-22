import { describe, expect, test, vi } from 'vitest'

import { type MetricStat, resolveSharedScalars } from './scalars.ts'

const window = {
  endTime: new Date('2026-07-01T07:11:03Z'),
  startTime: new Date('2026-07-01T06:30:00Z'),
}

// A metricStat backed by a fixed table of window aggregates.
const statFrom =
  (table: Record<string, Partial<Record<'avg' | 'max' | 'sum', number>>>): MetricStat =>
  (metric, stat) =>
    table[metric]?.[stat]

describe('resolveSharedScalars', () => {
  test('resolves duration from the activity window', () => {
    const out = resolveSharedScalars(window, ['duration'], statFrom({}))
    expect(out).toEqual([{ key: 'duration', label: 'Duration', unit: 'seconds', value: 2463 }])
  })

  test('omits duration for an open-ended activity', () => {
    const out = resolveSharedScalars({ startTime: window.startTime }, ['duration'], statFrom({}))
    expect(out).toEqual([])
  })

  test('resolves and rounds metric-backed scalars with units', () => {
    const stat = statFrom({
      calories_active: { sum: 431.7 },
      distance: { sum: 8231 },
      heart_rate: { avg: 148.6, max: 172 },
      stress_level: { avg: 33.4 },
    })
    const out = resolveSharedScalars(
      window,
      ['heart_rate_avg', 'heart_rate_max', 'stress_avg', 'distance', 'calories'],
      stat,
    )
    expect(out).toEqual([
      { key: 'heart_rate_avg', label: 'Avg HR', unit: 'bpm', value: 149 },
      { key: 'heart_rate_max', label: 'Max HR', unit: 'bpm', value: 172 },
      { key: 'stress_avg', label: 'Avg stress', unit: 'score', value: 33 },
      { key: 'distance', label: 'Distance', unit: 'km', value: 8.23 }, // meters → km, 2dp
      { key: 'calories', label: 'Calories', unit: 'kcal', value: 432 },
    ])
  })

  test('builds hr_zone_minutes from zone-second sums, skipping empty zones', () => {
    const stat = statFrom({
      hr_zone_1_sec: { sum: 180 }, // 3 min
      hr_zone_2_sec: { sum: 1320 }, // 22 min
      hr_zone_3_sec: { sum: 650 }, // ~11 min
      hr_zone_5_sec: { sum: 0 }, // skipped (no time)
    })
    const out = resolveSharedScalars(window, ['hr_zone_minutes'], stat)
    expect(out).toEqual([
      { key: 'hr_zone_minutes', label: 'HR zone minutes', value: { z1: 3, z2: 22, z3: 11 } },
    ])
  })

  test('skips unsupported keys and metrics with no data', () => {
    const stat = statFrom({ heart_rate: { avg: 150 } })
    const out = resolveSharedScalars(window, ['made_up_key', 'stress_avg', 'heart_rate_avg'], stat)
    // made_up_key unsupported; stress_avg has no data; only heart_rate_avg resolves.
    expect(out).toEqual([{ key: 'heart_rate_avg', label: 'Avg HR', unit: 'bpm', value: 150 }])
  })

  describe('summary-field fallback for distance/calories (#1026)', () => {
    const summary = { calories: 512.4, distance: 10_234 }

    test('the window series wins over the summary field', () => {
      const stat = statFrom({ calories_active: { sum: 431.7 }, distance: { sum: 8231 } })
      const out = resolveSharedScalars(window, ['distance', 'calories'], stat, summary)
      expect(out).toEqual([
        { key: 'distance', label: 'Distance', unit: 'km', value: 8.23 },
        { key: 'calories', label: 'Calories', unit: 'kcal', value: 432 },
      ])
    })

    test("falls back to the activity's summary fields when the window has no series", () => {
      const out = resolveSharedScalars(window, ['distance', 'calories'], statFrom({}), summary)
      expect(out).toEqual([
        { key: 'distance', label: 'Distance', unit: 'km', value: 10.23 }, // metres → km, 2dp
        { key: 'calories', label: 'Calories', unit: 'kcal', value: 512 },
      ])
    })

    test('drops the key when neither the series nor the summary field has it', () => {
      expect(resolveSharedScalars(window, ['distance', 'calories'], statFrom({}), {})).toEqual([])
      expect(resolveSharedScalars(window, ['distance', 'calories'], statFrom({}))).toEqual([])
    })

    test.each([
      ['non-numeric', '10234'],
      ['negative', -5],
      ['zero', 0],
      ['non-finite', Number.POSITIVE_INFINITY],
      ['NaN', Number.NaN],
    ])('ignores a %s summary field', (_label, value) => {
      const out = resolveSharedScalars(window, ['distance', 'calories'], statFrom({}), {
        calories: value,
        distance: value,
      })
      expect(out).toEqual([])
    })

    test('never applies the summary fallback to other metric scalars', () => {
      const out = resolveSharedScalars(window, ['heart_rate_avg'], statFrom({}), { average_hr: 150 })
      expect(out).toEqual([])
    })
  })

  test('preserves the requested order and only asks for what was requested', () => {
    const metricStat = vi.fn<MetricStat>((_m, _s) => 100)
    const out = resolveSharedScalars(window, ['calories', 'heart_rate_avg'], metricStat)
    expect(out.map((s) => s.key)).toEqual(['calories', 'heart_rate_avg'])
    // Never queried unrelated metrics (e.g. distance/stress).
    const queried = metricStat.mock.calls.map(([m]) => m)
    expect(queried).toEqual(['calories_active', 'heart_rate'])
  })
})
