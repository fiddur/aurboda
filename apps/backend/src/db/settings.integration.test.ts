import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import { getUserSettings, upsertUserSettings } from './settings'

const CONTAINER_TIMEOUT = 60_000

describe('Settings Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('User Settings with tagMappings', () => {
    test('stores and retrieves tagMappings', async () => {
      const user = getTestUser()
      const mappings = {
        '067e2862-8cf8-4307-a621-0636dd379cda': 'Hot Chocolate',
        '4ddc8bc2-911d-467d-8c9d-dac2ece87d0a': 'YinYoga',
      }

      await upsertUserSettings(user, { tagMappings: mappings })

      const settings = await getUserSettings(user)
      expect(settings?.tagMappings).toEqual(mappings)
    })

    test('updates tagMappings while preserving other settings', async () => {
      const user = getTestUser()

      // Set initial settings
      await upsertUserSettings(user, { birthDate: '1990-01-15' })

      // Add tag mappings
      const mappings = { 'test-uuid': 'Test Tag' }
      await upsertUserSettings(user, { tagMappings: mappings })

      const settings = await getUserSettings(user)
      expect(settings?.birthDate).toBe('1990-01-15')
      expect(settings?.tagMappings).toEqual(mappings)
    })

    test('replaces tagMappings with empty object to clear', async () => {
      const user = getTestUser()

      await upsertUserSettings(user, { tagMappings: { 'test-uuid': 'Test' } })
      // Setting to empty object effectively clears the mappings
      await upsertUserSettings(user, { tagMappings: {} })

      const settings = await getUserSettings(user)
      expect(settings?.tagMappings).toEqual({})
    })

    test('preserves tagMappings when update does not include tagMappings', async () => {
      const user = getTestUser()
      const mappings = { 'test-uuid': 'Test' }

      await upsertUserSettings(user, { tagMappings: mappings })
      // Updating other fields should not affect tagMappings
      await upsertUserSettings(user, { birthDate: '2000-01-01' })

      const settings = await getUserSettings(user)
      expect(settings?.tagMappings).toEqual(mappings)
      expect(settings?.birthDate).toBe('2000-01-01')
    })
  })

  describe('User Settings with calendars', () => {
    test('stores and retrieves calendars', async () => {
      const user = getTestUser()
      const calendars = [
        { name: 'Work', url: 'https://example.com/work.ics' },
        { name: 'Personal', url: 'https://example.com/personal.ics' },
      ]

      await upsertUserSettings(user, { calendars })

      const settings = await getUserSettings(user)
      expect(settings?.calendars).toEqual(calendars)
    })

    test('updates calendars while preserving other settings', async () => {
      const user = getTestUser()

      await upsertUserSettings(user, { birthDate: '1990-01-15' })

      const calendars = [{ name: 'Work', url: 'https://example.com/work.ics' }]
      await upsertUserSettings(user, { calendars })

      const settings = await getUserSettings(user)
      expect(settings?.birthDate).toBe('1990-01-15')
      expect(settings?.calendars).toEqual(calendars)
    })

    test('replaces calendars with empty array to clear', async () => {
      const user = getTestUser()

      await upsertUserSettings(user, {
        calendars: [{ name: 'Work', url: 'https://example.com/work.ics' }],
      })
      await upsertUserSettings(user, { calendars: [] })

      const settings = await getUserSettings(user)
      expect(settings?.calendars).toEqual([])
    })

    test('preserves calendars when update does not include calendars', async () => {
      const user = getTestUser()
      const calendars = [{ name: 'Work', url: 'https://example.com/work.ics' }]

      await upsertUserSettings(user, { calendars })
      await upsertUserSettings(user, { birthDate: '2000-01-01' })

      const settings = await getUserSettings(user)
      expect(settings?.calendars).toEqual(calendars)
      expect(settings?.birthDate).toBe('2000-01-01')
    })
  })

  describe('User Settings with dashboard', () => {
    const sampleDashboard = {
      sections: [
        {
          id: 'test-section',
          title: 'Test Section',
          type: 'metrics' as const,
          widgets: [
            {
              config: { metric: 'hrv_7day' as const, title: 'Test HRV' },
              id: 'test-widget',
              type: 'metric_card' as const,
            },
          ],
        },
      ],
      version: 1 as const,
    }

    test('stores and retrieves dashboard config', async () => {
      const user = getTestUser()

      await upsertUserSettings(user, { dashboard: sampleDashboard })

      const settings = await getUserSettings(user)
      expect(settings?.dashboard).toEqual(sampleDashboard)
    })

    test('updates dashboard while preserving other settings', async () => {
      const user = getTestUser()

      await upsertUserSettings(user, { birthDate: '1990-01-15' })
      await upsertUserSettings(user, { dashboard: sampleDashboard })

      const settings = await getUserSettings(user)
      expect(settings?.birthDate).toBe('1990-01-15')
      expect(settings?.dashboard).toEqual(sampleDashboard)
    })

    test('preserves dashboard when explicitly set to undefined (undefined means no change)', async () => {
      const user = getTestUser()

      await upsertUserSettings(user, { dashboard: sampleDashboard })
      // Note: undefined at db level means "don't update", not "clear"
      // Clearing is handled at the service layer by omitting the key from merged object
      await upsertUserSettings(user, { dashboard: undefined })

      const settings = await getUserSettings(user)
      // Dashboard should be preserved since undefined means "no change"
      expect(settings?.dashboard).toEqual(sampleDashboard)
    })

    test('preserves dashboard when update does not include dashboard', async () => {
      const user = getTestUser()

      await upsertUserSettings(user, { dashboard: sampleDashboard })
      await upsertUserSettings(user, { birthDate: '2000-01-01' })

      const settings = await getUserSettings(user)
      expect(settings?.dashboard).toEqual(sampleDashboard)
      expect(settings?.birthDate).toBe('2000-01-01')
    })

    test('stores complex dashboard with multiple sections and widget types', async () => {
      const user = getTestUser()
      const complexDashboard = {
        sections: [
          {
            id: 'metrics-section',
            title: 'Health Metrics',
            type: 'metrics' as const,
            widgets: [
              {
                config: { metric: 'hrv_7day' as const, title: 'HRV', unit: 'ms' },
                id: 'hrv-card',
                type: 'metric_card' as const,
              },
              {
                config: { color: '#3b82f6', lookbackDays: 30, metric: 'sleep_score' as const },
                id: 'sleep-sparkline',
                type: 'sparkline_card' as const,
              },
            ],
          },
          {
            collapsed: true,
            id: 'charts-section',
            title: 'Trends',
            type: 'charts' as const,
            widgets: [
              {
                config: { halfLifeDays: 15, pattern: 'coffee', sourceType: 'tag' as const },
                id: 'coffee-trend',
                type: 'trend_chart' as const,
              },
            ],
          },
          {
            id: 'links-section',
            title: 'Quick Links',
            type: 'links' as const,
            widgets: [
              {
                config: { href: '/sleep', icon: 'sleep' as const, label: 'Sleep' },
                id: 'link-sleep',
                type: 'quick_link' as const,
              },
            ],
          },
        ],
        version: 1 as const,
      }

      await upsertUserSettings(user, { dashboard: complexDashboard })

      const settings = await getUserSettings(user)
      expect(settings?.dashboard).toEqual(complexDashboard)
      expect(settings?.dashboard?.sections).toHaveLength(3)
      expect(settings?.dashboard?.sections[0].widgets).toHaveLength(2)
      expect(settings?.dashboard?.sections[1].collapsed).toBe(true)
    })
  })
})
