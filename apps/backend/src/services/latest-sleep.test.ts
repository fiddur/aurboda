import { describe, expect, test } from 'vitest'

import type { MergedActivity } from '../db/types.ts'

import {
  buildLatestSleep,
  computeStageMinutes,
  computeTotalSleepMinutes,
  getLatestSleep,
  type LatestSleepDeps,
  parseStageSegments,
  pickLatestSleep,
  wakeDayRange,
} from './latest-sleep.ts'

const sleep = (id: string, start: string, end: string, data?: Record<string, unknown>): MergedActivity => ({
  activity_type: 'sleep',
  data,
  end_time: new Date(end),
  id,
  source: 'garmin',
  start_time: new Date(start),
})

const stage = (startTime: string, endTime: string, s: number) => ({ endTime, stage: s, startTime })

describe('pickLatestSleep', () => {
  const now = new Date('2026-09-25T09:00:00Z')

  test('picks the newest wake-up within 36 hours', () => {
    const picked = pickLatestSleep(
      [
        sleep('a', '2026-09-23T22:00:00Z', '2026-09-24T06:00:00Z'),
        sleep('b', '2026-09-24T22:00:00Z', '2026-09-25T06:00:00Z'),
        sleep('c', '2026-09-25T13:00:00Z', '2026-09-25T14:00:00Z'),
      ],
      now,
    )
    expect(picked?.id).toBe('b')
  })

  test('ignores sleep that ended more than 36 hours ago or is still ongoing', () => {
    expect(
      pickLatestSleep(
        [
          sleep('old', '2026-09-23T13:00:00Z', '2026-09-23T20:00:00Z'),
          { ...sleep('open', '2026-09-25T01:00:00Z', '2026-09-25T02:00:00Z'), end_time: undefined },
        ],
        now,
      ),
    ).toBeUndefined()
  })
})

describe('parseStageSegments', () => {
  test('keeps valid stages, maps to snake_case and sorts by start', () => {
    expect(
      parseStageSegments({
        stages: [
          stage('2026-09-25T01:00:00Z', '2026-09-25T02:00:00Z', 5),
          stage('2026-09-25T00:00:00Z', '2026-09-25T01:00:00Z', 4),
          stage('2026-09-25T02:00:00Z', '2026-09-25T03:00:00Z', 9),
          stage('bad', '2026-09-25T03:00:00Z', 4),
          stage('2026-09-25T03:00:00Z', '2026-09-25T03:00:00Z', 1),
          null,
        ],
      }),
    ).toEqual([
      { end_time: '2026-09-25T01:00:00.000Z', stage: 4, start_time: '2026-09-25T00:00:00.000Z' },
      { end_time: '2026-09-25T02:00:00.000Z', stage: 5, start_time: '2026-09-25T01:00:00.000Z' },
    ])
  })

  test('returns [] without stages', () => {
    expect(parseStageSegments(undefined)).toEqual([])
    expect(parseStageSegments({ stages: 'x' })).toEqual([])
  })
})

describe('computeStageMinutes', () => {
  test('sums stage timeline minutes', () => {
    const stages = parseStageSegments({
      stages: [
        stage('2026-09-25T00:00:00Z', '2026-09-25T01:00:00Z', 4),
        stage('2026-09-25T01:00:00Z', '2026-09-25T01:30:00Z', 5),
        stage('2026-09-25T01:30:00Z', '2026-09-25T01:40:00Z', 1),
        stage('2026-09-25T01:40:00Z', '2026-09-25T02:05:00Z', 6),
        stage('2026-09-25T02:05:00Z', '2026-09-25T02:20:00Z', 4),
      ],
    })
    expect(computeStageMinutes(stages, undefined)).toEqual({ awake: 10, deep: 30, light: 75, rem: 25 })
  })

  test('falls back to Garmin per-stage seconds', () => {
    expect(
      computeStageMinutes([], { awake_seconds: 600, deep_sleep_seconds: 3600, light_sleep_seconds: 7200 }),
    ).toEqual({ awake: 10, deep: 60, light: 120, rem: 0 })
  })

  test('undefined when nothing is known', () => {
    expect(computeStageMinutes([], { sleep_score: 80 })).toBeUndefined()
  })
})

describe('computeTotalSleepMinutes', () => {
  test('prefers stage data', () => {
    const data = { stages: [stage('2026-09-25T00:00:00Z', '2026-09-25T02:00:00Z', 4)] }
    expect(computeTotalSleepMinutes(data, { awake: 0, deep: 1, light: 1, rem: 1 })).toBe(120)
  })

  test('falls back to deep + light + REM', () => {
    expect(computeTotalSleepMinutes({}, { awake: 10, deep: 60, light: 200, rem: 90 })).toBe(350)
  })

  test('undefined without data', () => {
    expect(computeTotalSleepMinutes(undefined, undefined)).toBeUndefined()
  })
})

