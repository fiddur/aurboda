import { describe, expect, it } from 'vitest'

import type { Activity } from '../../state/api'
import type { ChartItem } from './types'

import {
  buildHrZoneBarHtml,
  buildSleepDetails,
  buildTooltipHtml,
  type SleepMetricsByDate,
} from './tooltipBuilder'

const makeChartItem = (overrides: Partial<ChartItem> = {}): ChartItem => ({
  color: '#333',
  column: 'Activity',
  end: new Date('2026-01-01T09:00:00Z'),
  isPoint: false,
  label: 'Test',
  start: new Date('2026-01-01T08:00:00Z'),
  tooltip: { details: ['1h'], time: '08:00 – 09:00', title: 'Test Activity' },
  ...overrides,
})

describe('buildHrZoneBarHtml', () => {
  it('returns empty string when total is zero', () => {
    expect(buildHrZoneBarHtml({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toBe('')
  })

  it('returns bar HTML with zone percentages', () => {
    const html = buildHrZoneBarHtml({ 0: 50, 1: 0, 2: 50, 3: 0, 4: 0, 5: 0 })
    expect(html).toContain('hr-zone-bar')
    expect(html).toContain('width:50%')
  })

  it('skips zones with 0 seconds', () => {
    const html = buildHrZoneBarHtml({ 0: 100, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
    // Only 1 span for zone 0
    expect(html.match(/<span/g)?.length).toBe(1)
  })
})

describe('buildSleepDetails', () => {
  const emptySleepMap: SleepMetricsByDate = new Map()

  it('includes bed duration', () => {
    const a = { start_time: new Date('2026-01-01T22:00:00Z') } as Activity
    const end = new Date('2026-01-02T06:00:00Z')
    const details = buildSleepDetails(a, end, emptySleepMap)
    expect(details).toContain('Bed: 8h')
  })

  it('includes total sleep when available', () => {
    const a = { start_time: new Date('2026-01-01T22:00:00Z'), total_sleep: 420 } as Activity
    const end = new Date('2026-01-02T06:00:00Z')
    const details = buildSleepDetails(a, end, emptySleepMap)
    expect(details).toContain('Sleep: 7h')
  })

  it('includes sleep metrics from map', () => {
    const sleepMap: SleepMetricsByDate = new Map([['2026-01-02', { sleep_score: 85.3 }]])
    const a = { start_time: new Date('2026-01-01T22:00:00Z') } as Activity
    const end = new Date('2026-01-02T06:00:00Z')
    const details = buildSleepDetails(a, end, sleepMap)
    expect(details).toContain('Score: 85')
  })

  it('includes avg HRV when available', () => {
    const a = { avg_hrv: 45, start_time: new Date('2026-01-01T22:00:00Z') } as Activity
    const end = new Date('2026-01-02T06:00:00Z')
    const details = buildSleepDetails(a, end, emptySleepMap)
    expect(details).toContain('Avg HRV: 45 ms')
  })
})

describe('buildTooltipHtml', () => {
  it('includes title and time', () => {
    const html = buildTooltipHtml(makeChartItem(), [], [])
    expect(html).toContain('Test Activity')
    expect(html).toContain('08:00 – 09:00')
  })

  it('includes tooltip details', () => {
    const html = buildTooltipHtml(makeChartItem(), [], [])
    expect(html).toContain('1h')
  })

  it('escapes HTML in title', () => {
    const item = makeChartItem({
      tooltip: { details: [], time: '08:00', title: '<script>alert(1)</script>' },
    })
    const html = buildTooltipHtml(item, [], [])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('includes music when present', () => {
    const html = buildTooltipHtml(makeChartItem(), ['Artist - Track'], [])
    expect(html).toContain('♪')
    expect(html).toContain('Artist - Track')
  })

  it('truncates music to 3 items', () => {
    const music = ['A', 'B', 'C', 'D', 'E']
    const html = buildTooltipHtml(makeChartItem(), music, [])
    expect(html).toContain('+2 more')
  })

  it('includes HR zone bar for exercise items', () => {
    const item = makeChartItem({ activity_type: 'exercise' })
    const activity = {
      activity_type: 'exercise',
      hr_zone_secs: { 0: 10, 1: 20, 2: 30, 3: 40, 4: 50, 5: 60 },
      start_time: new Date('2026-01-01T08:00:00Z'),
    } as unknown as Activity
    const html = buildTooltipHtml(item, [], [activity])
    expect(html).toContain('hr-zone-bar')
  })
})
