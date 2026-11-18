import {
  type BarChartConfig,
  type DashboardConfig,
  MUSCLE_GROUP_FILTER_NEEDS_GROUP,
  MUSCLE_GROUP_FILTER_NEEDS_SUMMED_MEASURE,
  MUSCLE_GROUP_FILTER_WITH_MUSCLE_GROUP_BREAKDOWN,
  MUSCLE_GROUP_FILTER_WITH_OTHER_ITEM_PATH,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { dashboardConfigError, sanitizeConfig } from './dashboard-config.ts'

describe('sanitizeConfig', () => {
  test('neutralizes quick-link hrefs and leaves other widgets untouched', () => {
    const config: DashboardConfig = {
      sections: [
        {
          id: 's1',
          title: 'Links',
          type: 'links',
          widgets: [
            {
              config: { href: '/secret/admin', icon: 'goals', label: 'Goals' },
              id: 'ql',
              type: 'quick_link',
            },
            { config: { metric: 'hrv_7day', title: 'HRV' }, id: 'mc', type: 'metric_card' },
          ],
        },
      ],
      version: 1,
    }

    const sanitized = sanitizeConfig(config)
    const [quickLink, metricCard] = sanitized.sections[0].widgets

    expect(quickLink.type).toBe('quick_link')
    if (quickLink.type === 'quick_link') {
      expect(quickLink.config.href).toBe('#')
      expect(quickLink.config.label).toBe('Goals') // label preserved
    }
    expect(metricCard).toEqual(config.sections[0].widgets[1]) // untouched
    // Original config is not mutated.
    expect(config.sections[0].widgets[0]).toMatchObject({ config: { href: '/secret/admin' } })
  })

  test('preserves author prose (dashboard + section descriptions)', () => {
    const config: DashboardConfig = {
      description: 'Two years of training.',
      sections: [
        { description: 'Recovery metrics.', id: 's1', title: 'Baseline', type: 'metrics', widgets: [] },
      ],
      version: 1,
    }
    const sanitized = sanitizeConfig(config)
    expect(sanitized.description).toBe('Two years of training.')
    expect(sanitized.sections[0].description).toBe('Recovery metrics.')
  })

  test('keeps the period of a period dashboard', () => {
    const config: DashboardConfig = { period: { granularity: 'month' }, sections: [], version: 1 }
    expect(sanitizeConfig(config).period).toEqual({ granularity: 'month' })
    expect('period' in sanitizeConfig({ sections: [], version: 1 })).toBe(false)
  })

  test('leaves out day overview widgets', () => {
    const config: DashboardConfig = {
      sections: [
        {
          id: 's1',
          title: 'Today',
          type: 'charts',
          widgets: [
            {
              config: { metrics: ['stress_level', 'body_battery'], window: 'rolling_24h' },
              id: 'day',
              type: 'day_overview',
            },
            { config: { metric: 'hrv_7day', title: 'HRV' }, id: 'mc', type: 'metric_card' },
          ],
        },
      ],
      version: 1,
    }
    expect(sanitizeConfig(config).sections[0].widgets.map((w) => w.id)).toEqual(['mc'])
  })
})

describe('dashboardConfigError', () => {
  const muscleBars: BarChartConfig = {
    bucket_size: '1w',
    filter_field: 'sets.exercise.muscle_group',
    filter_value: 'chest',
    lookback_days: 90,
    measure: 'set_count',
    pattern: 'strength_training',
    source_type: 'activity_type',
  }

  const withWidgets = (widgets: DashboardConfig['sections'][number]['widgets']): DashboardConfig => ({
    sections: [{ id: 's', title: 'Strength', type: 'charts', widgets }],
    version: 1,
  })

  const barWidget = (config: Partial<BarChartConfig>): DashboardConfig =>
    withWidgets([{ config: { ...muscleBars, ...config }, id: 'bar', type: 'bar_chart' }])

  test('accepts the bar charts the Chart Explorer saves', () => {
    expect(dashboardConfigError(barWidget({}))).toBeUndefined()
    expect(dashboardConfigError(barWidget({ breakdown_fields: ['sets.exercise'] }))).toBeUndefined()
    expect(
      dashboardConfigError(
        barWidget({
          breakdown_fields: ['sets.exercise.muscle_group'],
          filter_field: undefined,
          filter_value: undefined,
        }),
      ),
    ).toBeUndefined()
    expect(
      dashboardConfigError(
        barWidget({ filter_field: 'sets.exercise', filter_value: 'Bench', measure: 'e1rm' }),
      ),
    ).toBeUndefined()
  })

  test('refuses a muscle-group filter without a muscle group', () => {
    expect(dashboardConfigError(barWidget({ filter_value: 'pecs' }))).toBe(MUSCLE_GROUP_FILTER_NEEDS_GROUP)
  })

  test('refuses a muscle-group filter without a summed measure', () => {
    expect(dashboardConfigError(barWidget({ measure: 'e1rm' }))).toBe(
      MUSCLE_GROUP_FILTER_NEEDS_SUMMED_MEASURE,
    )
    expect(dashboardConfigError(barWidget({ measure: undefined }))).toBe(
      MUSCLE_GROUP_FILTER_NEEDS_SUMMED_MEASURE,
    )
  })

  test('refuses a muscle-group filter with a muscle-group breakdown', () => {
    expect(dashboardConfigError(barWidget({ breakdown_fields: ['sets.exercise.muscle_group'] }))).toBe(
      MUSCLE_GROUP_FILTER_WITH_MUSCLE_GROUP_BREAKDOWN,
    )
  })

  test('refuses a muscle-group filter with another item path breakdown', () => {
    expect(dashboardConfigError(barWidget({ breakdown_fields: ['laps.name'] }))).toBe(
      MUSCLE_GROUP_FILTER_WITH_OTHER_ITEM_PATH,
    )
  })

  test("checks a combined chart's bars layer", () => {
    const combined = (bars: Partial<BarChartConfig>): DashboardConfig =>
      withWidgets([
        {
          config: {
            layers: [
              {
                bucket_size: '1w',
                filter_field: 'sets.exercise.muscle_group',
                filter_value: 'chest',
                kind: 'bars',
                measure: 'set_count',
                pattern: 'strength_training',
                source_type: 'activity_type',
                ...bars,
              },
              { kind: 'trend', pattern: 'strength_training', source_type: 'activity_type' },
            ],
            lookback_days: 30,
          },
          id: 'combined',
          type: 'combined_chart',
        },
      ])
    expect(dashboardConfigError(combined({}))).toBeUndefined()
    expect(dashboardConfigError(combined({ measure: 'max_weight' }))).toBe(
      MUSCLE_GROUP_FILTER_NEEDS_SUMMED_MEASURE,
    )
  })
})
