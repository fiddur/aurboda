import type { DashboardShare, WidgetDataMap } from '@aurboda/api-spec'

import { feedStructuredPostSchema } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

import {
  resolveStructuredDashboard,
  type StructuredDashboardDeps,
  type StructuredDashboardPost,
} from './feed-structured-dashboard.ts'

const dashboard: DashboardShare = {
  config: {
    period: { granularity: 'month' },
    sections: [
      {
        id: 's1',
        title: 'Month',
        type: 'metrics',
        widgets: [{ config: { metric: 'steps', title: 'Steps' }, id: 'w1', type: 'metric_card' }],
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
  w1: {
    data: { count: 31, max: null, previous_value: 9000, trend_percent: 10, value: 9900 },
    type: 'metric_card',
  },
}

const post = (over: Partial<StructuredDashboardPost> = {}): StructuredDashboardPost => ({
  dashboard,
  kind: 'dashboard',
  message: 'October!',
  ...over,
})

const depsWith = (over: Partial<StructuredDashboardDeps> = {}): StructuredDashboardDeps => ({
  getUserTimezone: vi.fn(async () => 'Europe/Stockholm'),
  resolveDashboardData: vi.fn(async () => widgetData),
  ...over,
})

describe('resolveStructuredDashboard', () => {
  test('null for other kinds and for a dashboard post without its payload', async () => {
    const deps = depsWith()
    expect(await resolveStructuredDashboard('fiddur', post({ kind: 'exercise' }), deps)).toBeNull()
    expect(await resolveStructuredDashboard('fiddur', post({ dashboard: null }), deps)).toBeNull()
    expect(deps.resolveDashboardData).not.toHaveBeenCalled()
  })

  test('resolves the snapshot over the period and the one before it, in the owner timezone', async () => {
    const deps = depsWith()
    await resolveStructuredDashboard('fiddur', post(), deps)
    expect(deps.resolveDashboardData).toHaveBeenCalledWith('fiddur', dashboard.config, {
      previous: {
        end: new Date('2026-09-30T22:00:00.000Z'),
        start: new Date('2026-08-31T22:00:00.000Z'),
      },
      window: {
        end: new Date('2026-10-31T23:00:00.000Z'),
        start: new Date('2026-09-30T22:00:00.000Z'),
      },
    })
  })

  test('the payload carries the snapshot, the period, its window, the data, the note and the link', async () => {
    const structured = await resolveStructuredDashboard('fiddur', post(), depsWith())
    expect(structured).toEqual({
      config: dashboard.config,
      kind: 'dashboard',
      message: 'October!',
      name: 'Month in data',
      period: '2026-10',
      url: 'https://aurboda.example/u/fiddur/abc',
      widget_data: widgetData,
      window: { end: '2026-10-31T23:00:00.000Z', start: '2026-09-30T22:00:00.000Z' },
    })
    expect(feedStructuredPostSchema.parse(structured)).toEqual(structured)
  })

  test('no message or url keys when the post has neither', async () => {
    const { url: _url, ...unlinked } = dashboard
    const structured = await resolveStructuredDashboard(
      'fiddur',
      post({ dashboard: unlinked, message: null }),
      depsWith(),
    )
    expect(structured).not.toHaveProperty('message')
    expect(structured).not.toHaveProperty('url')
  })
})
