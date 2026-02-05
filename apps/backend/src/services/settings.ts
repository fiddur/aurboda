/**
 * User settings service for HR zones and other user preferences.
 */

import {
  defaultGoals,
  type Goal,
  type HrZoneSecs,
  type HrZoneSource,
  type HrZoneThresholds,
  type TagMappings,
  updateSettingsInputSchema,
  type UserSettingsResponse,
} from '@aurboda/api-spec'
import { getOAuthToken, getUserSettings, upsertUserSettings } from '../db'

// Re-export types from api-spec for use by other modules
export type { HrZoneSecs, HrZoneSource, HrZoneThresholds }

// ============================================================================
// Types
// ============================================================================

export interface UserSettings {
  birthDate?: string // YYYY-MM-DD
  hrZoneStart?: HrZoneThresholds
  rescueTimeKey?: string // RescueTime API key (personal token)
  goals?: Goal[] // User-defined goals for tracking metrics
  tagMappings?: TagMappings // Tag name mappings from UUIDs to display names
}

// Use UserSettingsResponse from api-spec but allow error field for validation failures
export type SettingsResponse = UserSettingsResponse & { error?: string }

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
 * Update user settings (partial update) - internal, no validation.
 */
const updateSettingsInternal = async (
  user: string,
  updates: Partial<UserSettings>,
): Promise<UserSettings> => {
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
 * Get effective goals for a user (user goals or defaults).
 */
export const getEffectiveGoals = (settings: UserSettings): Goal[] => {
  // If goals is undefined, return defaults. If empty array, return empty.
  return settings.goals ?? defaultGoals
}

/**
 * Get settings response in the format used by both API and MCP.
 */
export const getSettingsResponse = async (user: string): Promise<SettingsResponse> => {
  const settings = await getSettings(user)
  const { zones, source } = await getEffectiveHrZones(user)
  const ouraToken = await getOAuthToken(user, 'oura')
  const ouraConfigured = !!(process.env.OURA_CLIENT && process.env.OURA_SECRET)

  return {
    birth_date: settings.birthDate ?? null,
    goals: getEffectiveGoals(settings),
    hr_zone_start: zones,
    hr_zone_start_source: source,
    oura_configured: ouraConfigured,
    oura_connected: ouraToken !== null,
    rescue_time_key: settings.rescueTimeKey ?? null,
    success: true,
    tag_mappings: settings.tagMappings ?? {},
  }
}

/**
 * Validate and update user settings.
 * Returns a SettingsResponse with either success or error.
 */
export const validateAndUpdateSettings = async (user: string, input: unknown): Promise<SettingsResponse> => {
  // Validate input
  const parsed = updateSettingsInputSchema.safeParse(input)
  if (!parsed.success) {
    const errorMessage = parsed.error.issues.map((e) => e.message).join('; ')
    return {
      birth_date: null,
      error: errorMessage,
      goals: defaultGoals,
      hr_zone_start: calculateDefaultHrZones(null),
      hr_zone_start_source: 'default',
      oura_configured: !!(process.env.OURA_CLIENT && process.env.OURA_SECRET),
      oura_connected: false,
      rescue_time_key: null,
      success: false,
      tag_mappings: {},
    }
  }

  // Build updates object, converting null to undefined for clearing
  const updates: Partial<UserSettings> = {}
  if (parsed.data.birth_date !== undefined) {
    updates.birthDate = parsed.data.birth_date === null ? undefined : parsed.data.birth_date
  }
  if (parsed.data.hr_zone_start !== undefined) {
    updates.hrZoneStart = parsed.data.hr_zone_start === null ? undefined : parsed.data.hr_zone_start
  }
  if (parsed.data.rescue_time_key !== undefined) {
    updates.rescueTimeKey = parsed.data.rescue_time_key === null ? undefined : parsed.data.rescue_time_key
  }
  if (parsed.data.goals !== undefined) {
    // null resets to defaults (by removing from storage), empty array clears all goals
    updates.goals = parsed.data.goals === null ? undefined : parsed.data.goals
  }
  if (parsed.data.tag_mappings !== undefined) {
    updates.tagMappings = parsed.data.tag_mappings === null ? undefined : parsed.data.tag_mappings
  }

  // Apply updates
  await updateSettingsInternal(user, updates)

  // Return updated settings
  return getSettingsResponse(user)
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
