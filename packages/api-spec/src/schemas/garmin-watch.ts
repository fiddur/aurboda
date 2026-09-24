import { z } from 'zod'

import { activityTypeSchema, baseResponseSchema } from './common.ts'

/**
 * FIT developer field numbers the Aurboda Connect IQ app writes on every
 * record message. Garmin Connect exposes them in activity details as
 * `connectIQDeveloperField-<number>`; the importer maps them back by number,
 * so these are part of the contract between apps/garmin and the backend.
 */
export const garminWatchFitFields = {
  activity_type_code: 40,
  stress: 41,
} as const

export const garminWatchSessionNameMaxLength = 20

export const garminWatchTypeSchema = z
  .object({
    activity_type: activityTypeSchema.meta({ description: 'Aurboda activity type the watch logs' }),
    code: z.number().int().min(1).max(65535).meta({
      description: 'Stable id the watch writes into the FIT file so the import can recognise the type',
    }),
    fit_sport: z
      .number()
      .int()
      .min(0)
      .max(255)
      .default(0)
      .meta({ description: 'FIT sport the session is recorded as' }),
    fit_sub_sport: z
      .number()
      .int()
      .min(0)
      .max(255)
      .default(0)
      .meta({ description: 'FIT sub-sport the session is recorded as' }),
    session_name: z
      .string()
      .min(1)
      .max(garminWatchSessionNameMaxLength)
      .meta({ description: 'Label shown on the watch and used as the recorded session name' }),
  })
  .meta({ id: 'GarminWatchType', description: 'One activity type the Aurboda watch app offers' })

export type GarminWatchType = z.infer<typeof garminWatchTypeSchema>

export const garminWatchTypesSchema = z
  .array(garminWatchTypeSchema)
  .max(50)
  .superRefine((types, ctx) => {
    const codes = new Set<number>()
    const activityTypes = new Set<string>()
    types.forEach((entry, index) => {
      if (codes.has(entry.code)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate code ${entry.code}`, path: [index, 'code'] })
      }
      if (activityTypes.has(entry.activity_type)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate activity type ${entry.activity_type}`,
          path: [index, 'activity_type'],
        })
      }
      codes.add(entry.code)
      activityTypes.add(entry.activity_type)
    })
  })
  .meta({
    id: 'GarminWatchTypes',
    description: 'Activity types the Aurboda watch app offers, in display order',
  })

export type GarminWatchTypes = z.infer<typeof garminWatchTypesSchema>

export const garminWatchConfigTypeSchema = garminWatchTypeSchema
  .extend({
    display_name: z.string().meta({ description: 'Display name of the activity type' }),
  })
  .meta({ id: 'GarminWatchConfigType', description: 'A watch activity type with its display name resolved' })

export const garminWatchConfigResponseSchema = baseResponseSchema
  .extend({
    types: z.array(garminWatchConfigTypeSchema),
  })
  .meta({
    id: 'GarminWatchConfigResponse',
    description: 'What the Aurboda watch app fetches: the configured types in display order',
  })

export type GarminWatchConfigResponse = z.infer<typeof garminWatchConfigResponseSchema>

export interface GarminSport {
  label: string
  sport: number
  sub_sport: number
}

/**
 * The FIT sports a watch session can be recorded as. A curated subset of the
 * FIT profile: what Garmin Connect offers for manual activities, plus the
 * sub-sports that change how Connect treats the session (yoga, breathing,
 * strength, indoor variants).
 */
