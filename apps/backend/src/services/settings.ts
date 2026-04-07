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
  userSettingsResponseSchema,
  type UserSettingsResponse,
} from '@aurboda/api-spec'

import {
  getGoals,
  getOAuthToken,
  getUserSettings,
  replaceGoals,
  updateActivityTypeByTagKey,
  upsertUserSettings,
} from '../db/index.ts'
import { getCentralDb } from './central-db.ts'

// Re-export types from api-spec for use by other modules
export type { HrZoneSecs, HrZoneSource, HrZoneThresholds }

// ============================================================================
// Types
// ============================================================================

import type { UserSettings } from '../db/types.ts'
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
 * Get effective goals for a user (from goals table, falling back to defaults).
 */
export const getEffectiveGoals = async (user: string): Promise<Goal[]> => {
  const goals = await getGoals(user)
  // If the goals table is empty, return defaults
  return goals.length > 0 ? goals : defaultGoals
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
  await updateActivityTypeByTagKey(user, tagKey, name)
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
 * Map DB settings to response fields, applying schema defaults for missing values.
 * Fields with different DB vs response names are mapped explicitly.
 */
/** Schema for applying defaults to DB settings. Uses .default() from the response schema. */
const settingsWithDefaultsSchema = userSettingsResponseSchema.pick({
  birth_date: true,
  calendars: true,
  dashboard: true,
  food_sensitivity_map: true,
  garmin_disabled_data_types: true,
  item_icons: true,
  lastfm_username: true,
  meal_slots: true,
  rescue_time_key: true,
  sensitivity_areas: true,
  sex: true,
  tag_icons: true,
  tag_mappings: true,
  training_load: true,
  tz: true,
})

const withDefaults = (settings: UserSettings) =>
  settingsWithDefaultsSchema.parse({
    ...settings,
    tag_icons: settings.item_icons,
    tz: settings.device_timezone,
  })

export const getSettingsResponse = async (user: string): Promise<SettingsResponse> => {
  const settings = await getSettings(user)
  const { zones, source } = await getEffectiveHrZones(user)
  const ouraToken = await getOAuthToken(user, 'oura')
  const garminToken = await getOAuthToken(user, 'garmin')
  const lastFmConfigured = !!(await getCentralDb().getLastFmApiKey())

  const goals = await getEffectiveGoals(user)

  return {
    ...withDefaults(settings),
    garmin_connected: garminToken !== null && garminToken.access_token !== '',
    goals,
    hr_zone_start: zones,
    hr_zone_start_source: source,
    lastfm_configured: lastFmConfigured,
    oura_configured: !!(process.env.OURA_CLIENT && process.env.OURA_SECRET),
    oura_connected: ouraToken !== null,
    success: true,
  }
}

const buildErrorSettingsResponse = async (errorMessage: string): Promise<SettingsResponse> => ({
  ...settingsWithDefaultsSchema.parse({}),
  error: errorMessage,
  goals: defaultGoals,
  hr_zone_start: calculateDefaultHrZones(null),
  hr_zone_start_source: 'default' as const,
  lastfm_configured: !!(await getCentralDb().getLastFmApiKey()),
  oura_configured: !!(process.env.OURA_CLIENT && process.env.OURA_SECRET),
  garmin_connected: false,
  oura_connected: false,
  success: false,
})

export const validateAndUpdateSettings = async (user: string, input: unknown): Promise<SettingsResponse> => {
  const parsed = updateSettingsInputSchema.safeParse(input)
  if (!parsed.success) {
    return buildErrorSettingsResponse(parsed.error.issues.map((e) => e.message).join('; '))
  }

  // Handle goals separately — stored in their own table now
  if (parsed.data.goals !== undefined) {
    const newGoals = parsed.data.goals === null ? [] : parsed.data.goals
    await replaceGoals(user, newGoals)
  }

  // Build updates object, converting null to undefined (which clears/resets the field in storage).
  // Derive field list from the schema to keep it in sync with api-spec.
  const settingsFields = Object.keys(updateSettingsInputSchema.shape).filter((k) => k !== 'goals')
  const updates: Partial<UserSettings> = {}
  for (const field of settingsFields) {
    const value = parsed.data[field as keyof typeof parsed.data]
    if (value !== undefined) {
      ;(updates as Record<string, unknown>)[field] = value === null ? undefined : value
    }
  }

  // Shallow-merge dict fields so partial updates don't wipe existing entries.
  // e.g. updating one exercise icon shouldn't delete all tag icons.
  if (updates.item_icons) {
    const current = await getSettings(user)
    updates.item_icons = { ...current.item_icons, ...updates.item_icons }
  }

  // Apply updates (only if there are non-goals fields to update)
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
