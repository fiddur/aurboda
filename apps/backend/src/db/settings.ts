/**
 * User settings storage and retrieval.
 */
import { query } from './connection'
import type { UserSettings } from './types'

// ============================================================================
// One-time migration from camelCase to snake_case JSONB keys
// ============================================================================

const topLevelRenames: Record<string, string> = {
  birthDate: 'birth_date',
  customMetrics: 'custom_metrics',
  hrZoneStart: 'hr_zone_start',
  lastFmUsername: 'lastfm_username',
  rescueTimeKey: 'rescue_time_key',
  tag_icons: 'item_icons',
  tagMappings: 'tag_mappings',
}

const widgetConfigRenames: Record<string, string> = {
  activityType: 'activity_type',
  displayPeriod: 'display_period',
  halfLifeDays: 'half_life_days',
  lookbackDays: 'lookback_days',
  periodDays: 'period_days',
  showMeditation: 'show_meditation',
  showSleep: 'show_sleep',
  showWorkouts: 'show_workouts',
  sourceType: 'source_type',
  trendInverse: 'trend_inverse',
  windowMinutes: 'window_minutes',
}

const renameKeys = (
  obj: Record<string, unknown>,
  renames: Record<string, string>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[renames[key] ?? key] = value
  }
  return result
}

const migrateDashboardConfig = (dashboard: Record<string, unknown>): Record<string, unknown> => {
  const sections = dashboard.sections
  if (!Array.isArray(sections)) return dashboard

  return {
    ...dashboard,
    sections: sections.map((section: Record<string, unknown>) => ({
      ...section,
      widgets:
        Array.isArray(section.widgets) ?
          (section.widgets as Array<Record<string, unknown>>).map((widget) => ({
            ...widget,
            config:
              widget.config && typeof widget.config === 'object' ?
                renameKeys(widget.config as Record<string, unknown>, widgetConfigRenames)
              : widget.config,
          }))
        : section.widgets,
    })),
  }
}

/**
 * Migrate settings JSONB from old camelCase keys to snake_case.
 * Returns the migrated object if migration was needed, or null if already up-to-date.
 */
export const migrateSettingsToSnakeCase = (
  settings: Record<string, unknown>,
): Record<string, unknown> | null => {
  const needsMigration = Object.keys(topLevelRenames).some((key) => key in settings)
  if (!needsMigration) return null

  const migrated = renameKeys(settings, topLevelRenames)

  if (migrated.dashboard && typeof migrated.dashboard === 'object') {
    migrated.dashboard = migrateDashboardConfig(migrated.dashboard as Record<string, unknown>)
  }

  return migrated
}

// ============================================================================
// CRUD
// ============================================================================

/**
 * Get user settings from the database.
 * On first read after the snake_case migration, converts old camelCase JSONB
 * keys and writes the result back so subsequent reads need no conversion.
 * Returns null if no settings exist.
 */
export const getUserSettings = async (user: string): Promise<UserSettings | null> => {
  const result = await query(user, `SELECT settings FROM user_settings LIMIT 1`)

  if (result.rows.length === 0) return null

  const raw = result.rows[0].settings as Record<string, unknown>

  const migrated = migrateSettingsToSnakeCase(raw)
  if (migrated) {
    await query(user, `UPDATE user_settings SET settings = $1, updated_at = NOW()`, [migrated])
    return migrated as UserSettings
  }

  return raw as UserSettings
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

  // Merge updates — simple fields are copied directly when present
  const merged: UserSettings = { ...existing }
  const simpleFields = [
    'birth_date',
    'calendars',
    'custom_metrics',
    'dashboard',
    'goals',
    'hr_zone_start',
    'item_icons',
    'lastfm_username',
    'rescue_time_key',
    'sex',
    'tag_mappings',
  ] as const
  for (const field of simpleFields) {
    if (updates[field] !== undefined) {
      ;(merged as Record<string, unknown>)[field] = updates[field]
    }
  }
  // Deprecated: merge tag_icons into item_icons for backwards compatibility
  if (updates.tag_icons !== undefined) {
    merged.item_icons = { ...(merged.item_icons ?? {}), ...updates.tag_icons }
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
