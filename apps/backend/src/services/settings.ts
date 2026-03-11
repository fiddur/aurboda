/**
 * User settings service for HR zones and other user preferences.
 */

import {
  defaultGoals,
  type Goal,
  type HrZoneSecs,
  type HrZoneSource,
  type HrZoneThresholds,
  updateSettingsInputSchema,
  type UserSettingsResponse,
} from '@aurboda/api-spec'
import { getOAuthToken, getUserSettings, updateTagNameByKey, upsertUserSettings } from '../db'
import { getCentralDb } from './central-db'

// Re-export types from api-spec for use by other modules
export type { HrZoneSecs, HrZoneSource, HrZoneThresholds }

// ============================================================================
// Types
// ============================================================================

import type { UserSettings } from '../db/types'
export type { UserSettings }

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
  if (settings.hr_zone_start) {
    return { source: 'custom', zones: settings.hr_zone_start }
  }

  // Age-based zones if birth date is set
  if (settings.birth_date) {
    return { source: 'age_based', zones: calculateDefaultHrZones(settings.birth_date) }
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
 * Build the settings updates object for a tag mapping change.
 * Handles both the mapping itself and any icon set/clear.
 */
export const buildTagMappingUpdates = (
  currentSettings: UserSettings,
  tagKey: string,
  name: string,
  icon?: string,
): Partial<UserSettings> => {
  const currentMappings = currentSettings.tag_mappings ?? {}
  const updates: Partial<UserSettings> = {
    tag_mappings: { ...currentMappings, [tagKey]: name },
  }

  if (icon !== undefined) {
    const currentIcons = currentSettings.item_icons ?? {}
    if (icon) {
      updates.item_icons = { ...currentIcons, [name]: icon }
    } else {
      // Empty string clears the icon — remove entries for both display name and tag_key
      const newIcons = { ...currentIcons }
      delete newIcons[name]
      delete newIcons[tagKey]
      updates.item_icons = newIcons
    }
  }

  return updates
}

/**
 * Set a tag mapping (display name + optional icon) and rename existing tag records.
 * Used by both REST API and MCP tools.
 */
export const setTagMapping = async (
  user: string,
  tagKey: string,
  name: string,
  icon?: string,
): Promise<Record<string, string>> => {
  const settings = await getSettings(user)
  const updates = buildTagMappingUpdates(settings, tagKey, name, icon)
  await upsertUserSettings(user, updates)
  await updateTagNameByKey(user, tagKey, name)
  return updates.tag_mappings!
}

/**
 * Get tag mappings and icons for a user.
 * Used by both REST API and MCP tools.
 */
export const getTagMappings = async (
  user: string,
): Promise<{ mappings: Record<string, string>; icons: Record<string, string> }> => {
  const settings = await getSettings(user)
  return {
    icons: settings.item_icons ?? {},
    mappings: settings.tag_mappings ?? {},
  }
}

/**
 * Get settings response in the format used by both API and MCP.
 */
export const getSettingsResponse = async (user: string): Promise<SettingsResponse> => {
  const settings = await getSettings(user)
  const { zones, source } = await getEffectiveHrZones(user)
  const ouraToken = await getOAuthToken(user, 'oura')
  const ouraConfigured = !!(process.env.OURA_CLIENT && process.env.OURA_SECRET)
  const lastFmApiKey = await getCentralDb().getLastFmApiKey()
  const lastFmConfigured = !!lastFmApiKey

  return {
    birth_date: settings.birth_date ?? null,
    calendars: settings.calendars ?? [],
    dashboard: settings.dashboard ?? null,
    goals: getEffectiveGoals(settings),
    hr_zone_start: zones,
    hr_zone_start_source: source,
    item_icons: settings.item_icons ?? {},
    lastfm_configured: lastFmConfigured,
    lastfm_username: settings.lastfm_username ?? null,
    oura_configured: ouraConfigured,
    oura_connected: ouraToken !== null,
    rescue_time_key: settings.rescue_time_key ?? null,
    sex: settings.sex ?? null,
    success: true,
    tag_icons: settings.item_icons ?? {},
    tag_mappings: settings.tag_mappings ?? {},
    training_load: settings.training_load ?? null,
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
      calendars: [],
      dashboard: null,
      error: errorMessage,
      goals: defaultGoals,
      hr_zone_start: calculateDefaultHrZones(null),
      hr_zone_start_source: 'default',
      item_icons: {},
      lastfm_configured: !!(await getCentralDb().getLastFmApiKey()),
      lastfm_username: null,
      oura_configured: !!(process.env.OURA_CLIENT && process.env.OURA_SECRET),
      oura_connected: false,
      rescue_time_key: null,
      sex: null,
      success: false,
      tag_icons: {},
      tag_mappings: {},
      training_load: null,
    }
  }

  // Build updates object, converting null to undefined (which clears/resets the field in storage)
  const settingsFields = [
    'birth_date',
    'calendars',
    'dashboard',
    'goals',
    'hr_zone_start',
    'item_icons',
    'lastfm_username',
    'rescue_time_key',
    'sex',
    'tag_icons',
    'tag_mappings',
    'training_load',
  ] as const
  const updates: Partial<UserSettings> = {}
  for (const field of settingsFields) {
    if (parsed.data[field] !== undefined) {
      ;(updates as Record<string, unknown>)[field] =
        parsed.data[field] === null ? undefined : parsed.data[field]
    }
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
