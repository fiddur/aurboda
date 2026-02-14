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
    birth_date: settings.birth_date as string | undefined,
    calendars: settings.calendars as CalendarConfig[] | undefined,
    custom_metrics: settings.custom_metrics as CustomMetricDefinition[] | undefined,
    dashboard: settings.dashboard as DashboardConfig | undefined,
    goals: settings.goals as Goal[] | undefined,
    hr_zone_start: settings.hr_zone_start as UserSettings['hr_zone_start'],
    lastfm_username: settings.lastfm_username as string | undefined,
    rescue_time_key: settings.rescue_time_key as string | undefined,
    tag_mappings: settings.tag_mappings as UserSettings['tag_mappings'],
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
  if (updates.birth_date !== undefined) {
    merged.birth_date = updates.birth_date
  }
  if (updates.calendars !== undefined) {
    merged.calendars = updates.calendars
  }
  if (updates.custom_metrics !== undefined) {
    merged.custom_metrics = updates.custom_metrics
  }
  if (updates.dashboard !== undefined) {
    merged.dashboard = updates.dashboard
  }
  if (updates.goals !== undefined) {
    merged.goals = updates.goals
  }
  if (updates.hr_zone_start !== undefined) {
    merged.hr_zone_start = updates.hr_zone_start
  }
  if (updates.lastfm_username !== undefined) {
    merged.lastfm_username = updates.lastfm_username
  }
  if (updates.rescue_time_key !== undefined) {
    merged.rescue_time_key = updates.rescue_time_key
  }
  if (updates.tag_mappings !== undefined) {
    merged.tag_mappings = updates.tag_mappings
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
