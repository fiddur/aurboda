/**
 * User settings storage and retrieval.
 */
import type { CustomMetricDefinition, DashboardConfig, Goal } from '@aurboda/api-spec'
import { query } from './connection'
import type { CalendarConfig, UserSettings } from './types'

/**
 * Get user settings from the database.
 * Returns null if no settings exist.
 */
export const getUserSettings = async (user: string): Promise<UserSettings | null> => {
  const result = await query(user, `SELECT settings FROM user_settings LIMIT 1`)

  if (result.rows.length === 0) return null

  const settings = result.rows[0].settings as Record<string, unknown>
  return {
    birthDate: settings.birthDate as string | undefined,
    calendars: settings.calendars as CalendarConfig[] | undefined,
    customMetrics: settings.customMetrics as CustomMetricDefinition[] | undefined,
    dashboard: settings.dashboard as DashboardConfig | undefined,
    goals: settings.goals as Goal[] | undefined,
    hrZoneStart: settings.hrZoneStart as UserSettings['hrZoneStart'],
    lastFmUsername: settings.lastFmUsername as string | undefined,
    rescueTimeKey: settings.rescueTimeKey as string | undefined,
    tagMappings: settings.tagMappings as UserSettings['tagMappings'],
  }
}

/**
 * Upsert user settings (creates or updates).
 * Merges the provided updates with existing settings.
 */
export const upsertUserSettings = async (
  user: string,
  updates: Partial<UserSettings>,
): Promise<UserSettings> => {
  // Get existing settings
  const existing = (await getUserSettings(user)) ?? {}

  // Merge updates
  const merged: UserSettings = { ...existing }
  if (updates.birthDate !== undefined) {
    merged.birthDate = updates.birthDate
  }
  if (updates.calendars !== undefined) {
    merged.calendars = updates.calendars
  }
  if (updates.customMetrics !== undefined) {
    merged.customMetrics = updates.customMetrics
  }
  if (updates.dashboard !== undefined) {
    merged.dashboard = updates.dashboard
  }
  if (updates.goals !== undefined) {
    merged.goals = updates.goals
  }
  if (updates.hrZoneStart !== undefined) {
    merged.hrZoneStart = updates.hrZoneStart
  }
  if (updates.lastFmUsername !== undefined) {
    merged.lastFmUsername = updates.lastFmUsername
  }
  if (updates.rescueTimeKey !== undefined) {
    merged.rescueTimeKey = updates.rescueTimeKey
  }
  if (updates.tagMappings !== undefined) {
    merged.tagMappings = updates.tagMappings
  }

  // Check if settings row exists
  const existingRow = await query(user, `SELECT id FROM user_settings LIMIT 1`)

  if (existingRow.rows.length === 0) {
    // Insert new row
    await query(user, `INSERT INTO user_settings (settings) VALUES ($1)`, [merged])
  } else {
    // Update existing row
    await query(user, `UPDATE user_settings SET settings = $1, updated_at = NOW()`, [merged])
  }

  return merged
}
