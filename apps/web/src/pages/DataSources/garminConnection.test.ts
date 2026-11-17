import { describe, expect, it } from 'vitest'

import {
  addDaysToIsoDate,
  connectErrorText,
  garminConnectionFlags,
  garminLastReceivedText,
  garminOAuthReturn,
  garminPermissionLabel,
  KEY_EXPIRY_CHOICES,
  keyExpiryState,
  localIsoDate,
  oauthErrorText,
  withoutGarminOAuthReturn,
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
})

describe('oauthErrorText', () => {
  it('explains each callback error code, and an unknown one as a failed connection', () => {
    expect(oauthErrorText('auth_failed')).toBe('Garmin did not complete the connection. Try again.')
    expect(oauthErrorText('not_configured')).toBe('This server has not set up Garmin sign-in.')
    expect(oauthErrorText('invalid_state')).toBe('The connection attempt expired. Try again.')
    expect(oauthErrorText('something_else')).toBe('Garmin did not complete the connection. Try again.')
    expect(oauthErrorText(null)).toBeNull()
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

describe('garminOAuthReturn', () => {
  it('reads the code and state the callback hands over', () => {
    expect(garminOAuthReturn('?garmin_code=fake-code&garmin_state=fake%2Bstate')).toEqual({
      code: 'fake-code',
      state: 'fake+state',
    })
  })

  it('is null unless both are present and non-empty', () => {
    expect(garminOAuthReturn('')).toBeNull()
    expect(garminOAuthReturn('?garmin_code=fake-code')).toBeNull()
    expect(garminOAuthReturn('?garmin_state=fake-state')).toBeNull()
    expect(garminOAuthReturn('?garmin_code=&garmin_state=fake-state')).toBeNull()
    expect(garminOAuthReturn('?error=auth_failed')).toBeNull()
  })
})

describe('withoutGarminOAuthReturn', () => {
  it('removes the code and state and keeps everything else', () => {
    expect(withoutGarminOAuthReturn('?embed=1&garmin_code=fake-code&garmin_state=fake-state')).toBe(
      '?embed=1',
    )
    expect(withoutGarminOAuthReturn('?garmin_code=fake-code&garmin_state=fake-state')).toBe('')
    expect(withoutGarminOAuthReturn('')).toBe('')
    expect(withoutGarminOAuthReturn('?embed=1')).toBe('?embed=1')
  })
})
