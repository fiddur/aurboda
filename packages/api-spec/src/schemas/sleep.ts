import { z } from 'zod'

import { createDataResponseSchema, iso8601DateTimeSchema } from './common.ts'

export const sleepStageSegmentSchema = z
  .object({
    end_time: iso8601DateTimeSchema,
    stage: z.number().int().min(1).max(6).meta({
      description: 'Health Connect sleep stage: 1 Awake, 2 Sleeping, 3 Out of bed, 4 Light, 5 Deep, 6 REM',
    }),
    start_time: iso8601DateTimeSchema,
  })
  .meta({ description: 'One contiguous sleep stage interval', id: 'SleepStageSegment' })

export type SleepStageSegment = z.infer<typeof sleepStageSegmentSchema>

export const sleepStageMinutesSchema = z
  .object({
    awake: z.number().meta({ description: 'Minutes awake during the session' }),
    deep: z.number().meta({ description: 'Minutes of deep sleep' }),
    light: z.number().meta({ description: 'Minutes of light sleep' }),
    rem: z.number().meta({ description: 'Minutes of REM sleep' }),
  })
  .meta({ description: 'Minutes spent in each sleep stage', id: 'SleepStageMinutes' })

export type SleepStageMinutes = z.infer<typeof sleepStageMinutesSchema>

export const latestSleepSchema = z
  .object({
    activity_id: z.string().meta({ description: 'ID of the sleep activity' }),
    body_battery_end: z.number().optional().meta({
      description: 'Last Body Battery reading inside the sleep window (the level at wake-up)',
    }),
    body_battery_start: z.number().optional().meta({
      description: 'First Body Battery reading inside the sleep window (the level at bedtime)',
    }),
    end_time: iso8601DateTimeSchema.meta({ description: 'Wake-up time' }),
    hrv: z.number().optional().meta({
      description:
        'Overnight HRV (rmssd, ms): the average of samples inside the sleep window, else the daily value recorded for the wake-up date',
    }),
    hrv_baseline: z
      .number()
      .optional()
      .meta({ description: 'Average HRV (rmssd, ms) over the 30 days before this night' }),
    resting_hr: z
      .number()
      .optional()
      .meta({ description: 'Resting heart rate (bpm) recorded for the wake-up date' }),
    resting_hr_baseline: z
      .number()
      .optional()
      .meta({ description: 'Average resting heart rate (bpm) over the 30 days before this night' }),
    sleep_score: z.number().optional().meta({ description: 'Sleep score (0-100) for this night' }),
    stage_minutes: sleepStageMinutesSchema.optional(),
    stages: z
      .array(sleepStageSegmentSchema)
      .meta({ description: 'Sleep stage timeline sorted by start time; empty when none was recorded' }),
    start_time: iso8601DateTimeSchema.meta({ description: 'Bedtime' }),
    time_in_bed_min: z.number().meta({ description: 'Minutes from bedtime to wake-up' }),
    total_sleep_min: z
      .number()
      .optional()
      .meta({ description: 'Minutes actually asleep (excluding awake time), when known' }),
  })
  .meta({
    description: 'Summary of the most recent night of sleep: timing, score, stages and overnight vitals',
    id: 'LatestSleep',
  })

export type LatestSleep = z.infer<typeof latestSleepSchema>

export const latestSleepResponseSchema = createDataResponseSchema(latestSleepSchema.nullable()).meta({
  description: 'The most recent sleep that ended within the last 36 hours, or null when there is none',
  id: 'LatestSleepResponse',
})

export type LatestSleepResponse = z.infer<typeof latestSleepResponseSchema>
