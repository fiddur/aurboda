import type { DashboardConfig, DashboardWidget, WidgetData } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import type { SharedDashboardRecord } from '../db/index.ts'
import type { PostChart } from './charts/post-chart-svg.ts'
import type { DashboardView } from './shared-dashboard-data.ts'

import { postChartSvg } from './charts/post-chart-svg.ts'
import {
  chartableWidgets,
  type DashboardChartDeps,
  loadPublicDashboardChartWith,
  widgetChart,
} from './dashboard-chart.ts'
import { PeriodError } from './periods.ts'

const optsOf = (chart: PostChart | null) => (chart?.type === 'line' ? chart.opts : undefined)

const trendWidget = (
  id: string,
  config: Partial<Extract<DashboardWidget, { type: 'trend_chart' }>['config']> = {},
): Extract<DashboardWidget, { type: 'trend_chart' }> => ({
  config: { pattern: 'running', source_type: 'activity_type', ...config },
  id,
  type: 'trend_chart',
})

const sparklineWidget = (
  id: string,
  config: Partial<Extract<DashboardWidget, { type: 'sparkline_card' }>['config']> = {},
): Extract<DashboardWidget, { type: 'sparkline_card' }> => ({
  config: { metric: 'steps', ...config },
  id,
  type: 'sparkline_card',
})

const metricWidget: DashboardWidget = {
  config: { metric: 'hrv_7day', title: 'HRV' },
  id: 'm1',
  type: 'metric_card',
}

const trendData = (values: number[]): WidgetData => ({
  data: {
    current_value: values.at(-1) ?? 0,
    history: values.map((value, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value })),
  },
  type: 'trend_chart',
})

const sparklineData = (values: number[]): WidgetData => ({
  data: {
    count: values.length,
    series: values.map((value, i) => ({ time: `2026-10-0${i + 1}T00:00:00.000Z`, value })),
    trend_percent: null,
    value: values.at(-1) ?? null,
  },
  type: 'sparkline_card',
})

const boardOf = (...widgets: DashboardWidget[]): DashboardConfig => ({
  sections: [{ id: 's1', title: 'Training', type: 'charts', widgets }],
  version: 1,
})

describe('chartableWidgets', () => {
  test('takes trend charts and sparkline cards in board order, at most three', () => {
    const config: DashboardConfig = {
      sections: [
        { id: 's1', title: 'A', type: 'metrics', widgets: [metricWidget, sparklineWidget('w1')] },
        {
          id: 's2',
          title: 'B',
          type: 'charts',
          widgets: [trendWidget('w2'), trendWidget('w3'), trendWidget('w4')],
        },
      ],
      version: 1,
    }
    const picked = chartableWidgets(config)
    expect(picked.map(({ widget }) => widget.id)).toEqual(['w1', 'w2', 'w3'])
    expect(picked.map(({ section }) => section.id)).toEqual(['s1', 's2', 's2'])
  })

  test('passes over bar charts and every other kind', () => {
    const bar: DashboardWidget = {
      config: { bucket_size: '1d', lookback_days: 30, pattern: 'steps', source_type: 'metric' },
      id: 'b1',
      type: 'bar_chart',
    }
    expect(chartableWidgets(boardOf(metricWidget, bar))).toEqual([])
  })
})

describe('widgetChart', () => {
  test('draws a trend chart’s history as a teal line under the widget’s title', () => {
    expect(widgetChart(trendWidget('w1', { title: 'Runs' }), trendData([2, 3, 4]))).toEqual({
      opts: { color: '#2b9ea7', label: 'Runs' },
      series: [
        [new Date('2026-10-01'), 2],
        [new Date('2026-10-02'), 3],
        [new Date('2026-10-03'), 4],
      ],
      type: 'line',
    })
  })

  test('captions an untitled trend like the web widget', () => {
    expect(optsOf(widgetChart(trendWidget('w1'), trendData([2, 3])))?.label).toBe('running trend')
    const bench = trendWidget('w1', { filter_value: 'Bench Press', measure: 'e1rm' })
    expect(optsOf(widgetChart(bench, trendData([2, 3])))?.label).toBe('Bench Press · Best e1RM')
  })

  test('draws a sparkline card’s series in its own colour, else the card’s blue', () => {
    expect(widgetChart(sparklineWidget('w1', { color: '#ff8800' }), sparklineData([1, 5]))).toEqual({
      opts: { color: '#ff8800', label: 'Steps' },
      series: [
        [new Date('2026-10-01T00:00:00.000Z'), 1],
        [new Date('2026-10-02T00:00:00.000Z'), 5],
      ],
      type: 'line',
    })
    expect(optsOf(widgetChart(sparklineWidget('w1'), sparklineData([1, 5])))?.color).toBe('#3b82f6')
  })

  test('takes no colour from the config that is not a plain hex colour', () => {
    const chart = widgetChart(sparklineWidget('w1', { color: '"/><script/>' }), sparklineData([1, 5]))
    expect(optsOf(chart)?.color).toBe('#3b82f6')
  })

  test('has none under two points, without data, or for a broken-down trend', () => {
    expect(widgetChart(trendWidget('w1'), trendData([2]))).toBeNull()
    expect(widgetChart(trendWidget('w1'), { data: null, type: 'trend_chart' })).toBeNull()
    expect(widgetChart(trendWidget('w1'), undefined)).toBeNull()
    expect(widgetChart(sparklineWidget('w1'), trendData([1, 2]))).toBeNull()
    expect(
      widgetChart(trendWidget('w1'), {
        data: {
          breakdown_histories: { A: [{ date: '2026-10-01', value: 1 }] },
          breakdown_series: ['A'],
          current_value: 0,
          history: [],
        },
        type: 'trend_chart',
      }),
    ).toBeNull()
  })

  test('renders bare: the line in its colour, and no text for librsvg to draw as tofu', () => {
    const chart = widgetChart(trendWidget('w1', { title: 'Runs' }), trendData([2, 3, 4]))!
    const svg = postChartSvg(chart, { bare: true, height: 150, width: 1000 })
    expect(svg).toContain('stroke="#2b9ea7"')
    expect(svg).toContain('<polyline')
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('Runs')
  })
})

