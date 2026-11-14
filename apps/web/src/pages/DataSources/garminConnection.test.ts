import { describe, expect, it } from 'vitest'

import {
  addDaysToIsoDate,
  connectErrorText,
  garminConnectionFlags,
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
    ).toEqual({ isConnected: true, keyOnly: true, personalKey: key, sessionConnected: false })
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
      isConnected: false,
      keyOnly: false,
      personalKey: undefined,
      sessionConnected: false,
    })
  })
})
