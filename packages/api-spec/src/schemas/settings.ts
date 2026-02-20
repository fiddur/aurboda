/**
 * User settings schemas.
 */

import { z } from 'zod'
import { baseResponseSchema, hrZoneSourceSchema } from './common.js'
import { dashboardConfigSchema } from './dashboard.js'
import { goalsSchema } from './goals.js'

// Shared HR zone threshold field
const hrZoneThresholdSchema = z.number().int().positive()

/**
 * HR zone thresholds (zone 1-5 start values in bpm).
 */
export const hrZoneThresholdsSchema = z
  .object({
    1: hrZoneThresholdSchema.meta({ description: 'Zone 1 threshold (bpm)', example: 90 }),
    2: hrZoneThresholdSchema.meta({ description: 'Zone 2 threshold (bpm)', example: 108 }),
    3: hrZoneThresholdSchema.meta({ description: 'Zone 3 threshold (bpm)', example: 126 }),
    4: hrZoneThresholdSchema.meta({ description: 'Zone 4 threshold (bpm)', example: 144 }),
    5: hrZoneThresholdSchema.meta({ description: 'Zone 5 threshold (bpm)', example: 162 }),
  })
  .refine((data) => data[1] < data[2] && data[2] < data[3] && data[3] < data[4] && data[4] < data[5], {
    message: 'HR zone thresholds must be in ascending order',
  })
  .meta({ id: 'HrZoneThresholds' })

export type HrZoneThresholds = z.infer<typeof hrZoneThresholdsSchema>

// Shared HR zone seconds field
const hrZoneSecsValueSchema = z.number()

/**
 * HR zone seconds (time spent in each zone).
 */
export const hrZoneSecsSchema = z
  .object({
    0: hrZoneSecsValueSchema.meta({ description: 'Seconds below zone 1' }),
    1: hrZoneSecsValueSchema.meta({ description: 'Seconds in zone 1' }),
    2: hrZoneSecsValueSchema.meta({ description: 'Seconds in zone 2' }),
    3: hrZoneSecsValueSchema.meta({ description: 'Seconds in zone 3' }),
    4: hrZoneSecsValueSchema.meta({ description: 'Seconds in zone 4' }),
    5: hrZoneSecsValueSchema.meta({ description: 'Seconds in zone 5' }),
  })
  .meta({ id: 'HrZoneSecs' })

export type HrZoneSecs = z.infer<typeof hrZoneSecsSchema>

/**
 * Birth date schema (YYYY-MM-DD format).
 */
export const birthDateSchema = z.iso.date().meta({
  description: 'Birth date in YYYY-MM-DD format',
  example: '1985-06-15',
})

/**
 * RescueTime API key schema.
 */
export const rescueTimeKeySchema = z.string().min(1, 'RescueTime API key cannot be empty').meta({
  description: 'RescueTime API key (personal token)',
})

/**
 * Last.fm username schema.
 */
export const lastFmUsernameSchema = z.string().min(1, 'Last.fm username cannot be empty').meta({
  description: 'Last.fm username for scrobble sync',
})

/**
 * Tag mappings schema (UUID -> display name).
 */
export const tagMappingsSchema = z.record(z.string(), z.string()).meta({
  description: 'Tag mappings from Oura tag_type_code UUIDs to display names',
  id: 'TagMappings',
})

/**
 * Calendar config schema (name + ICS URL pair).
 */
export const calendarConfigSchema = z
  .object({
    name: z.string().min(1).meta({ description: 'Display name for the calendar' }),
    url: z.string().url().meta({ description: 'ICS URL for the calendar' }),
  })
  .meta({ id: 'CalendarConfig' })

export type CalendarConfig = z.infer<typeof calendarConfigSchema>

/**
 * Calendars schema (array of calendar configs).
 */
export const calendarsSchema = z.array(calendarConfigSchema).meta({
  description: 'Calendar ICS URL configurations',
  id: 'Calendars',
})

export type TagMappings = z.infer<typeof tagMappingsSchema>

/**
 * Update settings input schema.
 */
export const updateSettingsInputSchema = z
  .object({
    birth_date: birthDateSchema.nullable().optional().meta({
      description: 'Birth date (set to null to clear)',
    }),
    calendars: calendarsSchema.nullable().optional().meta({
      description: 'Calendar ICS URL configurations (set to null to clear all)',
    }),
    dashboard: dashboardConfigSchema.nullable().optional().meta({
      description: 'Dashboard configuration (set to null to reset to defaults)',
    }),
    goals: goalsSchema.nullable().optional().meta({
      description: 'Goals (set to null to reset to defaults, empty array to clear all)',
    }),
    hr_zone_start: hrZoneThresholdsSchema.nullable().optional().meta({
      description: 'Custom HR zone thresholds (set to null to clear)',
    }),
    lastfm_username: lastFmUsernameSchema.nullable().optional().meta({
      description: 'Last.fm username for scrobble sync (set to null to clear)',
    }),
    rescue_time_key: rescueTimeKeySchema.nullable().optional().meta({
      description: 'RescueTime API key (set to null to clear)',
    }),
    tag_mappings: tagMappingsSchema.nullable().optional().meta({
      description: 'Tag name mappings (set to null to clear all)',
    }),
  })
  .meta({ id: 'UpdateSettingsInput' })

export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>

/**
 * User settings response schema.
 */
export const userSettingsResponseSchema = baseResponseSchema
  .extend({
    birth_date: z.string().nullable().meta({ description: 'Birth date in YYYY-MM-DD format' }),
    calendars: calendarsSchema.meta({ description: 'Calendar ICS URL configurations' }),
    dashboard: dashboardConfigSchema
      .nullable()
      .meta({ description: 'Custom dashboard configuration (null = use default)' }),
    goals: goalsSchema.meta({ description: 'User goals for tracking metrics' }),
    hr_zone_start: hrZoneThresholdsSchema.meta({ description: 'Effective HR zone thresholds' }),
    hr_zone_start_source: hrZoneSourceSchema.meta({
      description: 'Source of HR zone thresholds',
    }),
    lastfm_configured: z.boolean().meta({ description: 'Whether Last.fm API key is configured on server' }),
    lastfm_username: z.string().nullable().meta({ description: 'Last.fm username for scrobble sync' }),
    oura_configured: z.boolean().meta({ description: 'Whether Oura OAuth is configured on server' }),
    oura_connected: z.boolean().meta({ description: 'Whether Oura is connected via OAuth' }),
    rescue_time_key: z.string().nullable().meta({ description: 'RescueTime API key' }),
    tag_mappings: tagMappingsSchema.meta({ description: 'Tag name mappings from UUIDs to display names' }),
  })
  .meta({ id: 'UserSettingsResponse' })

export type UserSettingsResponse = z.infer<typeof userSettingsResponseSchema>
