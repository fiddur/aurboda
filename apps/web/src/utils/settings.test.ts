import { describe, expect, test } from 'vitest'
import type { HrZoneThresholds, UserSettingsResponse } from '../state/api'
import { defaultHrZoneThresholds } from './hrZones'
import {
  computeSettingsUpdateParams,
  parseZoneValue,
  updateZoneThreshold,
  validateHrZoneThresholds,
} from './settings'

describe('parseZoneValue', () => {
  test('parses valid integer strings', () => {
    expect(parseZoneValue('100')).toBe(100)
    expect(parseZoneValue('0')).toBe(0)
    expect(parseZoneValue('220')).toBe(220)
  })

  test('returns null for invalid strings', () => {
    expect(parseZoneValue('')).toBe(null)
    expect(parseZoneValue('abc')).toBe(null)
    expect(parseZoneValue('12.5')).toBe(12) // parseInt truncates
  })

  test('handles negative numbers', () => {
    expect(parseZoneValue('-10')).toBe(-10)
  })
})

describe('updateZoneThreshold', () => {
  test('updates existing zones object', () => {
    const current: HrZoneThresholds = { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 }
    const result = updateZoneThreshold(current, 2, 115)

    expect(result).toEqual({ 1: 90, 2: 115, 3: 130, 4: 150, 5: 170 })
  })

  test('uses defaults when current is null', () => {
    const result = updateZoneThreshold(null, 3, 125)

    expect(result).toEqual({
      ...defaultHrZoneThresholds,
      3: 125,
    })
  })

  test('does not mutate original object', () => {
    const current: HrZoneThresholds = { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 }
    updateZoneThreshold(current, 2, 115)

    expect(current[2]).toBe(110)
  })
})

describe('computeSettingsUpdateParams', () => {
  const baseServerSettings = {
    birth_date: '1990-01-15',
    hr_zone_start: { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 },
    hr_zone_start_source: 'custom',
    oura_configured: false,
    oura_connected: false,
    rescue_time_key: 'test-key-123',
    success: true,
  } as UserSettingsResponse

  test('returns null when nothing changed', () => {
    const result = computeSettingsUpdateParams(
      '1990-01-15',
      baseServerSettings.hr_zone_start!,
      'test-key-123',
      baseServerSettings,
    )

    expect(result).toBe(null)
  })

  test('returns only birthDate when only that changed', () => {
    const result = computeSettingsUpdateParams(
      '1985-06-20',
      baseServerSettings.hr_zone_start!,
      'test-key-123',
      baseServerSettings,
    )

    expect(result).toEqual({ birth_date: '1985-06-20' })
  })

  test('returns only hrZoneStart when only that changed', () => {
    const newZones: HrZoneThresholds = { 1: 95, 2: 110, 3: 130, 4: 150, 5: 170 }
    const result = computeSettingsUpdateParams('1990-01-15', newZones, 'test-key-123', baseServerSettings)

    expect(result).toEqual({ hr_zone_start: newZones })
  })

  test('returns only rescue_time_key when only that changed', () => {
    const result = computeSettingsUpdateParams(
      '1990-01-15',
      baseServerSettings.hr_zone_start!,
      'new-key-456',
      baseServerSettings,
    )

    expect(result).toEqual({ rescue_time_key: 'new-key-456' })
  })

  test('returns all when all changed', () => {
    const newZones: HrZoneThresholds = { 1: 95, 2: 115, 3: 135, 4: 155, 5: 175 }
    const result = computeSettingsUpdateParams('2000-12-25', newZones, 'new-key', baseServerSettings)

    expect(result).toEqual({
      birth_date: '2000-12-25',
      hr_zone_start: newZones,
      rescue_time_key: 'new-key',
    })
  })

  test('handles empty birth_date being set to null', () => {
    const result = computeSettingsUpdateParams(
      '',
      baseServerSettings.hr_zone_start!,
      'test-key-123',
      baseServerSettings,
    )

    expect(result).toEqual({ birth_date: null })
  })

  test('handles clearing hr_zone_start (setting to null)', () => {
    const result = computeSettingsUpdateParams('1990-01-15', null, 'test-key-123', baseServerSettings)

    expect(result).toEqual({ hr_zone_start: null })
  })

  test('handles clearing rescue_time_key (setting to null)', () => {
    const result = computeSettingsUpdateParams(
      '1990-01-15',
      baseServerSettings.hr_zone_start!,
      '',
      baseServerSettings,
    )

    expect(result).toEqual({ rescue_time_key: null })
  })

  test('handles undefined server settings', () => {
    const result = computeSettingsUpdateParams('1990-01-15', null, '', undefined)

    expect(result).toEqual({ birth_date: '1990-01-15' })
  })

  test('handles server settings with no birth_date', () => {
    // Server has no birth_date, form also empty - no changes
    const serverSettings = {
      hr_zone_start_source: 'default',
      oura_configured: false,
      oura_connected: false,
      success: true,
    } as UserSettingsResponse
    const result = computeSettingsUpdateParams('', null, '', serverSettings)

    expect(result).toBe(null)
  })

  test('handles server settings with no hr_zone_start', () => {
    // Server has no hr_zone_start (undefined -> null), form has zones - change detected
    const serverSettings = {
      birth_date: '1990-01-15',
      hr_zone_start_source: 'default',
      oura_configured: false,
      oura_connected: false,
      success: true,
    } as UserSettingsResponse
    const zones: HrZoneThresholds = { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 }
    const result = computeSettingsUpdateParams('1990-01-15', zones, '', serverSettings)

    expect(result).toEqual({ hr_zone_start: zones })
  })
})

describe('validateHrZoneThresholds', () => {
  test('valid zones pass validation', () => {
    const zones: HrZoneThresholds = { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 }
    const result = validateHrZoneThresholds(zones)

    expect(result).toEqual({ valid: true })
  })

  test('default thresholds are valid', () => {
    const result = validateHrZoneThresholds(defaultHrZoneThresholds)

    expect(result).toEqual({ valid: true })
  })

  test('fails when zone is below minimum', () => {
    const zones: HrZoneThresholds = { 1: 30, 2: 110, 3: 130, 4: 150, 5: 170 }
    const result = validateHrZoneThresholds(zones)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Zone 1')
    expect(result.error).toContain('between 40 and 220')
  })

  test('fails when zone is above maximum', () => {
    const zones: HrZoneThresholds = { 1: 90, 2: 110, 3: 130, 4: 150, 5: 230 }
    const result = validateHrZoneThresholds(zones)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Zone 5')
  })

  test('fails when zones are not in ascending order', () => {
    const zones: HrZoneThresholds = { 1: 90, 2: 110, 3: 100, 4: 150, 5: 170 }
    const result = validateHrZoneThresholds(zones)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('greater than')
  })

  test('fails when zones are equal', () => {
    const zones: HrZoneThresholds = { 1: 90, 2: 110, 3: 110, 4: 150, 5: 170 }
    const result = validateHrZoneThresholds(zones)

    expect(result.valid).toBe(false)
  })

  test('boundary values are valid', () => {
    const zones: HrZoneThresholds = { 1: 40, 2: 80, 3: 120, 4: 160, 5: 220 }
    const result = validateHrZoneThresholds(zones)

    expect(result).toEqual({ valid: true })
  })
})
