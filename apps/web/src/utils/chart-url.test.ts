import { describe, expect, test } from 'vitest'

import { buildChartUrl } from './chart-url'

const params = (url: string) => new URLSearchParams(url.split('?')[1])

describe('buildChartUrl', () => {
  test('serializes core trend params', () => {
    const p = params(
      buildChartUrl({
        chart_type: 'trend',
        display_period: 'monthly',
        half_life_days: 30,
        lookback_days: 90,
        pattern: 'coffee',
        source_type: 'activity_type',
      }),
    )
    expect(p.get('source_type')).toBe('activity_type')
    expect(p.get('pattern')).toBe('coffee')
    expect(p.get('chart_type')).toBe('trend')
    expect(p.get('display_period')).toBe('monthly')
    expect(p.get('half_life_days')).toBe('30')
  })

  test('omits origin params when no origin is given', () => {
    const p = params(buildChartUrl({ chart_type: 'trend', pattern: 'coffee', source_type: 'activity_type' }))
    expect(p.has('board_id')).toBe(false)
    expect(p.has('section_id')).toBe(false)
    expect(p.has('widget_id')).toBe(false)
  })

  test('carries breakdown_fields as a comma-separated list', () => {
    const p = params(
      buildChartUrl({
        breakdown_fields: ['partner', 'mood'],
        chart_type: 'trend',
        pattern: 'intimacy',
        source_type: 'activity_type',
      }),
    )
    expect(p.get('breakdown_fields')).toBe('partner,mood')
  })

  test('omits breakdown_fields when empty', () => {
    const p = params(
      buildChartUrl({
        breakdown_fields: [],
        chart_type: 'trend',
        pattern: 'intimacy',
        source_type: 'activity_type',
      }),
    )
    expect(p.has('breakdown_fields')).toBe(false)
  })

  test('carries the board-chart origin when provided', () => {
    const p = params(
      buildChartUrl({
        chart_type: 'trend',
        origin: { board_id: 'home', section_id: 'sec-1', widget_id: 'w-1' },
        pattern: 'coffee',
        source_type: 'activity_type',
      }),
    )
    expect(p.get('board_id')).toBe('home')
    expect(p.get('section_id')).toBe('sec-1')
    expect(p.get('widget_id')).toBe('w-1')
  })

  test('carries missing_days for metric trends', () => {
    const p = params(
      buildChartUrl({
        aggregation: 'sum',
        chart_type: 'trend',
        missing_days: 'zero',
        pattern: 'ibuprofen_mg',
        source_type: 'metric',
      }),
    )
    expect(p.get('missing_days')).toBe('zero')
    expect(p.get('aggregation')).toBe('sum')
  })

  test('omits missing_days when absent, for bar charts and for other sources', () => {
    const absent = params(buildChartUrl({ chart_type: 'trend', pattern: 'weight', source_type: 'metric' }))
    expect(absent.has('missing_days')).toBe(false)

    const bar = params(
      buildChartUrl({ chart_type: 'bar', missing_days: 'skip', pattern: 'weight', source_type: 'metric' }),
    )
    expect(bar.has('missing_days')).toBe(false)

    const activity = params(
      buildChartUrl({
        chart_type: 'trend',
        missing_days: 'skip',
        pattern: 'coffee',
        source_type: 'activity_type',
      }),
    )
    expect(activity.has('missing_days')).toBe(false)
  })

  test('keeps count for metrics, whose default is mean', () => {
    const metric = params(
      buildChartUrl({ aggregation: 'count', chart_type: 'trend', pattern: 'weight', source_type: 'metric' }),
    )
    expect(metric.get('aggregation')).toBe('count')

    const activity = params(
      buildChartUrl({
        aggregation: 'count',
        chart_type: 'trend',
        pattern: 'coffee',
        source_type: 'activity_type',
      }),
    )
    expect(activity.has('aggregation')).toBe(false)
  })
})
