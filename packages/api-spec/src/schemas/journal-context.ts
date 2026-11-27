import { z } from 'zod'

import { createDataResponseSchema, dataSourceSchema, dateOnlySchema } from './common.ts'
import { trendChartConfigSchema } from './dashboard.ts'
import { noteSchema } from './notes.ts'
import { ianaTimezoneSchema } from './timezone.ts'

export const JOURNAL_CONTEXT_MAX_ITEMS = 30

const itemBaseShape = {
  decimals: z.number().int().min(0).max(3).default(0).meta({
    description: 'Decimals the value is shown with (0–3, default 0)',
  }),
  id: z.string().min(1).max(64).meta({ description: 'Identifier of the item, unique within the line' }),
  label: z.string().max(12).meta({
    description: 'The short label shown before the value, e.g. "ŌR" or an emoji (may be empty)',
    example: 'ŌR',
  }),
}

const trendShape = trendChartConfigSchema.shape

export const journalContextMetricItemSchema = z
  .object({
    ...itemBaseShape,
    kind: z.literal('metric'),
    metric: z.string().min(1).meta({
      description: 'Metric name (built-in or custom), e.g. readiness_score',
      example: 'readiness_score',
    }),
    missing: z.enum(['hide', 'carry_forward']).default('hide').meta({
      description:
        "What a day without a value shows: 'hide' leaves the item out, 'carry_forward' shows the latest value before the day",
    }),
    source: dataSourceSchema.optional().meta({ description: 'Only count samples from this data source' }),
  })
  .meta({
    description:
      "The day's value of a metric (the day's total for summed metrics such as steps, else the day's average)",
    id: 'JournalContextMetricItem',
  })

export const journalContextTrendItemSchema = z
  .object({
    ...itemBaseShape,
    aggregation: trendShape.aggregation,
    display_period: trendShape.display_period,
    half_life_days: trendShape.half_life_days,
    kind: z.literal('trend'),
    missing_days: trendShape.missing_days,
    pattern: z.string().min(1).meta({ description: 'Activity type or tag name, or metric name' }),
    source_type: z.enum(['tag', 'metric', 'activity_type']).meta({ description: 'Data source type' }),
  })
  .meta({ description: 'The value of a trend (EMA) as of the end of the day', id: 'JournalContextTrendItem' })

export const journalContextDaysSinceItemSchema = z
  .object({
    ...itemBaseShape,
    date: dateOnlySchema.optional().meta({
      description: "With source_type 'date' (required there): the fixed calendar date counted from",
      example: '1980-05-17',
    }),
    kind: z.literal('days_since'),
    pattern: z.string().min(1).optional().meta({
      description: "Activity type or tag name (required for source_type 'activity_type' and 'tag')",
    }),
    source_type: z.enum(['activity_type', 'tag', 'date']).meta({
      description:
        "What is counted from: the last activity or tag of the type ('activity_type', 'tag') or a fixed date ('date')",
    }),
    unit: z.enum(['days', 'weeks', 'years']).default('days').meta({
      description:
        "Unit of the value: 'days' (whole calendar days), 'weeks' (days / 7) or 'years' (whole years plus the fraction of the current year, as an age)",
    }),
  })
  .refine((item) => (item.source_type === 'date' ? item.date !== undefined : item.pattern !== undefined), {
    message: "days_since needs date with source_type 'date', else pattern",
  })
  .meta({
    description:
      'Time since the last activity or tag of the type that started on or before the day (0 when it was that day), or since a fixed date; left out when there is none or the date is after the day',
    id: 'JournalContextDaysSinceItem',
  })

export const journalContextMoonItemSchema = z
  .object({
    ...itemBaseShape,
    kind: z.literal('moon'),
    value: z.enum(['illumination', 'age_percent', 'age_days']).default('illumination').meta({
      description:
        "What is shown: 'illumination' (% of the disc lit), 'age_percent' (% of the lunar cycle passed) or 'age_days' (days since new moon)",
    }),
  })
  .meta({
    description: "The moon's phase on the day; the label gets the phase emoji",
    id: 'JournalContextMoonItem',
  })

