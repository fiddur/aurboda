import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import {
  calculateDefaultHrZones,
  computeHrZoneSecs,
  getEffectiveHrZones,
  getSettings,
  getSettingsResponse,
  HrZoneThresholds,
  validateAndUpdateSettings,
} from './settings'

// Mock the db module
vi.mock('../db', () => ({
  getOAuthToken: vi.fn(),
  getUserSettings: vi.fn(),
  upsertUserSettings: vi.fn(),
}))

describe('calculateDefaultHrZones', () => {
  test('returns default zones when no birth date provided', () => {
    const zones = calculateDefaultHrZones(null)

    // Default max HR of 180 (age 40 assumed)
    // Zones at 50%, 60%, 70%, 80%, 90% of max HR
    expect(zones).toEqual({
      1: 90, // 50% of 180
      2: 108, // 60% of 180
      3: 126, // 70% of 180
      4: 144, // 80% of 180
      5: 162, // 90% of 180
    })
  })

  test('calculates age-based zones from birth date', () => {
    // Person born 1985-03-15, age ~39-40 in 2025
    // Max HR = 220 - 40 = 180 (approximately)
    const zones = calculateDefaultHrZones('1985-03-15')

    // Max HR should be 220 - age
    // For someone ~40 years old: max HR = 180
    expect(zones[1]).toBeLessThan(zones[2])
    expect(zones[2]).toBeLessThan(zones[3])
    expect(zones[3]).toBeLessThan(zones[4])
    expect(zones[4]).toBeLessThan(zones[5])
  })

  test('calculates zones for younger person', () => {
    // Person born 2000-01-01, age ~25
    // Max HR = 220 - 25 = 195
    const zones = calculateDefaultHrZones('2000-01-01')

    // Zones should be higher than for older person
    const olderZones = calculateDefaultHrZones('1970-01-01')
    expect(zones[1]).toBeGreaterThan(olderZones[1])
  })

  test('zones are rounded to whole numbers', () => {
    const zones = calculateDefaultHrZones('1990-06-15')

    expect(Number.isInteger(zones[1])).toBe(true)
    expect(Number.isInteger(zones[2])).toBe(true)
    expect(Number.isInteger(zones[3])).toBe(true)
    expect(Number.isInteger(zones[4])).toBe(true)
    expect(Number.isInteger(zones[5])).toBe(true)
  })
})

describe('getSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns empty settings when none exist', async () => {
    vi.mocked(db.getUserSettings).mockResolvedValue(null)

    const settings = await getSettings('testuser')

    expect(settings).toEqual({})
    expect(db.getUserSettings).toHaveBeenCalledWith('testuser')
  })

  test('returns stored settings', async () => {
    vi.mocked(db.getUserSettings).mockResolvedValue({
      birthDate: '1985-03-15',
      hrZoneStart: { 1: 86, 2: 103, 3: 121, 4: 138, 5: 155 },
    })

    const settings = await getSettings('testuser')

    expect(settings.birthDate).toBe('1985-03-15')
    expect(settings.hrZoneStart).toEqual({ 1: 86, 2: 103, 3: 121, 4: 138, 5: 155 })
  })
})

describe('getSettingsResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns formatted response with defaults when no settings', async () => {
    vi.mocked(db.getUserSettings).mockResolvedValue(null)
    vi.mocked(db.getOAuthToken).mockResolvedValue(null)

    const result = await getSettingsResponse('testuser')

    expect(result.success).toBe(true)
    expect(result.birth_date).toBeNull()
    expect(result.hr_zone_start_source).toBe('default')
    expect(result.hr_zone_start).toEqual({ 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 })
    expect(result.oura_connected).toBe(false)
    expect(result.rescue_time_key).toBeNull()
  })

  test('returns formatted response with custom zones', async () => {
    const customZones: HrZoneThresholds = { 1: 86, 2: 103, 3: 121, 4: 138, 5: 155 }
    vi.mocked(db.getUserSettings).mockResolvedValue({
      birthDate: '1985-03-15',
      hrZoneStart: customZones,
      rescueTimeKey: 'test-key',
    })
    vi.mocked(db.getOAuthToken).mockResolvedValue({ accessToken: 'token', provider: 'oura' })

    const result = await getSettingsResponse('testuser')

    expect(result.success).toBe(true)
    expect(result.birth_date).toBe('1985-03-15')
    expect(result.hr_zone_start_source).toBe('custom')
    expect(result.hr_zone_start).toEqual(customZones)
    expect(result.oura_connected).toBe(true)
    expect(result.rescue_time_key).toBe('test-key')
  })
})

