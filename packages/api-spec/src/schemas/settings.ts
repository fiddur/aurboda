/**
 * User settings schemas.
 */

import { z } from 'zod'
import { baseResponseSchema, hrZoneSourceSchema } from './common.js'
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
 * Update settings input schema.
 */
export const updateSettingsInputSchema = z
  .object({
    birth_date: birthDateSchema.nullable().optional().meta({
      description: 'Birth date (set to null to clear)',
    }),
    goals: goalsSchema.nullable().optional().meta({
      description: 'Goals (set to null to reset to defaults, empty array to clear all)',
    }),
    hr_zone_start: hrZoneThresholdsSchema.nullable().optional().meta({
      description: 'Custom HR zone thresholds (set to null to clear)',
    }),
    rescue_time_key: rescueTimeKeySchema.nullable().optional().meta({
      description: 'RescueTime API key (set to null to clear)',
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
    goals: goalsSchema.meta({ description: 'User goals for tracking metrics' }),
    hr_zone_start: hrZoneThresholdsSchema.meta({ description: 'Effective HR zone thresholds' }),
    hr_zone_start_source: hrZoneSourceSchema.meta({
      description: 'Source of HR zone thresholds',
    }),
    oura_configured: z.boolean().meta({ description: 'Whether Oura OAuth is configured on server' }),
    oura_connected: z.boolean().meta({ description: 'Whether Oura is connected via OAuth' }),
    rescue_time_key: z.string().nullable().meta({ description: 'RescueTime API key' }),
  })
  .meta({ id: 'UserSettingsResponse' })

export type UserSettingsResponse = z.infer<typeof userSettingsResponseSchema>
