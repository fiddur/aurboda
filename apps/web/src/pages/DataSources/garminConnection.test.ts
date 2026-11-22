import type { GarminOAuthStatus } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  addDaysToIsoDate,
  connectErrorText,
  garminConnectionFlags,
  garminDataTypeNote,
  garminDataTypeSourceNote,
  garminLastReceivedText,
  garminLoginOnlyData,
  garminPermissionLabel,
  garminSwitchStep,
  joinList,
  KEY_EXPIRY_CHOICES,
  keyExpiryState,
  localIsoDate,
} from './garminConnection'

describe('expiry quick choices', () => {
  it('offers 30, 90 and 180 days and a year', () => {
    expect(KEY_EXPIRY_CHOICES.map((c) => c.days)).toEqual([30, 90, 180, 365])
  })

  it('adds the days to today, across month and year ends', () => {
    expect(addDaysToIsoDate('2026-11-13', 30)).toBe('2026-12-13')
    expect(addDaysToIsoDate('2026-11-13', 90)).toBe('2027-02-11')
    expect(addDaysToIsoDate('2026-11-13', 365)).toBe('2027-11-13')
    expect(addDaysToIsoDate('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('formats a local date', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})

describe('keyExpiryState', () => {
  const today = '2026-11-13'

  it('is ok with more than 14 days left', () => {
    expect(keyExpiryState({ expires_at: '2026-11-28', refused: false }, today)).toBe('ok')
  })

  it('warns with 14 days or less left, including the last day', () => {
    expect(keyExpiryState({ expires_at: '2026-11-27', refused: false }, today)).toBe('warning')
    expect(keyExpiryState({ expires_at: today, refused: false }, today)).toBe('warning')
  })

  it('is an error once past, or when Garmin refused the key', () => {
    expect(keyExpiryState({ expires_at: '2026-11-12', refused: false }, today)).toBe('error')
    expect(keyExpiryState({ expires_at: '2027-11-13', refused: true }, today)).toBe('error')
  })

  it('is ok without a known expiry', () => {
    expect(keyExpiryState({ expires_at: null, refused: false }, today)).toBe('ok')
  })
})

describe('connectErrorText', () => {
  it('shows the API message, and a hint for field errors', () => {
    expect(connectErrorText('Garmin refused the key')).toBe('Garmin refused the key')
    expect(connectErrorText({ api_key: ['Too small'] })).toBe('Check the key and the expiry date')
    expect(connectErrorText(undefined)).toBe('Check the key and the expiry date')
  })
})

describe('garminConnectionFlags', () => {
  const key = { available: true, connected: true, expires_at: '2027-01-01', refused: false }

  it('is key-only with a key and no login', () => {
    expect(
      garminConnectionFlags({
        garmin_connected: true,
        garmin_personal_key: key,
        garmin_session_connected: false,
      }),
    ).toEqual({
      canPull: true,
      isConnected: true,
      keyOnly: true,
      oauth: {
        available: false,
        connected: false,
        delivers: [],
        last_received_at: null,
        needs_reconnect: false,
        permissions: [],
      },
      personalKey: key,
      sessionConnected: false,
    })
  })

  it('is not key-only with the login too, or with nothing', () => {
    expect(
      garminConnectionFlags({
        garmin_connected: true,
        garmin_personal_key: key,
        garmin_session_connected: true,
      }).keyOnly,
    ).toBe(false)
    expect(garminConnectionFlags(undefined)).toEqual({
      canPull: false,
      isConnected: false,
      keyOnly: false,
      oauth: {
        available: false,
        connected: false,
        delivers: [],
        last_received_at: null,
        needs_reconnect: false,
        permissions: [],
      },
      personalKey: undefined,
      sessionConnected: false,
    })
  })

  it('is connected but cannot pull with Connect with Garmin alone', () => {
    const oauth = {
      available: true,
      connected: true,
      delivers: [],
      last_received_at: null,
      needs_reconnect: false,
      permissions: ['HEALTH_EXPORT'],
    }
    const flags = garminConnectionFlags({
      garmin_connected: true,
      garmin_oauth: oauth,
      garmin_personal_key: { ...key, connected: false, expires_at: null },
      garmin_session_connected: false,
    })
    expect(flags).toMatchObject({ canPull: false, isConnected: true, keyOnly: false, oauth })
  })

  it('can pull with the login or a key', () => {
    expect(garminConnectionFlags({ garmin_session_connected: true }).canPull).toBe(true)
    expect(garminConnectionFlags({ garmin_personal_key: key }).canPull).toBe(true)
  })

  it('cannot pull with only a refused or expired key, but still reports the key', () => {
    const today = '2026-11-22'
    const refused = { ...key, refused: true }
    const expired = { ...key, expires_at: '2026-11-21' }
    for (const personalKey of [refused, expired]) {
      const flags = garminConnectionFlags({ garmin_personal_key: personalKey }, today)
      expect(flags.canPull).toBe(false)
      expect(flags.personalKey).toBe(personalKey)
    }
    expect(garminConnectionFlags({ garmin_personal_key: { ...key, expires_at: today } }, today).canPull).toBe(
      true,
    )
    expect(
      garminConnectionFlags({ garmin_personal_key: expired, garmin_session_connected: true }, today).canPull,
    ).toBe(true)
  })
})

describe('garminDataTypeNote', () => {
  const notes = { key_note: 'key', push_note: 'push' }

  it('shows the key note for a key alone', () => {
    expect(garminDataTypeNote(notes, { keyOnly: true, pushOnly: false })).toBe('key')
  })

  it('shows the push note for Connect with Garmin alone', () => {
    expect(garminDataTypeNote(notes, { keyOnly: false, pushOnly: true })).toBe('push')
  })

  it('shows nothing with the login, or when the type has no note', () => {
    expect(garminDataTypeNote(notes, { keyOnly: false, pushOnly: false })).toBeUndefined()
    expect(garminDataTypeNote({}, { keyOnly: true, pushOnly: false })).toBeUndefined()
    expect(garminDataTypeNote({ key_note: 'key' }, { keyOnly: false, pushOnly: true })).toBeUndefined()
  })
})

describe('garminLastReceivedText', () => {
  const now = new Date('2026-11-17T10:00:00Z')

  it('says how long ago Garmin last pushed', () => {
    expect(garminLastReceivedText('2026-11-17T07:00:00Z', now)).toBe('Last data received about 3 hours ago')
    expect(garminLastReceivedText('2026-11-15T10:00:00Z', now)).toBe('Last data received 2 days ago')
  })

  it('says nothing has arrived yet, and when it will', () => {
    expect(garminLastReceivedText(null, now)).toBe(
      'No data received yet. Garmin sends data the next time your watch syncs.',
    )
  })
})

describe('garminPermissionLabel', () => {
  it('names the known permissions and passes others through', () => {
    expect(garminPermissionLabel('HEALTH_EXPORT')).toBe('Health data')
    expect(garminPermissionLabel('ACTIVITY_EXPORT')).toBe('Activities')
    expect(garminPermissionLabel('MCT_EXPORT')).toBe('Cycle tracking')
    expect(garminPermissionLabel('WORKOUT_IMPORT')).toBe('Sending workouts')
    expect(garminPermissionLabel('COURSE_IMPORT')).toBe('Sending courses')
    expect(garminPermissionLabel('NEW_THING')).toBe('NEW_THING')
  })
})

describe('garminSwitchStep', () => {
  const oauth = (over: Partial<GarminOAuthStatus> = {}): GarminOAuthStatus => ({
    available: true,
    connected: false,
    delivers: [],
    last_received_at: null,
    needs_reconnect: false,
    permissions: [],
    ...over,
  })

  it('is null without the login', () => {
    expect(garminSwitchStep({ oauth: oauth(), sessionConnected: false })).toBeNull()
    expect(
      garminSwitchStep({
        oauth: oauth({ connected: true, last_received_at: '2026-11-01T00:00:00Z' }),
        sessionConnected: false,
      }),
    ).toBeNull()
  })

  it('is null when the server does not offer Connect with Garmin and it is not connected', () => {
    expect(garminSwitchStep({ oauth: oauth({ available: false }), sessionConnected: true })).toBeNull()
  })

  it('is connect when the login is connected and Connect with Garmin is not', () => {
    expect(garminSwitchStep({ oauth: oauth(), sessionConnected: true })).toBe('connect')
  })

  it('is connect when Connect with Garmin needs reconnecting', () => {
    expect(
      garminSwitchStep({
        oauth: oauth({ connected: true, last_received_at: '2026-11-01T00:00:00Z', needs_reconnect: true }),
        sessionConnected: true,
      }),
    ).toBe('connect')
  })

  it('is wait when connected and nothing has arrived yet', () => {
    expect(garminSwitchStep({ oauth: oauth({ connected: true }), sessionConnected: true })).toBe('wait')
  })

  it('is ready when connected and data has arrived, even if the server no longer offers it', () => {
    expect(
      garminSwitchStep({
        oauth: oauth({ available: false, connected: true, last_received_at: '2026-11-01T00:00:00Z' }),
        sessionConnected: true,
      }),
    ).toBe('ready')
  })
})

describe('garminLoginOnlyData', () => {
  it('is null when the login is the only connection', () => {
    expect(garminLoginOnlyData({ keyConnected: false, oauthConnected: false })).toBeNull()
  })

  it('lists what Connect with Garmin alone lacks', () => {
    expect(garminLoginOnlyData({ keyConnected: false, oauthConnected: true })).toEqual([
      'training readiness',
      'data from before you connected',
      'syncing on demand',
    ])
  })

  it('lists what a key alone lacks', () => {
    expect(garminLoginOnlyData({ keyConnected: true, oauthConnected: false })).toEqual([
      'stress',
      'the sleep stage timeline',
      'training readiness',
    ])
  })

  it('lists what both together lack', () => {
    expect(garminLoginOnlyData({ keyConnected: true, oauthConnected: true })).toEqual(['training readiness'])
  })
})

describe('joinList', () => {
  it('joins with commas and a final and', () => {
    expect(joinList([])).toBe('')
    expect(joinList(['a'])).toBe('a')
    expect(joinList(['a', 'b'])).toBe('a and b')
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c')
  })
})

describe('garminDataTypeSourceNote', () => {
  const loginAndKey = {
    activities: 'personal_key',
    dailySummary: 'push',
    hrv: 'personal_key',
    sleep: 'push',
    stress: 'session',
    trainingReadiness: 'session',
  } as const

  it('says nothing while Connect with Garmin delivers nothing', () => {
    expect(
      garminDataTypeSourceNote('sleep', { hrv: 'personal_key', sleep: 'session', stress: 'session' }),
    ).toBeUndefined()
    expect(garminDataTypeSourceNote('sleep', undefined)).toBeUndefined()
  })

  it('names Connect with Garmin for a type it delivers', () => {
    expect(garminDataTypeSourceNote('sleep', loginAndKey)).toBe('Delivered by Connect with Garmin')
  })

  it('with a login and a key, names the key for the types the key serves and the login for the rest', () => {
    expect(garminDataTypeSourceNote('hrv', loginAndKey)).toBe('Fetched with the Personal API key')
    expect(garminDataTypeSourceNote('activities', loginAndKey)).toBe('Fetched with the Personal API key')
    expect(garminDataTypeSourceNote('stress', loginAndKey)).toBe('Fetched through the Garmin login')
    expect(garminDataTypeSourceNote('trainingReadiness', loginAndKey)).toBe(
      'Fetched through the Garmin login',
    )
  })

  it('says nothing for a type no connection brings', () => {
    expect(garminDataTypeSourceNote('stress', { sleep: 'push' })).toBeUndefined()
  })
})
