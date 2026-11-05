import type {
  FeedStructuredActivity,
  FeedStructuredExerciseShare,
  FeedStructuredPost,
} from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  structuredCombinedSeries,
  structuredHasNativeExerciseChart,
  structuredHasNativeHrChart,
  structuredHasNativeMap,
  structuredRoutePoints,
  timelineImageVisible,
} from './timeline-structured'

const sample = (start: string, end: string, avg: number) => ({
  avg,
  count: 1,
  end,
  max: avg,
  min: avg,
  start,
})

const hrSeries = {
  bucket: '5s',
  metric: 'heartRate',
  samples: [
    sample('2026-07-01T08:00:00.000Z', '2026-07-01T08:00:10.000Z', 140),
    sample('2026-07-01T08:00:10.000Z', '2026-07-01T08:00:20.000Z', 145),
  ],
  unit: 'bpm',
}

const route = [
  { lat: 59.33, lon: 18.06, t: '2026-07-01T08:00:00.000Z' },
  { lat: 59.34, lon: 18.07, t: '2026-07-01T08:10:00.000Z' },
]

const structured = (over: Partial<FeedStructuredActivity> = {}): FeedStructuredActivity => ({
  activityType: 'exercise',
  kind: 'activity',
  metrics: [],
  series: [],
  startTime: '2026-07-01T08:00:00.000Z',
  ...over,
})

const article: FeedStructuredPost = { blocks: [], kind: 'article', title: 'My analysis' }

const challenge: FeedStructuredPost = {
  challenge: {
    endTime: '2026-12-01T00:00:00.000Z',
    host: { name: 'freja', url: 'https://qs.example/u/freja' },
    kind: 'challenge',
    metric: 'steps',
    name: 'November steps',
    scoring: 'sum',
    startTime: '2026-11-01T00:00:00.000Z',
    timezone: 'UTC',
    url: 'https://qs.example/u/freja/nov',
  },
  kind: 'challenge',
}

describe('structuredCombinedSeries', () => {
  test('maps samples to [bucket midpoint, avg] chart points, carrying the unit and the internal metric name', () => {
    const result = structuredCombinedSeries(structured({ series: [hrSeries] }))
    expect(result).toEqual([
      {
        data: [
          [new Date('2026-07-01T08:00:05.000Z'), 140],
          [new Date('2026-07-01T08:00:15.000Z'), 145],
        ],
        metric: 'heart_rate',
        unit: 'bpm',
      },
    ])
  })

  test('drops a series with fewer than two samples (a line needs two points)', () => {
    const oneSample = { ...hrSeries, samples: hrSeries.samples.slice(0, 1) }
    expect(structuredCombinedSeries(structured({ series: [oneSample] }))).toEqual([])
  })

  test('is empty for an article or challenge post and for no payload at all', () => {
    expect(structuredCombinedSeries(article)).toEqual([])
    expect(structuredCombinedSeries(challenge)).toEqual([])
    expect(structuredCombinedSeries(undefined)).toEqual([])
  })
})

describe('structuredRoutePoints', () => {
  test('parses route timestamps to Dates for the map', () => {
    expect(structuredRoutePoints(structured({ route }))).toEqual([
      { lat: 59.33, lon: 18.06, time: new Date('2026-07-01T08:00:00.000Z') },
      { lat: 59.34, lon: 18.07, time: new Date('2026-07-01T08:10:00.000Z') },
    ])
  })

  test('is empty without a route, for an article, and without a payload', () => {
    expect(structuredRoutePoints(structured())).toEqual([])
    expect(structuredRoutePoints(article)).toEqual([])
    expect(structuredRoutePoints(challenge)).toEqual([])
    expect(structuredRoutePoints(undefined)).toEqual([])
  })
})

const exercise = (data: Partial<FeedStructuredExerciseShare['data']> = {}): FeedStructuredExerciseShare => ({
  activity_type: 'strength_training',
  activity_type_name: 'Strength training',
  data: { done: null, history: [], per_week: null, records: [], trend: null, ...data },
  kind: 'exercise',
  name: 'Bench Press',
})

