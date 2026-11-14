import type { DashboardConfig, DashboardWidget } from '@aurboda/api-spec'

import { defaultDashboardConfig } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import {
  dashboardSources,
  storedMetric,
  visibleSections,
  waitingWidgetIds,
  widgetSources,
} from './dataPresence'

const board = (...widgets: DashboardWidget[]): DashboardConfig => ({
  sections: [{ id: 's', title: 'S', type: 'metrics', widgets }],
  version: 1,
})

describe('storedMetric', () => {
  test('maps dashboard and computed metrics onto the metric they are read from', () => {
    expect(storedMetric('hrv_7day')).toBe('hrv_rmssd')
    expect(storedMetric('rhr_30day')).toBe('resting_heart_rate')
    expect(storedMetric('zone2_weekly')).toBe('heart_rate')
    expect(storedMetric('hr_zone_3_sec')).toBe('heart_rate')
    expect(storedMetric('hrv_sleep')).toBe('hrv_rmssd')
    expect(storedMetric('mood')).toBe('mood')
  })
})

describe('widgetSources', () => {
  test('metric widgets read their metric, activity widgets their type', () => {
    expect(
      widgetSources({ config: { metric: 'steps', title: 'Steps' }, id: 'a', type: 'metric_card' }),
    ).toEqual({
      activity_types: [],
      metrics: ['steps'],
    })
    expect(widgetSources({ config: { pattern: 'running' }, id: 'b', type: 'activity_type_card' })).toEqual({
      activity_types: ['running'],
      metrics: [],
    })
    expect(widgetSources({ config: {}, id: 'c', type: 'last_sleep' })).toEqual({
      activity_types: ['sleep'],
      metrics: [],
    })
  })

  test('the activity summary reads the categories it shows', () => {
    expect(
      widgetSources({ config: { show_meditation: false }, id: 'a', type: 'activity_summary' })
        ?.activity_types,
    ).toEqual(['exercise', 'sleep'])
    expect(
      widgetSources({
        config: { show_meditation: false, show_sleep: false, show_workouts: false },
        id: 'a',
        type: 'activity_summary',
      }),
    ).toBeNull()
  })

  test('a tag chart, a link or a top list has no source to wait for', () => {
    expect(
      widgetSources({
        config: { pattern: 'coffee', source_type: 'tag', title: 'Coffee' },
        id: 'a',
        type: 'trend_chart',
      }),
    ).toBeNull()
    expect(
      widgetSources({ config: { href: '/sleep', label: 'Sleep' }, id: 'b', type: 'quick_link' }),
    ).toBeNull()
    expect(
      widgetSources({ config: { limit: 3, source: 'media_artist' }, id: 'c', type: 'top_list_card' }),
    ).toBeNull()
  })
})

describe('dashboardSources', () => {
  test('collects the default dashboard into one sorted, de-duplicated query', () => {
    expect(dashboardSources(defaultDashboardConfig)).toEqual({
      activity_types: ['exercise', 'meditation', 'sleep'],
      metrics: ['heart_rate', 'hrv_rmssd', 'readiness_score', 'resting_heart_rate', 'sleep_score', 'steps'],
    })
  })
})

describe('waitingWidgetIds', () => {
  const config = board(
    { config: { metric: 'steps', title: 'Steps' }, id: 'steps', type: 'metric_card' },
    { config: { metric: 'hrv_7day', title: 'HRV' }, id: 'hrv', type: 'metric_card' },
    { config: {}, id: 'summary', type: 'activity_summary' },
    { config: { href: '/sleep', label: 'Sleep' }, id: 'link', type: 'quick_link' },
  )

  test('hides a widget only when none of its sources ever delivered', () => {
    const presence = {
      activity_types: { exercise: false, meditation: false, sleep: true },
      metrics: { hrv_rmssd: false, steps: true },
    }
    expect([...waitingWidgetIds(config, presence)]).toEqual(['hrv'])
  })

  test('hides every sourced widget on a new account, and never a link', () => {
    const presence = {
      activity_types: { exercise: false, meditation: false, sleep: false },
      metrics: { hrv_rmssd: false, steps: false },
    }
    expect([...waitingWidgetIds(config, presence)]).toEqual(['steps', 'hrv', 'summary'])
  })

  test('a source the answer does not mention counts as delivered', () => {
    expect(waitingWidgetIds(config, { activity_types: {}, metrics: {} }).size).toBe(0)
  })
})

describe('visibleSections', () => {
  const metric = (id: string): DashboardWidget => ({
    config: { metric: id, title: id },
    id,
    type: 'metric_card',
  })
  const sections: DashboardConfig['sections'] = [
    { id: 'a', title: 'A', type: 'metrics', widgets: [metric('hrv'), metric('steps')] },
    { id: 'b', title: 'B', type: 'metrics', widgets: [metric('weight')] },
    { id: 'c', title: 'C', type: 'metrics', widgets: [] },
  ]

  test('drops waiting widgets, and a section they leave empty, but keeps a section that was empty', () => {
    const shown = visibleSections(sections, new Set(['hrv', 'weight']))
    expect(shown.map((s) => [s.id, s.widgets.map((w) => w.id)])).toEqual([
      ['a', ['steps']],
      ['c', []],
    ])
  })

  test('nothing waiting leaves the sections as they are', () => {
    expect(visibleSections(sections, new Set())).toBe(sections)
  })
})
