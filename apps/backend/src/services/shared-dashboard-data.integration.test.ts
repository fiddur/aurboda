/**
 * Integration tests for the shared dashboard data resolver.
 *
 * The resolver is the public-dashboard security boundary: it takes only
 * `(user, config)` — there is no request/viewer input it could leak through —
 * and returns a map keyed by widget id with a minimal projection per widget.
 * These tests run every widget type against a real (empty) database to verify
 * the wiring resolves without throwing and produces the expected shape.
 */
import type { DashboardConfig } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { resolveDashboardData } from './shared-dashboard-data.ts'

const CONTAINER_TIMEOUT = 120_000

const everyWidgetConfig: DashboardConfig = {
  sections: [
    {
      id: 'sec',
      title: 'All widgets',
      type: 'charts',
      widgets: [
        { config: { metric: 'hrv_7day', title: 'HRV' }, id: 'mc-baseline', type: 'metric_card' },
        { config: { metric: 'steps', title: 'Steps' }, id: 'mc-period', type: 'metric_card' },
        { config: { metric: 'sleep_score', lookback_days: 30 }, id: 'spark', type: 'sparkline_card' },
        {
          config: { pattern: 'exercise', source_type: 'activity_type' },
          id: 'trend',
          type: 'trend_chart',
        },
        {
          config: { bucket_size: '1d', lookback_days: 7, pattern: 'exercise', source_type: 'activity_type' },
          id: 'bar',
          type: 'bar_chart',
        },
        {
          config: { activity: 'exercise', activity_type: 'activity_type' },
          id: 'corr',
          type: 'correlation',
        },
        { config: { lookback_days: 7 }, id: 'actsum', type: 'activity_summary' },
        { config: { href: '/timeline', label: 'Timeline' }, id: 'ql', type: 'quick_link' },
        { config: { lookback_days: 7 }, id: 'hrz', type: 'hr_zones' },
        { config: {}, id: 'goals', type: 'goal_progress' },
      ],
    },
  ],
  version: 1,
}

describe('resolveDashboardData integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('takes only (user, config) — no viewer input channel', () => {
    expect(resolveDashboardData.length).toBe(2)
  })

  test('resolves every widget type, keyed by widget id', async () => {
    const user = getTestUser()
    const data = await resolveDashboardData(user, everyWidgetConfig)

    // Keyed by widget id, one entry per widget.
    expect(Object.keys(data).sort()).toEqual(
      ['actsum', 'bar', 'corr', 'goals', 'hrz', 'mc-baseline', 'mc-period', 'ql', 'spark', 'trend'].sort(),
    )

    // Each entry carries its widget type.
    expect(data['mc-baseline'].type).toBe('metric_card')
    expect(data['spark'].type).toBe('sparkline_card')
    expect(data['trend'].type).toBe('trend_chart')
    expect(data['bar'].type).toBe('bar_chart')
    expect(data['corr'].type).toBe('correlation')
    expect(data['actsum'].type).toBe('activity_summary')
    expect(data['hrz'].type).toBe('hr_zones')
    expect(data['goals'].type).toBe('goal_progress')

    // quick_link never carries data.
    expect(data['ql']).toEqual({ data: null, type: 'quick_link' })
  })

  test('emits minimal projections (no raw activity fields beyond type/times)', async () => {
    const user = getTestUser()
    const data = await resolveDashboardData(user, everyWidgetConfig)

    const actsum = data['actsum']
    expect(actsum.type).toBe('activity_summary')
    if (actsum.type === 'activity_summary' && actsum.data) {
      for (const item of actsum.data.activities) {
        expect(Object.keys(item).sort()).toEqual(['activity_type', 'end_time', 'start_time'])
      }
    }

    const bar = data['bar']
    if (bar.type === 'bar_chart' && bar.data) {
      for (const bucket of bar.data.buckets) {
        expect(Object.keys(bucket).sort()).toEqual(['bucket_start', 'value'])
      }
    }
  })
})
