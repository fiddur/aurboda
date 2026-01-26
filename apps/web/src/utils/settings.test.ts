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
  const baseServerSettings: UserSettingsResponse = {
    birthDate: '1990-01-15',
    hrZoneStart: { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 },
    success: true,
  }

  test('returns null when nothing changed', () => {
    const result = computeSettingsUpdateParams(
      '1990-01-15',
      baseServerSettings.hrZoneStart!,
      baseServerSettings,
    )

    expect(result).toBe(null)
  })

  test('returns only birthDate when only that changed', () => {
    const result = computeSettingsUpdateParams(
      '1985-06-20',
      baseServerSettings.hrZoneStart!,
      baseServerSettings,
    )

    expect(result).toEqual({ birthDate: '1985-06-20' })
  })

  test('returns only hrZoneStart when only that changed', () => {
    const newZones: HrZoneThresholds = { 1: 95, 2: 110, 3: 130, 4: 150, 5: 170 }
    const result = computeSettingsUpdateParams('1990-01-15', newZones, baseServerSettings)

    expect(result).toEqual({ hrZoneStart: newZones })
  })

  test('returns both when both changed', () => {
    const newZones: HrZoneThresholds = { 1: 95, 2: 115, 3: 135, 4: 155, 5: 175 }
    const result = computeSettingsUpdateParams('2000-12-25', newZones, baseServerSettings)

    expect(result).toEqual({
      birthDate: '2000-12-25',
      hrZoneStart: newZones,
    })
  })

  test('handles empty birthDate being set to null', () => {
    const result = computeSettingsUpdateParams('', baseServerSettings.hrZoneStart!, baseServerSettings)

    expect(result).toEqual({ birthDate: null })
  })

  test('handles clearing hrZoneStart (setting to null)', () => {
    const result = computeSettingsUpdateParams('1990-01-15', null, baseServerSettings)

    expect(result).toEqual({ hrZoneStart: null })
  })

  test('handles undefined server settings', () => {
    const result = computeSettingsUpdateParams('1990-01-15', null, undefined)

    expect(result).toEqual({ birthDate: '1990-01-15' })
  })

  test('handles server settings with no birthDate', () => {
    const serverSettings: UserSettingsResponse = { success: true }
    const result = computeSettingsUpdateParams('', null, serverSettings)

    expect(result).toBe(null)
  })

  test('handles server settings with no hrZoneStart', () => {
    const serverSettings: UserSettingsResponse = { birthDate: '1990-01-15', success: true }
    const zones: HrZoneThresholds = { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 }
    const result = computeSettingsUpdateParams('1990-01-15', zones, serverSettings)

    expect(result).toEqual({ hrZoneStart: zones })
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
