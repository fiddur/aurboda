import { z } from 'zod'

import { createDataResponseSchema, dateOnlySchema, iso8601DateTimeSchema } from './common.ts'
import { ianaTimezoneSchema } from './timezone.ts'

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

export const defaultSleepNeedMinutes = 480

export const sleepNeedMinutesSchema = z.number().int().min(180).max(720).meta({
  description: 'How much sleep you need per night, in minutes (180–720)',
  example: 480,
})

export const sleepDebtSeverities = ['none', 'mild', 'moderate', 'severe'] as const

export const sleepDebtSeveritySchema = z.enum(sleepDebtSeverities).meta({
  description:
    'Sleep debt as a share of the sleep need: none under 10 %, mild under 50 %, moderate under 100 %, severe from one full night',
  id: 'SleepDebtSeverity',
})

export type SleepDebtSeverity = z.infer<typeof sleepDebtSeveritySchema>

export const sleepDebtDaySchema = z
  .object({
    date: dateOnlySchema.meta({ description: 'The date of the wake-up (YYYY-MM-DD, local time)' }),
    debt_minutes: z.number().int().meta({ description: 'Sleep debt after this night, in minutes' }),
    severity: sleepDebtSeveritySchema,
    slept_minutes: z.number().int().nullable().meta({
      description:
        'Sleep credited for this date: the nights ending on it in full, naps over 20 minutes at half their length; null when no night was recorded, which leaves the debt decayed but not grown',
    }),
  })
  .meta({ description: 'Sleep debt after one night', id: 'SleepDebtDay' })

export type SleepDebtDay = z.infer<typeof sleepDebtDaySchema>

export const sleepDebtSchema = z
  .object({
    days: z.array(sleepDebtDaySchema).meta({ description: 'One entry per date in the range, oldest first' }),
    debt_minutes: z.number().int().meta({ description: 'Sleep debt after the last date of the range' }),
    severity: sleepDebtSeveritySchema,
    sleep_need_minutes: sleepNeedMinutesSchema.meta({
      description: 'The sleep need the debt is judged against (the sleep_need_minutes setting)',
    }),
  })
  .meta({
    description:
      'Sleep debt per night against your sleep need: each night debt = max(0, debt × 0.85 + need − slept). Computed from the stored sleep sessions on request, from four weeks before the range so the decay has settled.',
    id: 'SleepDebt',
  })

export type SleepDebt = z.infer<typeof sleepDebtSchema>

export const sleepDebtQuerySchema = z
  .object({
    end: dateOnlySchema.optional().meta({ description: 'Last date (YYYY-MM-DD); defaults to today' }),
    start: dateOnlySchema
      .optional()
      .meta({ description: 'First date (YYYY-MM-DD); defaults to 13 days before end (two weeks)' }),
    tz: ianaTimezoneSchema.optional().meta({
      description:
        "IANA timezone whose local dates the nights are counted in. Defaults to the user's stored device timezone, else UTC.",
      example: 'Europe/Stockholm',
    }),
  })
  .meta({ id: 'SleepDebtQuery' })

export type SleepDebtQuery = z.infer<typeof sleepDebtQuerySchema>

export const sleepDebtResponseSchema = createDataResponseSchema(sleepDebtSchema).meta({
  description: 'Sleep debt over a date range against the sleep need you set',
  id: 'SleepDebtResponse',
})

export type SleepDebtResponse = z.infer<typeof sleepDebtResponseSchema>
