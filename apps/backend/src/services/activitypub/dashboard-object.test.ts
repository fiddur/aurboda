import type { DashboardShare, WidgetDataMap } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import { changeSuffix, dashboardNoteContent, renderDashboardShareHtml } from './dashboard-object.ts'

const dashboard: DashboardShare = {
  config: {
    period: { granularity: 'month' },
    sections: [
      {
        id: 'figures',
        title: 'Figures',
        type: 'metrics',
        widgets: [
          { config: { metric: 'steps', title: 'Steps' }, id: 'steps', type: 'metric_card' },
          { config: { metric: 'hrv', title: 'HRV', unit: 'ms' }, id: 'hrv', type: 'metric_card' },
          { config: { metric: 'resting_hr' }, id: 'rhr', type: 'sparkline_card' },
          { config: { metric: 'weight', title: 'Weight', unit: 'kg' }, id: 'weight', type: 'metric_card' },
          { config: {}, id: 'summary', type: 'activity_summary' },
        ],
      },
      {
        id: 'more',
        title: 'More',
        type: 'charts',
        widgets: [
          {
            config: { measure: 'e1rm', pattern: 'strength_training', source_type: 'activity_type' },
            id: 'bench',
            type: 'record_card',
          },
          { config: { pattern: 'hrv', source_type: 'metric' }, id: 'trend', type: 'trend_chart' },
          { config: { href: '#', label: 'Goals' }, id: 'link', type: 'quick_link' },
        ],
      },
    ],
    version: 1,
  },
  include_link: true,
  name: 'Month in data',
  period: '2026-10',
  url: 'https://aurboda.example/u/fiddur/abc',
}

const widgetData: WidgetDataMap = {
  bench: {
    data: { record: { measure: 'e1rm', start_time: '2026-10-12T08:00:00.000Z', value: 101.266 } },
    type: 'record_card',
  },
  hrv: {
    data: { count: 31, max: null, previous_value: 50, trend_percent: -2.4, value: 48.84 },
    type: 'metric_card',
  },
  link: { data: null, type: 'quick_link' },
  rhr: {
    data: { count: 31, previous_value: 52, series: [], trend_percent: 0.4, value: 52.2 },
    type: 'sparkline_card',
  },
  steps: {
    data: { count: 31, max: null, previous_value: 9000, trend_percent: 4.2, value: 9375 },
    type: 'metric_card',
  },
  summary: {
    data: {
      exercise: { count: 12, previous_count: 10, previous_total_minutes: 500, total_minutes: 600.4 },
      meditation: { count: 3, previous_count: 3, previous_total_minutes: 30, total_minutes: 30 },
      sleep: { avg_hours: 7.25, count: 30, previous_avg_hours: 7.5, previous_count: 30 },
    },
    type: 'activity_summary',
  },
  trend: { data: { current_value: 50, history: [] }, type: 'trend_chart' },
  weight: {
    data: { count: 4, max: null, previous_value: null, trend_percent: null, value: 80.25 },
    type: 'metric_card',
  },
}

const structured = { config: dashboard.config, widget_data: widgetData }

const link =
  '<p><a href="https://aurboda.example/u/fiddur/abc" rel="nofollow noopener noreferrer" target="_blank">https://aurboda.example/u/fiddur/abc</a></p>'

describe('changeSuffix', () => {
  test('an arrow and the whole percent, or a flat arrow within half a percent', () => {
    expect(changeSuffix(4.2)).toBe(' (↑ 4%)')
    expect(changeSuffix(-2.4)).toBe(' (↓ 2%)')
    expect(changeSuffix(0.5)).toBe(' (→)')
    expect(changeSuffix(-0.5)).toBe(' (→)')
    expect(changeSuffix(null)).toBe('')
  })
})

describe('renderDashboardShareHtml', () => {
  test('heading, note, one line per figure widget in config order, and the link', () => {
    expect(renderDashboardShareHtml(dashboard, structured, 'A **good** month')).toBe(
      [
        '<p><strong>Month in data</strong> · October 2026</p>',
        '<p>A <strong>good</strong> month</p>\n',
        '<p>' +
          [
            'Steps 9375 (↑ 4%)',
            'HRV 48.8 ms (↓ 2%)',
            'resting_hr 52.2 (→)',
            'Weight 80.3 kg',
            'Workouts 12 · 600 min (↑ 20%)',
            'Sleep 7.3 h (↓ 3%)',
            'Meditation 3 (→)',
            'Best e1RM 101.3 kg',
          ].join('<br>') +
          '</p>',
        link,
      ].join('\n'),
    )
  })

  test('no figures paragraph when no widget has a one-line form, and no link without a url', () => {
    const { url: _url, ...unlinked } = dashboard
    const html = renderDashboardShareHtml(unlinked, { ...structured, widget_data: {} }, null)
    expect(html).toBe('<p><strong>Month in data</strong> · October 2026</p>')
  })

  test('without the resolved figures: heading, note and link only', () => {
    expect(renderDashboardShareHtml(dashboard, null, 'Hi')).toBe(
      ['<p><strong>Month in data</strong> · October 2026</p>', '<p>Hi</p>\n', link].join('\n'),
    )
  })

  test('escapes the name, the titles and the url', () => {
    const tricky: DashboardShare = {
      ...dashboard,
      config: {
        sections: [
          {
            id: 's',
            title: 'S',
            type: 'metrics',
            widgets: [
              { config: { metric: 'steps', title: '<b>Steps</b> & co' }, id: 'steps', type: 'metric_card' },
            ],
          },
        ],
        version: 1,
      },
      name: 'Me & <you>',
      url: 'https://aurboda.example/u/fiddur/a"b',
    }
    const html = renderDashboardShareHtml(tricky, { config: tricky.config, widget_data: widgetData }, null)
    expect(html).toContain('<strong>Me &amp; &lt;you&gt;</strong>')
    expect(html).toContain('&lt;b&gt;Steps&lt;/b&gt; &amp; co 9375 (↑ 4%)')
    expect(html).toContain('href="https://aurboda.example/u/fiddur/a&quot;b"')
    expect(html).not.toContain('<b>')
  })
})

describe('dashboardNoteContent', () => {
  test('renders from the resolved period', async () => {
    const html = await dashboardNoteContent(
      'fiddur',
      { dashboard, message: null },
      {
        structured: {
          getUserTimezone: async () => 'UTC',
          resolveDashboardData: async () => widgetData,
        },
      },
    )
    expect(html).toContain('Steps 9375 (↑ 4%)')
  })

  test('a resolve failure falls back to heading, note and link', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const html = await dashboardNoteContent(
      'fiddur',
      { dashboard, message: 'Hi' },
      {
        structured: {
          getUserTimezone: async () => 'UTC',
          resolveDashboardData: async () => {
            throw new Error('db down')
          },
        },
      },
    )
    expect(html).toBe(renderDashboardShareHtml(dashboard, null, 'Hi'))
    warn.mockRestore()
  })
})
