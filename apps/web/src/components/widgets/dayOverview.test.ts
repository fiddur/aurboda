import { isSleepType } from '@aurboda/api-spec'
import { describe, expect, it } from 'vitest'

import { CHART_PRIMARY } from '../../theme'
import { STRESS_BAND_COLORS } from '../charts/stress-bands'
import {
  averageValue,
  barColor,
  clipSpans,
  collapseIcons,
  contiguousRuns,
  dayOverviewEmptyMessage,
  dayOverviewRange,
  dayStatus,
  formatAt,
  formatRangeLabel,
  hourTicks,
  latestValue,
  metricSeries,
  resolveDayOverviewConfig,
  valueDomain,
} from './dayOverview'

const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)

describe('resolveDayOverviewConfig', () => {
  it('fills in the defaults', () => {
    expect(resolveDayOverviewConfig({})).toEqual({
      barMetric: 'stress_level',
      lineMetric: 'body_battery',
      title: 'Last 24 hours',
      window: 'rolling_24h',
    })
  })

  it('titles by window and keeps a single metric without a line', () => {
    expect(resolveDayOverviewConfig({ metrics: ['heart_rate'], window: 'yesterday' })).toEqual({
      barMetric: 'heart_rate',
      lineMetric: undefined,
      title: 'Yesterday',
      window: 'yesterday',
    })
    expect(resolveDayOverviewConfig({ title: 'My day', window: 'today' }).title).toBe('My day')
  })

  it('names the empty state by window', () => {
    expect(dayOverviewEmptyMessage('rolling_24h')).toBe('No data for the last 24 hours')
  })
})

describe('dayOverviewRange', () => {
  const now = local(15, 9, 30)

  it('rolling_24h is the 24 hours up to now', () => {
    expect(dayOverviewRange('rolling_24h', now)).toEqual({ end: now, start: local(14, 9, 30) })
  })

  it('yesterday is the whole previous local day', () => {
    expect(dayOverviewRange('yesterday', now)).toEqual({ end: local(15, 0), start: local(14, 0) })
  })

  it('today runs from midnight to the next', () => {
    expect(dayOverviewRange('today', now)).toEqual({ end: local(16, 0), start: local(15, 0) })
  })
})

describe('barColor', () => {
  it('colours stress by its band', () => {
    expect(barColor('stress_level', 10)).toBe(STRESS_BAND_COLORS.rest)
    expect(barColor('stress_level', 40)).toBe(STRESS_BAND_COLORS.low)
    expect(barColor('stress_level', 60)).toBe(STRESS_BAND_COLORS.medium)
    expect(barColor('stress_level', 90)).toBe(STRESS_BAND_COLORS.high)
  })

  it('draws any other metric in the accent colour', () => {
    expect(barColor('heart_rate', 60)).toBe(CHART_PRIMARY)
  })
})

describe('valueDomain', () => {
  it('fixes stress and Body Battery to 0–100', () => {
    expect(valueDomain('body_battery', [5, 40])).toEqual([0, 100])
    expect(valueDomain('stress_level', [])).toEqual([0, 100])
  })

  it('runs from zero to the maximum otherwise', () => {
    expect(valueDomain('heart_rate', [50, 120])).toEqual([0, 120])
    expect(valueDomain('heart_rate', [])).toEqual([0, 1])
  })
})

describe('metricSeries and runs', () => {
  const bucket = (hour: number, metrics: Record<string, number>) => ({
    end: local(15, hour, 5),
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([k, avg]) => [
        k,
        { avg, count: 1, first_time: '', last_time: '', max: avg, min: avg },
      ]),
    ),
    start: local(15, hour, 0),
  })

  it('takes one metric per bucket and leaves out buckets without it', () => {
    const series = metricSeries(
      [bucket(1, { stress_level: 20 }), bucket(2, { body_battery: 50 }), bucket(3, { stress_level: 30 })],
      'stress_level',
    )
    expect(series.map((p) => p.value)).toEqual([20, 30])
    expect(latestValue(series)).toBe(30)
    expect(averageValue(series)).toBe(25)
    expect(averageValue([])).toBeUndefined()
  })

  it('breaks a line where buckets stop being adjacent', () => {
    const point = (h: number, m: number) => ({ end: local(15, h, m + 5), start: local(15, h, m), value: 1 })
    const runs = contiguousRuns([point(1, 0), point(1, 5), point(2, 0)])
    expect(runs.map((r) => r.length)).toEqual([2, 1])
  })
})