describe('validateAndUpdateSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('updates birth date with valid input', async () => {
    // getSettingsResponse calls getSettings + getEffectiveHrZones, each calls getUserSettings
    // So we need 2 mock returns for getSettingsResponse
    vi.mocked(db.getUserSettings)
      .mockResolvedValueOnce({ birthDate: '1985-03-15' }) // for getSettings in getSettingsResponse
      .mockResolvedValueOnce({ birthDate: '1985-03-15' }) // for getEffectiveHrZones in getSettingsResponse
    vi.mocked(db.upsertUserSettings).mockResolvedValue({ birthDate: '1985-03-15' })
    vi.mocked(db.getOAuthToken).mockResolvedValue(null)

    const result = await validateAndUpdateSettings('testuser', { birth_date: '1985-03-15' })

    expect(result.success).toBe(true)
    expect(result.birth_date).toBe('1985-03-15')
    expect(db.upsertUserSettings).toHaveBeenCalledWith('testuser', { birthDate: '1985-03-15' })
  })

  test('updates HR zones with valid input', async () => {
    const hrZones: HrZoneThresholds = { 1: 86, 2: 103, 3: 121, 4: 138, 5: 155 }
    // After update, getUserSettings returns the new zones
    vi.mocked(db.getUserSettings).mockResolvedValue({ hrZoneStart: hrZones })
    vi.mocked(db.upsertUserSettings).mockResolvedValue({ hrZoneStart: hrZones })
    vi.mocked(db.getOAuthToken).mockResolvedValue(null)

    const result = await validateAndUpdateSettings('testuser', { hr_zone_start: hrZones })

    expect(result.success).toBe(true)
    expect(result.hr_zone_start_source).toBe('custom')
  })

  test('rejects invalid birth date format', async () => {
    const result = await validateAndUpdateSettings('testuser', { birth_date: '15-03-1985' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('YYYY-MM-DD')
    expect(db.upsertUserSettings).not.toHaveBeenCalled()
  })

  test('rejects invalid date', async () => {
    const result = await validateAndUpdateSettings('testuser', { birth_date: '2024-13-45' })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(db.upsertUserSettings).not.toHaveBeenCalled()
  })

  test('rejects non-ascending HR zones', async () => {
    const result = await validateAndUpdateSettings('testuser', {
      hr_zone_start: { 1: 100, 2: 90, 3: 120, 4: 140, 5: 160 }, // zone 2 < zone 1
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('ascending')
    expect(db.upsertUserSettings).not.toHaveBeenCalled()
  })

  test('clears birth date when set to null', async () => {
    vi.mocked(db.getUserSettings).mockResolvedValue({ birthDate: '1985-03-15' })
    vi.mocked(db.upsertUserSettings).mockResolvedValue({})

    const result = await validateAndUpdateSettings('testuser', { birth_date: null })

    expect(result.success).toBe(true)
    expect(db.upsertUserSettings).toHaveBeenCalledWith('testuser', { birthDate: undefined })
  })

  test('clears HR zones when set to null', async () => {
    const customZones: HrZoneThresholds = { 1: 86, 2: 103, 3: 121, 4: 138, 5: 155 }
    vi.mocked(db.getUserSettings).mockResolvedValue({ hrZoneStart: customZones })
    vi.mocked(db.upsertUserSettings).mockResolvedValue({})

    const result = await validateAndUpdateSettings('testuser', { hr_zone_start: null })

    expect(result.success).toBe(true)
    expect(db.upsertUserSettings).toHaveBeenCalledWith('testuser', { hrZoneStart: undefined })
  })
})

describe('getEffectiveHrZones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns custom zones when configured', async () => {
    const customZones: HrZoneThresholds = { 1: 86, 2: 103, 3: 121, 4: 138, 5: 155 }
    vi.mocked(db.getUserSettings).mockResolvedValue({
      birthDate: '1985-03-15',
      hrZoneStart: customZones,
    })

    const { zones, source } = await getEffectiveHrZones('testuser')

    expect(zones).toEqual(customZones)
    expect(source).toBe('custom')
  })

  test('returns age-based zones when birth date set but no custom zones', async () => {
    vi.mocked(db.getUserSettings).mockResolvedValue({
      birthDate: '1985-03-15',
    })

    const { zones, source } = await getEffectiveHrZones('testuser')

    expect(source).toBe('age_based')
    // Zones should be calculated from birth date
    expect(zones[1]).toBeLessThan(zones[2])
  })

  test('returns default zones when no settings configured', async () => {
    vi.mocked(db.getUserSettings).mockResolvedValue(null)

    const { zones, source } = await getEffectiveHrZones('testuser')

    expect(source).toBe('default')
    expect(zones).toEqual({
      1: 90,
      2: 108,
      3: 126,
      4: 144,
      5: 162,
    })
  })
})