describe('wakeDayRange', () => {
  test('uses the local calendar date of the wake-up', () => {
    const range = wakeDayRange(new Date('2026-09-24T21:30:00Z'), 'Australia/Sydney')
    expect(range.start.toISOString()).toBe('2026-09-25T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-09-25T23:59:59.999Z')
  })

  test('defaults to UTC and survives an invalid timezone', () => {
    expect(wakeDayRange(new Date('2026-09-24T21:30:00Z'), undefined).start.toISOString()).toBe(
      '2026-09-24T00:00:00.000Z',
    )
    expect(wakeDayRange(new Date('2026-09-24T21:30:00Z'), 'Not/AZone').start.toISOString()).toBe(
      '2026-09-24T00:00:00.000Z',
    )
  })
})

describe('buildLatestSleep', () => {
  const activity = {
    ...sleep('s1', '2026-09-24T22:00:00Z', '2026-09-25T06:00:00Z', { sleep_score: 82 }),
    end_time: new Date('2026-09-25T06:00:00Z'),
    id: 's1',
  }
  const wakeDay = wakeDayRange(activity.end_time, 'UTC')

  test('assembles vitals from night and wake-day series', () => {
    const result = buildLatestSleep(activity, {
      baseline: [
        { avg: 48.26, count: 30, max: 0, metric: 'resting_heart_rate', min: 0, stddev: 0, unit: 'bpm' },
        { avg: 55.04, count: 30, max: 0, metric: 'hrv_rmssd', min: 0, stddev: 0, unit: 'ms' },
      ],
      series: {
        body_battery: [
          [new Date('2026-09-24T21:00:00Z'), 5],
          [new Date('2026-09-24T22:00:00Z'), 20],
          [new Date('2026-09-25T06:00:00Z'), 85],
          [new Date('2026-09-25T08:00:00Z'), 80],
        ],
        hrv_rmssd: [[new Date('2026-09-25T12:00:00Z'), 61]],
        resting_heart_rate: [[new Date('2026-09-25T12:00:00Z'), 47]],
        sleep_score: [[new Date('2026-09-25T12:00:00Z'), 70]],
      },
      wakeDay,
    })
    expect(result).toMatchObject({
      activity_id: 's1',
      body_battery_end: 85,
      body_battery_start: 20,
      hrv: 61,
      hrv_baseline: 55,
      resting_hr: 47,
      resting_hr_baseline: 48.3,
      sleep_score: 82,
      stages: [],
      time_in_bed_min: 480,
    })
    expect(result.total_sleep_min).toBeUndefined()
  })

  test('prefers HRV samples inside the night and the score metric when data has none', () => {
    const result = buildLatestSleep(
      { ...activity, data: {} },
      {
        baseline: [],
        series: {
          hrv_rmssd: [
            [new Date('2026-09-25T01:00:00Z'), 40],
            [new Date('2026-09-25T02:00:00Z'), 51],
            [new Date('2026-09-25T12:00:00Z'), 61],
          ],
          sleep_score: [[new Date('2026-09-25T12:00:00Z'), 70]],
        },
        wakeDay,
      },
    )
    expect(result.hrv).toBe(46)
    expect(result.sleep_score).toBe(70)
    expect(result.hrv_baseline).toBeUndefined()
    expect(result.body_battery_start).toBeUndefined()
  })
})

describe('getLatestSleep', () => {
  const now = new Date('2026-09-25T09:00:00Z')

  const deps = (sessions: MergedActivity[]): LatestSleepDeps & { calls: unknown[][] } => {
    const calls: unknown[][] = []
    return {
      calls,
      getSleepSessions: async () => sessions,
      getTimeSeriesMultiMetric: async (...args) => {
        calls.push(['series', ...args.slice(1)])
        return { resting_heart_rate: [[new Date('2026-09-25T12:00:00Z'), 50]] }
      },
      getTimeSeriesStats: async (...args) => {
        calls.push(['stats', ...args.slice(1)])
        return []
      },
      getTimezone: async () => 'Europe/Stockholm',
    }
  }

  test('null without a recent sleep', async () => {
    expect(await getLatestSleep('u', now, deps([]))).toBeNull()
  })

  test('queries the night, the wake day and the 30 days before', async () => {
    const d = deps([sleep('s', '2026-09-24T21:00:00Z', '2026-09-25T05:00:00Z')])
    const result = await getLatestSleep('u', now, d)
    expect(result?.resting_hr).toBe(50)
    expect(d.calls).toContainEqual([
      'series',
      ['sleep_score', 'resting_heart_rate', 'hrv_rmssd', 'body_battery'],
      new Date('2026-09-24T21:00:00Z'),
      new Date('2026-09-25T23:59:59.999Z'),
    ])
    expect(d.calls).toContainEqual([
      'stats',
      ['resting_heart_rate', 'hrv_rmssd'],
      new Date('2026-08-25T21:00:00Z'),
      new Date('2026-09-24T21:00:00Z'),
    ])
  })
})