export const garminSports: GarminSport[] = [
  { label: 'Other', sport: 0, sub_sport: 0 },
  { label: 'Yoga', sport: 10, sub_sport: 43 },
  { label: 'Meditation', sport: 67, sub_sport: 0 },
  { label: 'Breathwork', sport: 10, sub_sport: 62 },
  { label: 'Pilates', sport: 10, sub_sport: 44 },
  { label: 'Strength training', sport: 10, sub_sport: 20 },
  { label: 'Cardio training', sport: 10, sub_sport: 26 },
  { label: 'Flexibility training', sport: 10, sub_sport: 19 },
  { label: 'Training', sport: 10, sub_sport: 0 },
  { label: 'HIIT', sport: 62, sub_sport: 0 },
  { label: 'Running', sport: 1, sub_sport: 0 },
  { label: 'Treadmill running', sport: 1, sub_sport: 1 },
  { label: 'Walking', sport: 11, sub_sport: 0 },
  { label: 'Hiking', sport: 17, sub_sport: 0 },
  { label: 'Cycling', sport: 2, sub_sport: 0 },
  { label: 'Indoor cycling', sport: 2, sub_sport: 6 },
  { label: 'Pool swimming', sport: 5, sub_sport: 17 },
  { label: 'Open water swimming', sport: 5, sub_sport: 18 },
  { label: 'Rowing', sport: 15, sub_sport: 0 },
  { label: 'Indoor rowing', sport: 15, sub_sport: 14 },
  { label: 'Elliptical', sport: 4, sub_sport: 15 },
  { label: 'Stair climbing', sport: 4, sub_sport: 16 },
  { label: 'Dance', sport: 83, sub_sport: 0 },
  { label: 'Boxing', sport: 47, sub_sport: 0 },
  { label: 'Mixed martial arts', sport: 80, sub_sport: 0 },
  { label: 'Rock climbing', sport: 31, sub_sport: 0 },
  { label: 'Jump rope', sport: 84, sub_sport: 0 },
  { label: 'Paddling', sport: 19, sub_sport: 0 },
  { label: 'Sailing', sport: 32, sub_sport: 0 },
  { label: 'Golf', sport: 25, sub_sport: 0 },
  { label: 'Tennis', sport: 8, sub_sport: 0 },
  { label: 'Basketball', sport: 6, sub_sport: 0 },
  { label: 'Soccer', sport: 7, sub_sport: 0 },
  { label: 'Volleyball', sport: 75, sub_sport: 0 },
  { label: 'Ice skating', sport: 33, sub_sport: 0 },
  { label: 'Skiing', sport: 13, sub_sport: 0 },
  { label: 'Snowboarding', sport: 14, sub_sport: 0 },
  { label: 'Snowshoeing', sport: 35, sub_sport: 0 },
]

const defaultSportByActivityType: Record<string, [number, number]> = {
  basketball: [6, 0],
  biking: [2, 0],
  biking_stationary: [2, 6],
  boxing: [47, 0],
  breathwork: [10, 62],
  dancing: [83, 0],
  elliptical: [4, 15],
  golf: [25, 0],
  guided_breathing: [10, 62],
  high_intensity_interval_training: [62, 0],
  hiking: [17, 0],
  ice_skating: [33, 0],
  jump_rope: [84, 0],
  martial_arts: [80, 0],
  meditation: [67, 0],
  paddling: [19, 0],
  pilates: [10, 44],
  rock_climbing: [31, 0],
  rowing: [15, 0],
  rowing_machine: [15, 14],
  running: [1, 0],
  running_treadmill: [1, 1],
  sailing: [32, 0],
  skiing: [13, 0],
  snowboarding: [14, 0],
  snowshoeing: [35, 0],
  soccer: [7, 0],
  stair_climbing_machine: [4, 16],
  strength_training: [10, 20],
  stretching: [10, 19],
  swimming_open_water: [5, 18],
  swimming_pool: [5, 17],
  tennis: [8, 0],
  volleyball: [75, 0],
  walking: [11, 0],
  weightlifting: [10, 20],
  yoga: [10, 43],
}

/** The FIT sport Aurboda suggests for an activity type; generic when it has no Garmin counterpart. */
export const defaultGarminSportForType = (activityType: string): { sport: number; sub_sport: number } => {
  const found = defaultSportByActivityType[activityType]
  return found ? { sport: found[0], sub_sport: found[1] } : { sport: 0, sub_sport: 0 }
}

export const garminSportLabel = (sport: number, subSport: number): string =>
  garminSports.find((s) => s.sport === sport && s.sub_sport === subSport)?.label ??
  `Sport ${sport}/${subSport}`
