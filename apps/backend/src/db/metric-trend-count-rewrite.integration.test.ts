import type { DashboardConfig } from '@aurboda/api-spec'

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getDbForUser, rewriteMetricTrendCountToMean } from './connection.ts'
import { getGoals, insertGoal } from './goals.ts'
import { getUserSettings, upsertUserSettings } from './settings.ts'
import { createSharedDashboard, getSharedDashboardById } from './shared-dashboards.ts'

const CONTAINER_TIMEOUT = 120_000

const dashboard: DashboardConfig = {
  sections: [
    {
      id: 'sec-1',
      title: 'Trends',
      type: 'charts',
      widgets: [
        {
          config: { aggregation: 'count', pattern: 'weight', source_type: 'metric' },
          id: 'metric-trend',
          type: 'trend_chart',
        },
        {
          config: { aggregation: 'count', pattern: 'coffee', source_type: 'activity_type' },
          id: 'activity-trend',
          type: 'trend_chart',
        },
        {
          config: {
            aggregation: 'count',
            bucket_size: '1d',
            lookback_days: 30,
            pattern: 'weight',
            source_type: 'metric',
          },
          id: 'metric-bar',
          type: 'bar_chart',
        },
      ],
    },
  ],
  version: 1,
}

const aggregations = (config: DashboardConfig | undefined) =>
  Object.fromEntries(
    (config?.sections ?? []).flatMap((s) =>
      s.widgets.map((w) => [w.id, (w.config as { aggregation?: string }).aggregation]),
    ),
  )

describe('rewriteMetricTrendCountToMean', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('rewrites only metric trend goals and metric trend_chart widgets, once', async () => {
    const user = getTestUser()
    const metricGoalId = randomUUID()
    const activityGoalId = randomUUID()
    const trendGoal = { display_period: 'monthly', goal_type: 'trend', half_life_days: 15, max: 80 } as const
    await insertGoal(user, {
      ...trendGoal,
      aggregation: 'count',
      id: metricGoalId,
      pattern: 'weight',
      source_type: 'metric',
    })
    await insertGoal(user, {
      ...trendGoal,
      aggregation: 'count',
      id: activityGoalId,
      pattern: 'coffee',
      source_type: 'activity_type',
    })
    await upsertUserSettings(user, { dashboard })
    const shared = await createSharedDashboard(user, { config: dashboard, is_public: false, name: 'Board' })

    const db = await getDbForUser(user)
    expect(await rewriteMetricTrendCountToMean(db)).toBe(3)

    const goals = Object.fromEntries(
      (await getGoals(user)).map((g) => [g.id, g.goal_type === 'trend' ? g.aggregation : null]),
    )
    expect(goals).toEqual({ [activityGoalId]: 'count', [metricGoalId]: 'mean' })

    const expected = { 'activity-trend': 'count', 'metric-bar': 'count', 'metric-trend': 'mean' }
    expect(aggregations((await getUserSettings(user))?.dashboard)).toEqual(expected)
    expect(aggregations((await getSharedDashboardById(user, shared.id))?.config)).toEqual(expected)

    expect(await rewriteMetricTrendCountToMean(db)).toBe(0)
    expect(aggregations((await getSharedDashboardById(user, shared.id))?.config)).toEqual(expected)
  })
})
