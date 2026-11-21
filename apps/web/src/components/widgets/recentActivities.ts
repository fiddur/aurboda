import type { RecentActivitiesConfig, RecentActivitiesQuery, RecentActivity } from '@aurboda/api-spec'

import {
  formatDistanceKm,
  formatHoursMinutes,
  formatPace,
  formatSpeed,
  speedDisplayFor,
} from './activityTypeCard'

export type RecentActivitiesCardConfig = Partial<RecentActivitiesConfig>

export const recentActivitiesTitle = (config: RecentActivitiesCardConfig, period: boolean): string =>
  config.title ?? (!period && (config.window ?? 'today') === 'today' ? 'Today' : 'Latest activities')

export const recentActivitiesQuery = (
  config: RecentActivitiesCardConfig,
  tz: string,
): Partial<RecentActivitiesQuery> => ({
  limit: config.limit ?? 5,
  tz,
  window: config.window ?? 'today',
  ...(config.types?.length ? { types: config.types.join(',') } : {}),
  ...(config.exclude_types?.length ? { exclude_types: config.exclude_types.join(',') } : {}),
  ...(config.window === 'latest' && config.lookback_days !== undefined
    ? { lookback_days: config.lookback_days }
    : {}),
  ...(config.manual_only ? { manual_only: true } : {}),
})

export const rowLabel = (a: RecentActivity): string => a.title ?? a.type_name

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>()
const clockFormatters = new Map<string, Intl.DateTimeFormat>()

const formatterFor = (
  cache: Map<string, Intl.DateTimeFormat>,
  tz: string,
  make: () => Intl.DateTimeFormat,
) => {
  const cached = cache.get(tz)
  if (cached) return cached
  const formatter = make()
  cache.set(tz, formatter)
  return formatter
}

const dayKey = (date: Date, tz: string): string =>
  formatterFor(
    dayKeyFormatters,
    tz,
    () =>
      new Intl.DateTimeFormat('sv-SE', { day: '2-digit', month: '2-digit', timeZone: tz, year: 'numeric' }),
  ).format(date)

const previousDayKey = (key: string): string => {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const zonedParts = (date: Date, tz: string): Record<string, string> =>
  Object.fromEntries(
    formatterFor(
      clockFormatters,
      tz,
      () =>
        new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          hour: '2-digit',
          hourCycle: 'h23',
          minute: '2-digit',
          month: 'short',
          timeZone: tz,
        }),
    )
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )

/** The start in `tz`: the time today, "Yesterday" and the time, else the date and the time. */
export const rowWhen = (a: RecentActivity, now: Date, tz: string): string => {
  const start = new Date(a.start_time)
  const p = zonedParts(start, tz)
  const time = `${p.hour}:${p.minute}`
  const day = dayKey(start, tz)
  const today = dayKey(now, tz)
  if (day === today) return time
  if (day === previousDayKey(today)) return `Yesterday ${time}`
  return `${p.day} ${p.month} ${time}`
}

const MAX_FIGURES = 3

const paceOrSpeed = (a: RecentActivity): string | undefined => {
  if (!a.distance_m || !a.duration_minutes) return undefined
  const km = a.distance_m / 1000
  return speedDisplayFor({ pattern: a.activity_type }) === 'pace'
    ? formatPace((a.duration_minutes * 60) / km)
    : formatSpeed(km / (a.duration_minutes / 60))
}

/** The type name when the label is a title, then up to three figures the row has. */
export const rowFigures = (a: RecentActivity): string => {
  const figures = [
    a.duration_minutes ? formatHoursMinutes(a.duration_minutes) : undefined,
    a.distance_m ? formatDistanceKm(a.distance_m / 1000) : undefined,
    paceOrSpeed(a),
    a.set_count ? `${a.set_count} ${a.set_count === 1 ? 'set' : 'sets'}` : undefined,
    a.avg_hr ? `${Math.round(a.avg_hr)} bpm` : undefined,
    a.calories ? `${Math.round(a.calories)} kcal` : undefined,
  ]
    .filter((f): f is string => f !== undefined)
    .slice(0, MAX_FIGURES)
  const typeName = a.title && a.title !== a.type_name ? [a.type_name] : []
  return [...typeName, ...figures].join(' · ')
}

export const emptyMessage = (config: RecentActivitiesCardConfig, period: boolean): string => {
  if (period) return 'No activities in this period'
  if ((config.window ?? 'today') === 'today') return 'Nothing logged today'
  return `No activities in the last ${config.lookback_days ?? 30} days`
}
