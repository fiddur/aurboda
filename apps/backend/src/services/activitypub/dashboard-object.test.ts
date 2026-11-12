import type {
  ActivityTypeCardData,
  DashboardShare,
  PlacesCardData,
  TopListCardData,
  WidgetData,
  WidgetDataMap,
} from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import {
  activityTypeLines,
  changeSuffix,
  dashboardNoteContent,
  formatHoursMinutes,
  placesLines,
  renderDashboardShareHtml,
  topListLines,
} from './dashboard-object.ts'

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
      {
        id: 'month',
        title: 'Month',
        type: 'metrics',
        widgets: [
          { config: { pattern: 'sleep', title: 'Sleep' }, id: 'sleep', type: 'activity_type_card' },
          { config: { pattern: 'running', title: 'Workouts' }, id: 'workouts', type: 'activity_type_card' },
          {
            config: { limit: 3, source: 'media_artist', title: 'Music' },
            id: 'music',
            type: 'top_list_card',
          },
          { config: { limit: 3, source: 'screentime_app' }, id: 'apps', type: 'top_list_card' },
          { config: {}, id: 'places', type: 'places_card' },
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

const workouts: ActivityTypeCardData = {
  activity_type_name: 'Running',
  avg_speed_kmh: 10,
  best_pace_sec_per_km: 330,
  count: 3,
  distance_km: 15,
  previous_count: 1,
  sleep: null,
  total_minutes: 130,
}

const widgetData: WidgetDataMap = {
  apps: {
    data: {
      distinct: 12,
      items: [
        { count: 2, name: 'firefox' },
        { count: 1, name: 'code' },
      ],
      per_day: 0.1,
      total: 3,
      unit: 'hours',
    },
    type: 'top_list_card',
  },
  bench: {
    data: { record: { measure: 'e1rm', start_time: '2026-10-12T08:00:00.000Z', value: 101.266 } },
    type: 'record_card',
  },
  hrv: {
    data: { count: 31, max: null, previous_value: 50, trend_percent: -2.4, value: 48.84 },
    type: 'metric_card',
  },
  link: { data: null, type: 'quick_link' },
  music: {
    data: {
      distinct: 2,
      items: [
        { count: 2, name: 'Artist A' },
        { count: 1, name: 'Artist B' },
      ],
      per_day: null,
      previous_total: 1,
      total: 3,
      unit: 'plays',
    },
    type: 'top_list_card',
  },
  places: {
    data: {
      distinct_places: 3,
      nights_away: 1,
      nights_by_place: [{ name: 'Home', nights: 2 }],
      nights_elsewhere: 1,
      nights_home: 2,
      nights_no_data: 28,
      places: [{ hours: 40, name: 'Home', nights: 2, visits: 3 }],
      previous_distinct_places: 3,
      visits: 5,
    },
    type: 'places_card',
  },
  rhr: {
    data: { count: 31, previous_value: 52, series: [], trend_percent: 0.4, value: 52.2 },
    type: 'sparkline_card',
  },
  sleep: {
    data: {
      activity_type_name: 'Sleep',
      avg_speed_kmh: null,
      best_pace_sec_per_km: null,
      count: 30,
      distance_km: null,
      previous_count: 31,
      previous_sleep_avg_minutes: 360,
      sleep: { avg_minutes: 450, avg_stages: null, best_night_minutes: 540 },
      total_minutes: 13_500,
    },
    type: 'activity_type_card',
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
  workouts: { data: workouts, type: 'activity_type_card' },
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

describe('formatHoursMinutes', () => {
  test('hours and minutes, hours alone, minutes alone', () => {
    expect(formatHoursMinutes(130)).toBe('2h 10m')
    expect(formatHoursMinutes(420)).toBe('7h')
    expect(formatHoursMinutes(45)).toBe('45m')
    expect(formatHoursMinutes(59.6)).toBe('1h')
    expect(formatHoursMinutes(0)).toBe('0m')
  })
})

describe('activityTypeLines', () => {
  const card = (figures: ActivityTypeCardData | null): WidgetData => ({
    data: figures,
    type: 'activity_type_card',
  })

  test('the type name without a title, no distance without one, no change without a previous count', () => {
    expect(
      activityTypeLines(
        undefined,
        card({ ...workouts, distance_km: null, previous_count: undefined, total_minutes: 45 }),
      ),
    ).toEqual(['Running 3 · 45m'])
  })

  test('one night in the singular (#1535)', () => {
    const sleep: ActivityTypeCardData = {
      ...workouts,
      activity_type_name: 'Sleep',
      count: 1,
      distance_km: null,
      previous_count: undefined,
      sleep: { avg_minutes: 450, avg_stages: null, best_night_minutes: 450 },
    }
    expect(activityTypeLines(undefined, card(sleep))).toEqual(['Sleep 1 night · avg 7h 30m'])
  })

  test('nothing without data or sessions', () => {
    expect(activityTypeLines('Workouts', undefined)).toEqual([])
    expect(activityTypeLines('Workouts', card(null))).toEqual([])
    expect(activityTypeLines('Workouts', card({ ...workouts, count: 0 }))).toEqual([])
  })
})

describe('topListLines', () => {
  const data: TopListCardData = { distinct: 0, items: [], per_day: null, total: 0, unit: 'visits' }
  const card = (figures: TopListCardData | null): WidgetData => ({ data: figures, type: 'top_list_card' })

  test('a fractional hour total and no items', () => {
    expect(topListLines({ source: 'screentime_app' }, card({ ...data, total: 2.5, unit: 'hours' }))).toEqual([
      'Top apps 2.5 h',
    ])
    expect(topListLines({ source: 'place' }, card({ ...data, previous_total: 4, total: 2 }))).toEqual([
      'Top places 2 visits (↓ 50%)',
    ])
  })

  test('a total of one play or visit in the singular (#1535)', () => {
    expect(topListLines({ source: 'media_artist' }, card({ ...data, total: 1, unit: 'plays' }))).toEqual([
      'Top artists 1 play',
    ])
    expect(topListLines({ source: 'place' }, card({ ...data, total: 1 }))).toEqual(['Top places 1 visit'])
    expect(topListLines({ source: 'screentime_app' }, card({ ...data, total: 1, unit: 'hours' }))).toEqual([
      'Top apps 1 h',
    ])
  })

  test('nothing without data or with an empty window', () => {
    expect(topListLines({ source: 'media_track' }, card(null))).toEqual([])
    expect(topListLines({ source: 'media_track' }, card(data))).toEqual([])
  })
})

describe('placesLines', () => {
  const empty: PlacesCardData = {
    distinct_places: 0,
    nights_away: 0,
    nights_by_place: [],
    nights_elsewhere: 0,
    nights_home: 0,
    nights_no_data: 0,
    places: [],
    visits: 0,
  }
  const card = (figures: PlacesCardData | null): WidgetData => ({ data: figures, type: 'places_card' })

  test('the nights of the top three named places, then elsewhere, then the distinct places', () => {
    expect(
      placesLines(
        undefined,
        card({
          ...empty,
          distinct_places: 4,
          nights_by_place: [
            { name: 'Hökås', nights: 13 },
            { name: 'Lönnåsen', nights: 3 },
            { name: 'Cabin', nights: 2 },
            { name: 'Hotel', nights: 1 },
          ],
          nights_elsewhere: 2,
          previous_distinct_places: 2,
        }),
      ),
    ).toEqual(['Places 13 nights Hökås, 3 Lönnåsen, 2 Cabin, 2 elsewhere · 4 places (↑ 100%)'])
  })

  test('no distinct places part without places', () => {
    expect(placesLines('Trips', card({ ...empty, nights_elsewhere: 3 }))).toEqual([
      'Trips 3 nights elsewhere',
    ])
  })

  test('one night and one place in the singular (#1535)', () => {
    expect(
      placesLines(
        undefined,
        card({ ...empty, distinct_places: 1, nights_by_place: [{ name: 'Home', nights: 1 }], visits: 1 }),
      ),
    ).toEqual(['Places 1 night Home · 1 place'])
  })

  test('only the distinct places when no night has a place', () => {
    expect(
      placesLines(undefined, card({ ...empty, distinct_places: 2, nights_no_data: 7, visits: 3 })),
    ).toEqual(['Places 2 places'])
  })

  test('nothing without data or with an empty window', () => {
    expect(placesLines(undefined, card(null))).toEqual([])
    expect(placesLines(undefined, card({ ...empty, nights_no_data: 7 }))).toEqual([])
  })
})

describe('renderDashboardShareHtml', () => {
  test('a table in the note comes out as lines, not a table', () => {
    const html = renderDashboardShareHtml(dashboard, null, '| Metric | Value |\n|---|---|\n| HRV | 42 |')
    expect(html).toContain('<p><em>Metric</em><br /><strong>HRV</strong>: Value 42</p>')
    expect(html).not.toContain('<table')
  })

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
            'Sleep 30 nights · avg 7h 30m (↑ 25%)',
            'Workouts 3 · 2h 10m · 15.0 km (↑ 200%)',
            'Music 3 plays — Artist A, Artist B (↑ 200%)',
            'Top apps 3 h — firefox, code',
            'Places 2 nights Home, 1 elsewhere · 3 places (→)',
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