describe('computeHrZoneSecs', () => {
  const defaultZones: HrZoneThresholds = {
    1: 90, // Zone 1: 90-107
    2: 108, // Zone 2: 108-125
    3: 126, // Zone 3: 126-143
    4: 144, // Zone 4: 144-161
    5: 162, // Zone 5: 162+
  }

  test('returns all zeros for empty data', () => {
    const result = computeHrZoneSecs([], defaultZones)

    expect(result).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  })

  test('correctly buckets HR into zone 0 (below zone 1)', () => {
    const hrData: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 80],
      [new Date('2024-01-15T10:00:02Z'), 85],
    ]

    const result = computeHrZoneSecs(hrData, defaultZones)

    // 2 seconds between samples, plus some time for the last sample
    expect(result[0]).toBeGreaterThan(0)
    expect(result[1]).toBe(0)
    expect(result[2]).toBe(0)
  })

  test('correctly buckets HR into zone 1', () => {
    const hrData: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 95],
      [new Date('2024-01-15T10:00:02Z'), 100],
    ]

    const result = computeHrZoneSecs(hrData, defaultZones)

    expect(result[0]).toBe(0)
    expect(result[1]).toBeGreaterThan(0)
  })

  test('correctly buckets HR into zone 5', () => {
    const hrData: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 175],
      [new Date('2024-01-15T10:00:02Z'), 180],
    ]

    const result = computeHrZoneSecs(hrData, defaultZones)

    expect(result[5]).toBeGreaterThan(0)
  })

  test('caps time gap at 5 seconds', () => {
    const hrData: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 95],
      [new Date('2024-01-15T10:00:30Z'), 100], // 30 second gap
    ]

    const result = computeHrZoneSecs(hrData, defaultZones)

    // Total should be capped at 5 + last sample time (uses mean gap which is 5)
    const total = Object.values(result).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(10) // 5 sec + 5 sec max for last sample
  })

  test('handles mixed zones correctly', () => {
    const hrData: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 80], // Zone 0
      [new Date('2024-01-15T10:00:02Z'), 95], // Zone 1
      [new Date('2024-01-15T10:00:04Z'), 110], // Zone 2
      [new Date('2024-01-15T10:00:06Z'), 130], // Zone 3
      [new Date('2024-01-15T10:00:08Z'), 150], // Zone 4
      [new Date('2024-01-15T10:00:10Z'), 170], // Zone 5
    ]

    const result = computeHrZoneSecs(hrData, defaultZones)

    // Each sample should have 2 seconds
    expect(result[0]).toBe(2)
    expect(result[1]).toBe(2)
    expect(result[2]).toBe(2)
    expect(result[3]).toBe(2)
    expect(result[4]).toBe(2)
    expect(result[5]).toBeGreaterThan(0) // Last sample uses mean gap
  })

  test('uses mean gap time for last sample', () => {
    const hrData: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 95],
      [new Date('2024-01-15T10:00:02Z'), 95],
      [new Date('2024-01-15T10:00:04Z'), 95],
      [new Date('2024-01-15T10:00:06Z'), 95], // Last sample
    ]

    const result = computeHrZoneSecs(hrData, defaultZones)

    // 3 gaps of 2 seconds = 6 seconds, plus mean gap (2 seconds) for last sample = 8 total
    expect(result[1]).toBe(8)
  })

  test('single sample gets default time', () => {
    const hrData: [Date, number][] = [[new Date('2024-01-15T10:00:00Z'), 95]]

    const result = computeHrZoneSecs(hrData, defaultZones)

    // Single sample gets 1 second default
    expect(result[1]).toBe(1)
  })

  test('boundary values are handled correctly', () => {
    const zones: HrZoneThresholds = { 1: 100, 2: 120, 3: 140, 4: 160, 5: 180 }

    // Test exact boundary values
    const hrData: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 99], // Zone 0 (below 100)
      [new Date('2024-01-15T10:00:02Z'), 100], // Zone 1 (>= 100)
      [new Date('2024-01-15T10:00:04Z'), 119], // Zone 1 (< 120)
      [new Date('2024-01-15T10:00:06Z'), 120], // Zone 2 (>= 120)
    ]

    const result = computeHrZoneSecs(hrData, zones)

    expect(result[0]).toBe(2) // First sample below zone 1
    expect(result[1]).toBe(4) // Two samples in zone 1
  })
})