const record = (overrides: Partial<SharedDashboardRecord> = {}): SharedDashboardRecord => ({
  config: boardOf(metricWidget, trendWidget('w1'), sparklineWidget('w2')),
  created_at: new Date('2026-09-01T00:00:00Z'),
  id: 'd1',
  is_private: false,
  is_public: true,
  name: 'Training',
  period_fixed: null,
  period_from: null,
  period_lock: 'latest',
  slug: 'abc',
  updated_at: new Date('2026-10-01T08:00:00Z'),
  ...overrides,
})

const viewOf = (widget_data: DashboardView['widget_data']): DashboardView => ({
  period: null,
  widget_data,
  window: null,
})

const depsWith = (overrides: Partial<DashboardChartDeps> = {}): DashboardChartDeps => ({
  getDashboard: vi.fn(async () => record()),
  getTimezone: vi.fn(async () => 'Europe/Stockholm'),
  now: () => new Date('2026-11-11T12:00:00Z'),
  resolveView: vi.fn(async (_user, config: DashboardConfig) => {
    const id = config.sections[0].widgets[0].id
    return viewOf({ [id]: id === 'w1' ? trendData([2, 3, 4]) : sparklineData([1, 5]) })
  }),
  ...overrides,
})

describe('loadPublicDashboardChartWith', () => {
  test('resolves only the first chartable widget when it draws', async () => {
    const deps = depsWith()
    const chart = await loadPublicDashboardChartWith(deps)('fiddur', 'abc')
    expect(optsOf(chart)?.color).toBe('#2b9ea7')
    expect(deps.resolveView).toHaveBeenCalledTimes(1)
    expect(deps.resolveView).toHaveBeenCalledWith(
      'fiddur',
      expect.objectContaining({
        sections: [expect.objectContaining({ id: 's1', widgets: [trendWidget('w1')] })],
      }),
      undefined,
    )
    expect(deps.getTimezone).not.toHaveBeenCalled()
  })

  test('moves on to the next chartable widget when one has nothing to draw', async () => {
    const deps = depsWith({
      resolveView: vi.fn(async (_user, config: DashboardConfig) => {
        const id = config.sections[0].widgets[0].id
        return viewOf({ [id]: id === 'w1' ? { data: null, type: 'trend_chart' } : sparklineData([1, 5]) })
      }),
    })
    const chart = await loadPublicDashboardChartWith(deps)('fiddur', 'abc')
    expect(optsOf(chart)?.label).toBe('Steps')
    expect(deps.resolveView).toHaveBeenCalledTimes(2)
  })

  test('resolves a period board over the period its lock shows', async () => {
    const config: DashboardConfig = { ...boardOf(trendWidget('w1')), period: { granularity: 'month' } }
    const latest = depsWith({ getDashboard: async () => record({ config }) })
    await loadPublicDashboardChartWith(latest)('fiddur', 'abc')
    expect(latest.resolveView).toHaveBeenCalledWith('fiddur', expect.anything(), '2026-10')

    const fixed = depsWith({
      getDashboard: async () => record({ config, period_fixed: '2026-03', period_lock: 'fixed' }),
    })
    await loadPublicDashboardChartWith(fixed)('fiddur', 'abc')
    expect(fixed.resolveView).toHaveBeenCalledWith('fiddur', expect.anything(), '2026-03')
  })

  test('has none for a board that is not public, or gone, and resolves nothing', async () => {
    for (const dashboard of [record({ is_public: false }), null]) {
      const deps = depsWith({ getDashboard: async () => dashboard })
      expect(await loadPublicDashboardChartWith(deps)('fiddur', 'abc')).toBeNull()
      expect(deps.resolveView).not.toHaveBeenCalled()
    }
  })

  test('has none for a board without a chartable widget, and resolves nothing', async () => {
    const deps = depsWith({ getDashboard: async () => record({ config: boardOf(metricWidget) }) })
    expect(await loadPublicDashboardChartWith(deps)('fiddur', 'abc')).toBeNull()
    expect(deps.resolveView).not.toHaveBeenCalled()
  })

  test('has none for a period the board cannot show, but lets other failures through', async () => {
    const periodError = depsWith({
      resolveView: vi.fn(async () => {
        throw new PeriodError('not_finished')
      }),
    })
    expect(await loadPublicDashboardChartWith(periodError)('fiddur', 'abc')).toBeNull()

    const dbDown = depsWith({
      resolveView: vi.fn(async () => {
        throw new Error('db down')
      }),
    })
    await expect(loadPublicDashboardChartWith(dbDown)('fiddur', 'abc')).rejects.toThrow('db down')
  })
})
