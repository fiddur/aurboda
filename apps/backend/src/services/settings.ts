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

import {
  getGoals,
  getOAuthToken,
  getUserSettings,
  replaceGoals,
  updateTagNameByKey,
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
/** Apply defaults for nullable settings fields. */
const withDefaults = (settings: UserSettings) => ({
  birth_date: settings.birth_date ?? null,
  calendars: settings.calendars ?? [],
  dashboard: settings.dashboard ?? null,
  food_sensitivity_map: settings.food_sensitivity_map ?? {},
  item_icons: settings.item_icons ?? {},
  lastfm_username: settings.lastfm_username ?? null,
  meal_slots: settings.meal_slots ?? [],
  rescue_time_key: settings.rescue_time_key ?? null,
  sensitivity_areas: settings.sensitivity_areas ?? [],
  sex: settings.sex ?? null,
  tag_icons: settings.item_icons ?? {},
  tag_mappings: settings.tag_mappings ?? {},
  training_load: settings.training_load ?? null,
  tz: settings.device_timezone ?? null,
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

/**
 * Validate and update user settings.
 * Returns a SettingsResponse with either success or error.
 */
const EMPTY_SETTINGS_DEFAULTS = {
  birth_date: null,
  calendars: [],
  dashboard: null,
  food_sensitivity_map: {},
  garmin_connected: false,
  goals: defaultGoals,
  hr_zone_start_source: 'default' as const,
  item_icons: {},
  lastfm_username: null,
  meal_slots: [],
  oura_connected: false,
  rescue_time_key: null,
  sensitivity_areas: [],
  sex: null,
  tag_icons: {},
  tag_mappings: {},
  training_load: null,
  tz: null,
}

const buildErrorSettingsResponse = async (errorMessage: string): Promise<SettingsResponse> => ({
  ...EMPTY_SETTINGS_DEFAULTS,
  error: errorMessage,
  hr_zone_start: calculateDefaultHrZones(null),
  lastfm_configured: !!(await getCentralDb().getLastFmApiKey()),
  oura_configured: !!(process.env.OURA_CLIENT && process.env.OURA_SECRET),
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

  // Build updates object, converting null to undefined (which clears/resets the field in storage)
  const settingsFields = [
    'birth_date',
    'calendars',
    'dashboard',
    'food_sensitivity_map',
    'hr_zone_start',
    'item_icons',
    'lastfm_username',
    'meal_slots',
    'rescue_time_key',
    'sensitivity_areas',
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
