import type { FeedStructuredActivity } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { structuredChartSeries } from './timeline-structured'

const sample = (start: string, avg: number) => ({ avg, count: 1, end: start, max: avg, min: avg, start })

const structured = (over: Partial<FeedStructuredActivity> = {}): FeedStructuredActivity => ({
  activity_type: 'exercise',
  kind: 'activity',
  metrics: [],
  series: [],
  start_time: '2026-07-01T08:00:00.000Z',
  ...over,
})

describe('structuredChartSeries', () => {
  test('maps a series to a labelled, coloured {date,value}[] line (start → avg)', () => {
    const result = structuredChartSeries(
      structured({
        series: [
          {
            bucket: '5s',
            metric: 'heart_rate',
            samples: [sample('2026-07-01T08:00:00.000Z', 140), sample('2026-07-01T08:00:05.000Z', 145)],
            unit: 'bpm',
          },
        ],
      }),
    )
    expect(result).toEqual([
      {
        color: '#ef4444',
        data: [
          { date: '2026-07-01T08:00:00.000Z', value: 140 },
          { date: '2026-07-01T08:00:05.000Z', value: 145 },
        ],
        label: 'Heart rate',
        metric: 'heart_rate',
      },
    ])
  })

  test('drops a series with fewer than two samples (a line needs two points)', () => {
    const result = structuredChartSeries(
      structured({
        series: [
          {
            bucket: '5s',
            metric: 'heart_rate',
            samples: [sample('2026-07-01T08:00:00.000Z', 140)],
            unit: 'bpm',
          },
        ],
      }),
    )
    expect(result).toEqual([])
  })

  test('falls back to a prettified label + neutral colour for an unknown metric', () => {
    const result = structuredChartSeries(
      structured({
        series: [
          {
            bucket: '5s',
            metric: 'core_temp',
            samples: [sample('2026-07-01T08:00:00.000Z', 37), sample('2026-07-01T08:00:05.000Z', 37.2)],
          },
        ],
      }),
    )
    expect(result[0].label).toBe('Core temp')
    expect(result[0].color).toBe('#6366f1')
  })

  test('returns an empty array when there are no series', () => {
    expect(structuredChartSeries(structured())).toEqual([])
  })

  test('returns an empty array for an article post (rendered by TimelineArticle instead)', () => {
    expect(structuredChartSeries({ blocks: [], kind: 'article', title: 'My analysis' })).toEqual([])
  })
})