describe('clipSpans', () => {
  const range = { end: local(15, 0), start: local(14, 0) }

  it('clips sleep at the window edges', () => {
    const [night, nap] = clipSpans(
      [
        { end_time: local(14, 7), start_time: local(13, 23) },
        { end_time: local(14, 14), start_time: local(14, 13) },
      ],
      range,
    )
    expect(night).toEqual({ end_time: local(14, 7), start_time: local(14, 0) })
    expect(nap).toEqual({ end_time: local(14, 14), start_time: local(14, 13) })
  })

  it('drops spans outside the window or without an end', () => {
    expect(
      clipSpans([{ end_time: local(13, 7), start_time: local(13, 1) }, { start_time: local(14, 3) }], range),
    ).toEqual([])
  })
})

describe('collapseIcons', () => {
  it('keeps icons apart that do not overlap', () => {
    const groups = collapseIcons([{ x: 50 }, { x: 10 }], 20)
    expect(groups.map((g) => [g.x, g.items.length])).toEqual([
      [10, 1],
      [50, 1],
    ])
  })

  it('merges overlapping icons into the group before', () => {
    const groups = collapseIcons([{ x: 10 }, { x: 15 }, { x: 25 }, { x: 40 }], 20)
    expect(groups.map((g) => [g.x, g.items.length])).toEqual([
      [10, 3],
      [40, 1],
    ])
  })
})

describe('hourTicks', () => {
  it('ticks every 3 hours on whole local hours, every 6 when narrow', () => {
    const range = { end: local(15, 9, 30), start: local(14, 9, 30) }
    expect(hourTicks(range, 800).map((d) => d.getHours())).toEqual([12, 15, 18, 21, 0, 3, 6, 9])
    expect(hourTicks(range, 360).map((d) => d.getHours())).toEqual([12, 18, 0, 6])
  })
})

describe('in the owner timezone', () => {
  const at = new Date('2026-03-14T23:30:00.000Z')

  it('formats hours, times and days in the given zone', () => {
    expect(formatAt(at, 'HH', 'Asia/Tokyo')).toBe('08')
    expect(formatAt(at, 'HH:mm', 'Asia/Tokyo')).toBe('08:30')
    expect(formatAt(at, 'HH:mm', 'America/New_York')).toBe('19:30')
    expect(formatAt(at, 'EEE d MMM HH:mm', 'Asia/Tokyo')).toBe('Sun 15 Mar 08:30')
    expect(formatAt(at, 'EEEE d MMMM', 'America/New_York')).toBe('Saturday 14 March')
  })

  it('labels the range in the given zone', () => {
    const range = { end: at, start: new Date(at.getTime() - 24 * 3_600_000) }
    expect(formatRangeLabel('rolling_24h', range, 'Asia/Tokyo')).toBe('Sat 14 Mar 08:30 – Sun 15 Mar 08:30')
    expect(formatRangeLabel('today', range, 'America/New_York')).toBe('Friday 13 March')
  })

  it('ticks on whole hours of the given zone, also with a half-hour offset', () => {
    const range = { end: new Date('2026-03-15T12:00:00.000Z'), start: new Date('2026-03-15T00:00:00.000Z') }
    const hoursIn = (tz: string) => hourTicks(range, 800, tz).map((d) => formatAt(d, 'HH:mm', tz))
    expect(hoursIn('Asia/Tokyo')).toEqual(['09:00', '12:00', '15:00', '18:00', '21:00'])
    expect(hoursIn('Asia/Kolkata')).toEqual(['06:00', '09:00', '12:00', '15:00'])
  })
})

describe('isSleepType', () => {
  it('counts sleep, naps and sleep subtypes', () => {
    expect(isSleepType('sleep', undefined)).toBe(true)
    expect(isSleepType('nap', undefined)).toBe(true)
    expect(isSleepType('power_nap', 'sleep')).toBe(true)
    expect(isSleepType('running', 'exercise')).toBe(false)
  })
})

describe('dayStatus', () => {
  const none = { activities: false, metrics: false }
  const loaded = { bars: [1], icons: [] }
  const nothing = { bars: [], icons: [] }

  it('is loading while either query loads', () => {
    expect(dayStatus(true, none, loaded)).toEqual({ status: 'loading' })
  })

  it('fails only when both queries failed', () => {
    expect(dayStatus(false, { activities: true, metrics: true }, nothing)).toEqual({ status: 'failed' })
  })

  it('shows what loaded with a hint when the metrics failed', () => {
    expect(dayStatus(false, { activities: false, metrics: true }, { bars: [], icons: [1] })).toEqual({
      hint: 'The metrics could not be loaded',
      status: 'ready',
    })
  })

  it('shows what loaded with a hint when the activities failed', () => {
    expect(dayStatus(false, { activities: true, metrics: false }, loaded)).toEqual({
      hint: 'The activities could not be loaded',
      status: 'ready',
    })
  })

  it('is empty without a hint when nothing failed and nothing loaded', () => {
    expect(dayStatus(false, none, nothing)).toEqual({ status: 'empty' })
  })
})