const exerciseTrend = {
  half_life_days: 30,
  history: [
    { date: '2026-07-01', value: 40 },
    { date: '2026-07-08', value: 42 },
  ],
  measure: 'e1rm' as const,
}

describe('exercise payload', () => {
  test('has no activity series or route', () => {
    const post = exercise({ trend: exerciseTrend })
    expect(structuredCombinedSeries(post)).toEqual([])
    expect(structuredRoutePoints(post)).toEqual([])
    expect(structuredHasNativeHrChart(post)).toBe(false)
    expect(structuredHasNativeMap(post)).toBe(false)
  })

  test('draws its chart natively only with a trend or weekly series', () => {
    expect(structuredHasNativeExerciseChart(exercise({ trend: exerciseTrend }))).toBe(true)
    expect(structuredHasNativeExerciseChart(exercise())).toBe(false)
    expect(structuredHasNativeExerciseChart(structured())).toBe(false)
    expect(structuredHasNativeExerciseChart(undefined)).toBe(false)
  })
})

describe('native-render predicates', () => {
  test('HR chart: only a drawable heart-rate series counts — not another metric (#1001)', () => {
    expect(structuredHasNativeHrChart(structured({ series: [hrSeries] }))).toBe(true)
    expect(structuredHasNativeHrChart(structured({ series: [{ ...hrSeries, metric: 'heart_rate' }] }))).toBe(
      true,
    )
    expect(structuredHasNativeHrChart(structured({ series: [{ ...hrSeries, metric: 'power' }] }))).toBe(false)
    expect(
      structuredHasNativeHrChart(
        structured({ series: [{ ...hrSeries, samples: hrSeries.samples.slice(0, 1) }] }),
      ),
    ).toBe(false)
    expect(structuredHasNativeHrChart(undefined)).toBe(false)
    expect(structuredHasNativeHrChart(challenge)).toBe(false)
  })

  test('map: needs at least two route points', () => {
    expect(structuredHasNativeMap(structured({ route }))).toBe(true)
    expect(structuredHasNativeMap(structured({ route: route.slice(0, 1) }))).toBe(false)
    expect(structuredHasNativeMap(structured())).toBe(false)
    expect(structuredHasNativeMap(undefined)).toBe(false)
    expect(structuredHasNativeMap(challenge)).toBe(false)
  })
})

describe('timelineImageVisible', () => {
  test('keeps every image when the post has no structured payload', () => {
    expect(timelineImageVisible(undefined, 'Heart rate')).toBe(true)
    expect(timelineImageVisible(undefined, 'Route')).toBe(true)
  })

  test('hides every image for an article or a challenge (rendered fully natively)', () => {
    expect(timelineImageVisible(article, 'anything')).toBe(false)
    expect(timelineImageVisible(challenge, 'Standings')).toBe(false)
  })

  test('hides exactly the image whose native counterpart draws', () => {
    const both = structured({ route, series: [hrSeries] })
    expect(timelineImageVisible(both, 'Heart rate')).toBe(false)
    expect(timelineImageVisible(both, 'Route')).toBe(false)

    const neither = structured({ series: [{ ...hrSeries, metric: 'power' }] })
    expect(timelineImageVisible(neither, 'Heart rate')).toBe(true)
    expect(timelineImageVisible(neither, 'Route')).toBe(true)
  })

  test("hides an exercise's Trend image exactly when the card draws the chart", () => {
    expect(timelineImageVisible(exercise({ trend: exerciseTrend }), 'Trend')).toBe(false)
    expect(timelineImageVisible(exercise(), 'Trend')).toBe(true)
    expect(timelineImageVisible(exercise({ trend: exerciseTrend }), 'sunset.jpg')).toBe(true)
  })

  test('keeps a non-Aurboda image (e.g. a Mastodon photo) regardless', () => {
    expect(timelineImageVisible(structured({ route, series: [hrSeries] }), 'sunset.jpg')).toBe(true)
    expect(timelineImageVisible(structured(), undefined)).toBe(true)
  })
})
