import { z } from 'zod'

import { baseResponseSchema, dateOnlySchema, iso8601DateTimeSchema } from './common.ts'
import { ianaTimezoneSchema } from './timezone.ts'

export const WEATHER_MAX_SPAN_DAYS = 31

export const weatherQuerySchema = z
  .object({
    date: dateOnlySchema.optional().meta({
      description:
        "A calendar day in tz: the day's hours, summarised for the place where most of the day was spent. Give either date or start and end.",
    }),
    end: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'End of a span (with start, instead of date)' }),
    start: iso8601DateTimeSchema.optional().meta({
      description: `Start of a span (with end, instead of date): every stored hour that overlaps it. At most ${WEATHER_MAX_SPAN_DAYS} days`,
    }),
    tz: ianaTimezoneSchema.optional().meta({
      description: "IANA timezone for date's day boundaries; defaults to the user's timezone",
    }),
  })
  .refine((q) => (q.date !== undefined) !== (q.start !== undefined || q.end !== undefined), {
    message: 'Give either date, or start and end',
    path: ['date'],
  })
  .refine((q) => (q.start === undefined) === (q.end === undefined), {
    message: 'start and end must be given together',
    path: ['end'],
  })
  .refine((q) => q.start === undefined || q.end === undefined || q.start <= q.end, {
    message: 'start must not be after end',
    path: ['end'],
  })
  .refine(
    (q) =>
      q.start === undefined ||
      q.end === undefined ||
      Date.parse(q.end) - Date.parse(q.start) <= WEATHER_MAX_SPAN_DAYS * 86_400_000,
    { message: `A span must not be longer than ${WEATHER_MAX_SPAN_DAYS} days`, path: ['end'] },
  )
  .meta({ id: 'WeatherQuery' })

export type WeatherQuery = z.infer<typeof weatherQuerySchema>

export const weatherHourSchema = z
  .object({
    code: z.number().int().nullable().meta({ description: 'WMO weather code' }),
    precipitation: z.number().nullable().meta({ description: 'Precipitation during the hour, mm' }),
    temperature: z.number().nullable().meta({ description: 'Air temperature at 2 m, °C' }),
    time: iso8601DateTimeSchema.meta({ description: 'Start of the hour (UTC)' }),
    wind_speed: z.number().nullable().meta({ description: 'Wind speed at 10 m, m/s' }),
  })
  .meta({ description: 'The weather of one hour where the user was', id: 'WeatherHour' })

export type WeatherHour = z.infer<typeof weatherHourSchema>

export const weatherSummarySchema = z
  .object({
    code: z.number().int().nullable().meta({ description: 'The summary WMO weather code' }),
    condition: z.string().meta({ description: 'The WMO code in words', example: 'Partly cloudy' }),
    emoji: z.string().meta({ example: '⛅' }),
    hours: z.number().int().meta({ description: 'How many hours the summary covers' }),
    precipitation_sum: z.number().nullable().meta({ description: 'Total precipitation, mm' }),
    temperature_avg: z.number().nullable().meta({ description: 'Mean temperature, °C' }),
    temperature_max: z.number().nullable().meta({ description: 'Highest temperature, °C' }),
    temperature_min: z.number().nullable().meta({ description: 'Lowest temperature, °C' }),
    wind_speed_max: z.number().nullable().meta({ description: 'Highest hourly wind speed, m/s' }),
  })
  .meta({
    description:
      'A summary of the hours: precipitation names the condition when at least a quarter of the coded hours have it, else the most frequent code does',
    id: 'WeatherSummary',
  })

export type WeatherSummary = z.infer<typeof weatherSummarySchema>

export const weatherSchema = z
  .object({
    hours: z.array(weatherHourSchema).meta({ description: 'Every stored hour of the day or span, in order' }),
    summary: weatherSummarySchema.nullable().meta({ description: 'Null when no hour has weather' }),
  })
  .meta({ id: 'Weather' })

export type Weather = z.infer<typeof weatherSchema>

export const weatherResponseSchema = baseResponseSchema
  .extend(weatherSchema.partial().shape)
  .meta({ id: 'WeatherResponse' })

export type WeatherResponse = z.infer<typeof weatherResponseSchema>
