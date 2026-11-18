import { describe, expect, test } from 'vitest'

import type { OAuthToken, SyncState } from '../../db/types.ts'

import { GARMIN_DAILY_PUSH_STALE_MS, GARMIN_PUSH_FRESH_MS, garminPushDelivered } from './push-coverage.ts'

const NOW = new Date('2026-11-18T12:00:00Z')
const hoursBefore = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000)

const grant = (overrides: Partial<OAuthToken> = {}): OAuthToken => ({
  access_token: 'fake-access',
  provider: 'garmin_oauth',
  scopes: ['HEALTH_EXPORT', 'ACTIVITY_EXPORT'],
  ...overrides,
})

const state = (
  data_type: string,
  last_sync_time: Date | undefined,
  status: SyncState['status'] = 'idle',
) => ({
  data_type,
  last_sync_time,
  provider: 'garmin_push',
  status,
})

describe('garminPushDelivered', () => {
  const fresh = [state('dailies', hoursBefore(1))]

  test('nothing without a connected grant', () => {
    expect(garminPushDelivered(null, fresh, NOW)).toEqual([])
    expect(garminPushDelivered(grant({ access_token: '' }), fresh, NOW)).toEqual([])
  })

  test('nothing while the grant needs reconnecting', () => {
    expect(garminPushDelivered(grant({ refused_at: hoursBefore(2) }), fresh, NOW)).toEqual([])
  })

  test('nothing without any push received', () => {
    expect(garminPushDelivered(grant(), [], NOW)).toEqual([])
    expect(garminPushDelivered(grant(), [state('dailies', undefined)], NOW)).toEqual([])
  })

  test('nothing once the newest push is a day old', () => {
    expect(garminPushDelivered(grant(), [state('dailies', hoursBefore(25))], NOW)).toEqual([])
    expect(
      garminPushDelivered(grant(), [state('dailies', new Date(NOW.getTime() - GARMIN_PUSH_FRESH_MS))], NOW),
    ).toEqual([])
  })

  test('a fresh dailies push delivers its three types', () => {
    expect(garminPushDelivered(grant(), fresh, NOW)).toEqual([
      'dailySummary',
      'heartRate',
      'intensityMinutes',
    ])
  })

  test('a failed push delivers nothing for its types but still keeps the connection fresh', () => {
    expect(
      garminPushDelivered(
        grant(),
        [state('sleeps', hoursBefore(1), 'error'), state('hrv', hoursBefore(48))],
        NOW,
      ),
    ).toEqual(['hrv'])
  })

  test('activity files alone do not vouch for activities', () => {
    expect(
      garminPushDelivered(
        grant(),
        [
          state('activityFiles', hoursBefore(1)),
          state('activityDetails', hoursBefore(1)),
          state('manuallyUpdatedActivities', hoursBefore(1)),
        ],
        NOW,
      ),
    ).toEqual([])
  })

  test('activities need ACTIVITY_EXPORT', () => {
    expect(
      garminPushDelivered(
        grant({ scopes: ['HEALTH_EXPORT'] }),
        [state('activities', hoursBefore(1)), state('sleeps', hoursBefore(1))],
        NOW,
      ),
    ).toEqual(['sleep'])
  })

  test('health types need HEALTH_EXPORT', () => {
    expect(
      garminPushDelivered(
        grant({ scopes: ['ACTIVITY_EXPORT'] }),
        [state('activities', hoursBefore(1)), state('sleeps', hoursBefore(1))],
        NOW,
      ),
    ).toEqual(['activities'])
  })

  test('an old activities push still delivers activities while another push is fresh', () => {
    expect(
      garminPushDelivered(
        grant(),
        [state('activities', hoursBefore(24 * 7)), state('hrv', hoursBefore(1))],
        NOW,
      ),
    ).toEqual(['hrv', 'activities'])
  })

  test('a daily type whose own last push is over three days old no longer vouches, while dailies keep it fresh', () => {
    expect(
      garminPushDelivered(grant(), [state('dailies', hoursBefore(1)), state('sleeps', hoursBefore(73))], NOW),
    ).toEqual(['dailySummary', 'heartRate', 'intensityMinutes'])
    expect(
      garminPushDelivered(
        grant(),
        [
          state('dailies', hoursBefore(1)),
          state('hrv', hoursBefore(24 * 4)),
          state('stressDetails', hoursBefore(24 * 4)),
        ],
        NOW,
      ),
    ).toEqual(['dailySummary', 'heartRate', 'intensityMinutes'])
  })

  test('a daily type exactly three days old still vouches', () => {
    expect(
      garminPushDelivered(
        grant(),
        [
          state('dailies', hoursBefore(1)),
          state('sleeps', new Date(NOW.getTime() - GARMIN_DAILY_PUSH_STALE_MS)),
        ],
        NOW,
      ),
    ).toEqual(['dailySummary', 'heartRate', 'sleep', 'intensityMinutes'])
  })

  test('the cap is for the daily types only: an old pulse ox or respiration push still vouches', () => {
    expect(
      garminPushDelivered(
        grant(),
        [
          state('dailies', hoursBefore(1)),
          state('pulseox', hoursBefore(24 * 5)),
          state('allDayRespiration', hoursBefore(24 * 5)),
        ],
        NOW,
      ),
    ).toEqual(['dailySummary', 'heartRate', 'spo2', 'respiration', 'intensityMinutes'])
  })

  test('unknown permissions leave the pushes received to decide', () => {
    const states = [state('dailies', hoursBefore(1)), state('activities', hoursBefore(1))]
    const all = ['dailySummary', 'heartRate', 'activities', 'intensityMinutes']
    expect(garminPushDelivered(grant({ scopes: undefined }), states, NOW)).toEqual(all)
    expect(garminPushDelivered(grant({ scopes: [] }), states, NOW)).toEqual(all)
    expect(garminPushDelivered(grant({ scopes: [] }), [state('dailies', hoursBefore(25))], NOW)).toEqual([])
  })

  test('every delivering push type, in data type order, each once', () => {
    const states = [
      'activities',
      'allDayRespiration',
      'pulseox',
      'stressDetails',
      'hrv',
      'sleeps',
      'dailies',
      'dailies',
      'bodyComps',
      'userMetrics',
    ].map((type) => state(type, hoursBefore(1)))

    expect(garminPushDelivered(grant(), states, NOW)).toEqual([
      'dailySummary',
      'heartRate',
      'hrv',
      'sleep',
      'stress',
      'bodyBattery',
      'activities',
      'spo2',
      'respiration',
      'intensityMinutes',
    ])
  })
})
