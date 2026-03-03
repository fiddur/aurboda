import { describe, expect, test } from 'vitest'
import { migrateSettingsToSnakeCase } from './settings'

describe('migrateSettingsToSnakeCase', () => {
  test('returns null for already snake_case settings', () => {
    const settings = {
      birth_date: '1990-01-15',
      hr_zone_start: { 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 },
      lastfm_username: 'testuser',
    }
    expect(migrateSettingsToSnakeCase(settings)).toBeNull()
  })

  test('returns null for empty settings', () => {
    expect(migrateSettingsToSnakeCase({})).toBeNull()
  })

  test('migrates top-level camelCase keys to snake_case', () => {
    const settings = {
      birthDate: '1990-01-15',
      calendars: [{ name: 'Work', url: 'https://example.com/work.ics' }],
      customMetrics: [{ name: 'mood', unit: 'score' }],
      hrZoneStart: { 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 },
      lastFmUsername: 'testuser',
      rescueTimeKey: 'rt-key-123',
      tagMappings: { 'some-uuid': 'Coffee' },
    }

    const result = migrateSettingsToSnakeCase(settings)

    expect(result).toEqual({
      birth_date: '1990-01-15',
      calendars: [{ name: 'Work', url: 'https://example.com/work.ics' }],
      custom_metrics: [{ name: 'mood', unit: 'score' }],
      hr_zone_start: { 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 },
      lastfm_username: 'testuser',
      rescue_time_key: 'rt-key-123',
      tag_mappings: { 'some-uuid': 'Coffee' },
    })
  })

  test('preserves keys that are already snake_case alongside camelCase', () => {
    const settings = {
      birthDate: '1990-01-15',
      calendars: [{ name: 'Work', url: 'https://example.com/work.ics' }],
      goals: [{ id: 'g1', metric: 'steps', min: 8000, window: '7d' }],
    }

    const result = migrateSettingsToSnakeCase(settings)

    expect(result).toEqual({
      birth_date: '1990-01-15',
      calendars: [{ name: 'Work', url: 'https://example.com/work.ics' }],
      goals: [{ id: 'g1', metric: 'steps', min: 8000, window: '7d' }],
    })
  })

  test('migrates dashboard widget config keys', () => {
    const settings = {
      birthDate: '1990-01-15',
      dashboard: {
        sections: [
          {
            id: 'metrics',
            title: 'Metrics',
            type: 'metrics',
            widgets: [
              {
                config: { lookbackDays: 30, metric: 'sleep_score' },
                id: 'w1',
                type: 'sparkline_card',
              },
              {
                config: {
                  displayPeriod: 'weekly',
                  halfLifeDays: 15,
                  pattern: 'coffee',
                  sourceType: 'tag',
                },
                id: 'w2',
                type: 'trend_chart',
              },
              {
                config: {
                  activity: 'meditation',
                  activityType: 'tag',
                  periodDays: 30,
                  windowMinutes: 60,
                },
                id: 'w3',
                type: 'correlation',
              },
              {
                config: {
                  lookbackDays: 7,
                  showMeditation: true,
                  showSleep: true,
                  showWorkouts: false,
                },
                id: 'w4',
                type: 'activity_summary',
              },
              {
                config: { metric: 'hrv_7day', title: 'HRV', trendInverse: false },
                id: 'w5',
                type: 'metric_card',
              },
            ],
          },
        ],
        version: 1,
      },
    }

    const result = migrateSettingsToSnakeCase(settings)!

    expect(result.birth_date).toBe('1990-01-15')

    const dashboard = result.dashboard as {
      sections: Array<{ widgets: Array<{ config: Record<string, unknown> }> }>
    }
    const widgets = dashboard.sections[0].widgets

    expect(widgets[0].config).toEqual({ lookback_days: 30, metric: 'sleep_score' })
    expect(widgets[1].config).toEqual({
      display_period: 'weekly',
      half_life_days: 15,
      pattern: 'coffee',
      source_type: 'tag',
    })
    expect(widgets[2].config).toEqual({
      activity: 'meditation',
      activity_type: 'tag',
      period_days: 30,
      window_minutes: 60,
    })
    expect(widgets[3].config).toEqual({
      lookback_days: 7,
      show_meditation: true,
      show_sleep: true,
      show_workouts: false,
    })
    expect(widgets[4].config).toEqual({ metric: 'hrv_7day', title: 'HRV', trend_inverse: false })
  })

  test('handles dashboard without sections gracefully', () => {
    const settings = {
      birthDate: '1990-01-15',
      dashboard: { version: 1 },
    }

    const result = migrateSettingsToSnakeCase(settings)

    expect(result).toEqual({
      birth_date: '1990-01-15',
      dashboard: { version: 1 },
    })
  })

  test('migrates tag_icons to item_icons', () => {
    const settings = {
      tag_icons: { Coffee: '☕', Meditation: '🧘' },
      tag_mappings: { 'some-uuid': 'Coffee' },
    }

    const result = migrateSettingsToSnakeCase(settings)

    expect(result).toEqual({
      item_icons: { Coffee: '☕', Meditation: '🧘' },
      tag_mappings: { 'some-uuid': 'Coffee' },
    })
    // tag_icons key should be gone after migration
    expect(result).not.toHaveProperty('tag_icons')
  })

  test('migrates tag_icons alongside camelCase keys', () => {
    const settings = {
      birthDate: '1990-01-15',
      tag_icons: { Running: '🏃' },
      tagMappings: { 'some-uuid': 'Running' },
    }

    const result = migrateSettingsToSnakeCase(settings)

    expect(result).toEqual({
      birth_date: '1990-01-15',
      item_icons: { Running: '🏃' },
      tag_mappings: { 'some-uuid': 'Running' },
    })
  })

  test('handles widgets without config gracefully', () => {
    const settings = {
      birthDate: '1990-01-15',
      dashboard: {
        sections: [
          {
            id: 's1',
            title: 'Test',
            type: 'metrics',
            widgets: [{ id: 'w1', type: 'metric_card' }],
          },
        ],
        version: 1,
      },
    }

    const result = migrateSettingsToSnakeCase(settings)!
    const dashboard = result.dashboard as { sections: Array<{ widgets: Array<{ config?: unknown }> }> }

    expect(dashboard.sections[0].widgets[0].config).toBeUndefined()
  })
})
