/**
 * User settings service for HR zones and other user preferences.
 */

import { getUserSettings, upsertUserSettings } from '../db'

// ============================================================================
// Types
// ============================================================================

export type HrZoneThresholds = { 1: number; 2: number; 3: number; 4: number; 5: number }

export interface UserSettings {
  birthDate?: string // YYYY-MM-DD
  hrZoneStart?: HrZoneThresholds
}

export interface HrZoneSecs {
  0: number
  1: number
  2: number
  3: number
  4: number
  5: number
}

export type HrZoneSource = 'custom' | 'age_based' | 'default'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_HR = 180 // Assumes age ~40
const MAX_GAP_SECONDS = 5 // Cap time gap between samples
const SINGLE_SAMPLE_SECONDS = 1 // Default time for single sample

// Zone percentages of max HR
const ZONE_PERCENTAGES = {
  1: 0.5, // 50%
  2: 0.6, // 60%
  3: 0.7, // 70%
  4: 0.8, // 80%
  5: 0.9, // 90%
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Calculate age from birth date.
 */
const calculateAge = (birthDate: string): number => {
  const birth = new Date(birthDate)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

/**
 * Calculate default HR zones based on birth date (age-based) or use defaults.
 * Uses the 220-age formula for max HR, with zones at 50/60/70/80/90%.
 */
export const calculateDefaultHrZones = (birthDate: string | null): HrZoneThresholds => {
  const maxHr = birthDate ? 220 - calculateAge(birthDate) : DEFAULT_MAX_HR

  return {
    1: Math.round(maxHr * ZONE_PERCENTAGES[1]),
    2: Math.round(maxHr * ZONE_PERCENTAGES[2]),
    3: Math.round(maxHr * ZONE_PERCENTAGES[3]),
    4: Math.round(maxHr * ZONE_PERCENTAGES[4]),
    5: Math.round(maxHr * ZONE_PERCENTAGES[5]),
  }
}

/**
 * Get user settings from database.
 */
export const getSettings = async (user: string): Promise<UserSettings> => {
  const settings = await getUserSettings(user)
  return settings ?? {}
}

/**
 * Update user settings (partial update).
 */
export const updateSettings = async (user: string, updates: Partial<UserSettings>): Promise<UserSettings> => {
  return await upsertUserSettings(user, updates)
}

/**
 * Get effective HR zones for a user.
 * Priority: custom zones > age-based zones (from birth date) > default zones
 */
export const getEffectiveHrZones = async (
  user: string,
): Promise<{ zones: HrZoneThresholds; source: HrZoneSource }> => {
  const settings = await getSettings(user)

  // Custom zones take priority
  if (settings.hrZoneStart) {
    return { source: 'custom', zones: settings.hrZoneStart }
  }

  // Age-based zones if birth date is set
  if (settings.birthDate) {
    return { source: 'age_based', zones: calculateDefaultHrZones(settings.birthDate) }
  }

  // Default zones
  return { source: 'default', zones: calculateDefaultHrZones(null) }
}

/**
 * Determine which zone a heart rate value belongs to.
 * Zone 0: below zone 1 threshold
 * Zone 1-4: between zone N and zone N+1 threshold
 * Zone 5: at or above zone 5 threshold
 */
const getZone = (hr: number, zones: HrZoneThresholds): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (hr >= zones[5]) return 5
  if (hr >= zones[4]) return 4
  if (hr >= zones[3]) return 3
  if (hr >= zones[2]) return 2
  if (hr >= zones[1]) return 1
  return 0
}

/**
 * Compute time spent in each HR zone from heart rate data.
 * Uses actual time gaps between consecutive samples, capped at MAX_GAP_SECONDS.
 * Last sample uses mean gap time from preceding samples.
 */
export const computeHrZoneSecs = (hrData: [Date, number][], zones: HrZoneThresholds): HrZoneSecs => {
  const result: HrZoneSecs = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }

  if (hrData.length === 0) {
    return result
  }

  // Single sample case
  if (hrData.length === 1) {
    const zone = getZone(hrData[0][1], zones)
    result[zone] = SINGLE_SAMPLE_SECONDS
    return result
  }

  // Calculate gaps and track for mean calculation
  const gaps: number[] = []

  for (let i = 0; i < hrData.length - 1; i++) {
    const [time, hr] = hrData[i]
    const nextTime = hrData[i + 1][0]

    // Calculate gap in seconds, capped at MAX_GAP_SECONDS
    const gapMs = nextTime.getTime() - time.getTime()
    const gapSec = Math.min(gapMs / 1000, MAX_GAP_SECONDS)
    gaps.push(gapSec)

    // Add time to appropriate zone
    const zone = getZone(hr, zones)
    result[zone] += gapSec
  }

  // Handle last sample using mean gap time
  const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const lastZone = getZone(hrData[hrData.length - 1][1], zones)
  result[lastZone] += Math.min(meanGap, MAX_GAP_SECONDS)

  return result
}
