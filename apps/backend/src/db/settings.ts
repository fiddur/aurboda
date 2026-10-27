import type { Queryable } from './pool.ts'
import type { UserSettings } from './types.ts'

import { query, withUserTransaction } from './connection.ts'

// One-time migration from camelCase to snake_case JSONB keys.
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
      widgets: Array.isArray(section.widgets)
        ? (section.widgets as Array<Record<string, unknown>>).map((widget) => ({
            ...widget,
            config:
              widget.config && typeof widget.config === 'object'
                ? renameKeys(widget.config as Record<string, unknown>, widgetConfigRenames)
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

/**
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

const lockSettings = (tx: Queryable) => query(tx, `SELECT pg_advisory_xact_lock(hashtext('user_settings'))`)

/**
 * Merges the provided updates with existing settings; keys listed in `clear`
 * are removed so the setting reverts to its default (#1063). The read and the write hold the
 * settings lock, so a flag claimed meanwhile (claimSettingsFlagIn) is not overwritten.
 */
export const upsertUserSettings = (
  user: string,
  updates: Partial<UserSettings>,
  clear: (keyof UserSettings)[] = [],
): Promise<UserSettings> =>
  withUserTransaction(user, async (tx) => {
    await lockSettings(tx)
    const current = await query(tx, `SELECT settings FROM user_settings LIMIT 1`)
    const raw = current.rows[0]?.settings as Record<string, unknown> | undefined
    const existing = (raw ? (migrateSettingsToSnakeCase(raw) ?? raw) : {}) as UserSettings

    // Merge updates into existing settings — only defined values override.
    // Deprecated: tag_icons merges into item_icons for backwards compatibility.
    const { tag_icons, ...rest } = updates
    const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
    const merged: UserSettings = { ...existing, ...defined }
    for (const key of clear) delete merged[key]
    if (tag_icons !== undefined) {
      merged.item_icons = { ...merged.item_icons, ...tag_icons }
    }

    if (current.rows.length === 0) {
      await query(tx, `INSERT INTO user_settings (settings) VALUES ($1)`, [merged])
    } else {
      await query(tx, `UPDATE user_settings SET settings = $1, updated_at = NOW()`, [merged])
    }

    return merged
  })

/**
 * Sets a boolean settings flag unless it is already present, within the caller's transaction,
 * and says whether this call set it. user_settings has no key to conflict on, so the settings
 * lock serialises concurrent claims, including the insert of a first row; a rollback of the
 * transaction gives the claim back.
 */
export const claimSettingsFlagIn = async (tx: Queryable, flag: string): Promise<boolean> => {
  await lockSettings(tx)
  const patch = JSON.stringify({ [flag]: true })
  const updated = await query(
    tx,
    `UPDATE user_settings SET settings = settings || $1::jsonb, updated_at = NOW()
     WHERE NOT (settings ? $2) RETURNING 1`,
    [patch, flag],
  )
  if ((updated.rowCount ?? 0) > 0) return true
  const inserted = await query(
    tx,
    `INSERT INTO user_settings (settings) SELECT $1::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM user_settings) RETURNING 1`,
    [patch],
  )
  return (inserted.rowCount ?? 0) > 0
}

export const claimSettingsFlag = (user: string, flag: string): Promise<boolean> =>
  withUserTransaction(user, (tx) => claimSettingsFlagIn(tx, flag))
