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
})