export const journalContextItemSchema = z
  .discriminatedUnion('kind', [
    journalContextMetricItemSchema,
    journalContextTrendItemSchema,
    journalContextDaysSinceItemSchema,
    journalContextMoonItemSchema,
  ])
  .meta({ description: 'One item of the journal context line', id: 'JournalContextItem' })

export type JournalContextItem = z.infer<typeof journalContextItemSchema>
export type JournalContextItemKind = JournalContextItem['kind']

export const journalContextItemsSchema = z
  .array(journalContextItemSchema)
  .max(JOURNAL_CONTEXT_MAX_ITEMS)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
    message: 'Journal context item ids must be unique',
  })
  .meta({
    description: `The items of the journal context line, in the order they are shown (at most ${JOURNAL_CONTEXT_MAX_ITEMS})`,
    id: 'JournalContextItems',
  })

export const journalContextValueSchema = z
  .object({
    decimals: z.number().int().meta({ description: 'Decimals the value is shown with' }),
    id: z.string().meta({ description: 'The configured item id' }),
    kind: z.enum(['metric', 'trend', 'days_since', 'moon']).meta({ description: 'The item kind' }),
    label: z.string().meta({ description: 'The label (for the moon followed by the phase emoji)' }),
    name: z.string().meta({ description: 'A full name of the item, e.g. for a tooltip' }),
    suffix: z.string().meta({ description: 'Unit suffix after the value ("%", "d" or empty)' }),
    text: z.string().meta({
      description: 'label + value with the decimals (dot decimal separator) + suffix',
      example: 'ŌR85',
    }),
    value: z.number().meta({ description: 'The value, unrounded' }),
  })
  .meta({ description: 'One computed item of the journal context line', id: 'JournalContextValue' })

export type JournalContextValue = z.infer<typeof journalContextValueSchema>

export const journalContextSchema = z
  .object({
    date: dateOnlySchema.meta({ description: 'The calendar day the line is for (YYYY-MM-DD)' }),
    items: z.array(journalContextValueSchema).meta({
      description: 'The configured items that have a value for the day, in the configured order',
    }),
  })
  .meta({
    description: "The journal context line for a day: the user's configured figures, computed for that day",
    id: 'JournalContext',
  })

export type JournalContext = z.infer<typeof journalContextSchema>

export const journalContextQuerySchema = z
  .object({
    date: dateOnlySchema
      .optional()
      .meta({ description: 'The calendar day (YYYY-MM-DD); today in tz when omitted' }),
    tz: ianaTimezoneSchema.optional().meta({
      description: "IANA timezone the day is read in (default: the user's timezone)",
    }),
  })
  .meta({ id: 'JournalContextQuery' })

export type JournalContextQuery = z.infer<typeof journalContextQuerySchema>

export const journalContextResponseSchema = createDataResponseSchema(journalContextSchema).meta({
  id: 'JournalContextResponse',
})

export type JournalContextResponse = z.infer<typeof journalContextResponseSchema>

export const noteDetailSchema = noteSchema
  .extend({
    context: journalContextSchema.optional().meta({
      description:
        "On a journal entry (a `time` or `day` root): the journal context line for the entry's day, when the user has configured one",
    }),
  })
  .meta({ id: 'NoteDetail' })

export type NoteDetail = z.infer<typeof noteDetailSchema>

export const noteDetailResponseSchema = createDataResponseSchema(noteDetailSchema).meta({
  id: 'NoteDetailResponse',
})

export type NoteDetailResponse = z.infer<typeof noteDetailResponseSchema>

export const noteGetQuerySchema = z
  .object({
    tz: ianaTimezoneSchema.optional().meta({
      description:
        "IANA timezone a `time` entry's day is read in for its context line (default: the user's timezone)",
    }),
  })
  .meta({ id: 'NoteGetQuery' })

export type NoteGetQuery = z.infer<typeof noteGetQuerySchema>
