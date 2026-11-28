import {
  CHART_ALL_TIME_FALLBACK_DAYS,
  CHART_ALL_TIME_LOOKBACK_DAYS,
  type ChartDataSourceType,
  isHrZoneMetric,
  type JournalChartFilters,
  type MetricType,
} from '@aurboda/api-spec'

import {
  expandActivityTypes,
  getFirstActivityDay,
  getFirstActivityDayMatching,
  getFirstCategoryDay,
  getFirstJournalDay,
  getFirstMetricDay,
  getSourceFilter,
} from '../db/index.ts'
import { dayKey } from './day-keys.ts'
import { journalFiltersOf } from './journal-chart.ts'

export interface ChartFirstDaySource extends JournalChartFilters {
  activity_type_id?: string
  pattern?: string
  source_type: ChartDataSourceType
  /** @deprecated Use activity_type_id instead */
  tag_definition_id?: string
  tz: string
}

export interface ChartFirstDayDeps {
  expandActivityTypes: typeof expandActivityTypes
  getFirstActivityDay: typeof getFirstActivityDay
  getFirstActivityDayMatching: typeof getFirstActivityDayMatching
  getFirstCategoryDay: typeof getFirstCategoryDay
  getFirstJournalDay: typeof getFirstJournalDay
  getFirstMetricDay: typeof getFirstMetricDay
}

export interface ChartFirstDayOptions {
  /**
   * Read an `activity_type` or `tag` source as exactly that type, as a trend counts it (`activity_type = $1`), rather
   * than with its subtypes or as a regex.
   */
  exactType?: boolean
}

/** Resolved at call time, so importing this module never touches the db module's bindings. */
const defaultDeps: ChartFirstDayDeps = {
  expandActivityTypes: (...args) => expandActivityTypes(...args),
  getFirstActivityDay: (...args) => getFirstActivityDay(...args),
  getFirstActivityDayMatching: (...args) => getFirstActivityDayMatching(...args),
  getFirstCategoryDay: (...args) => getFirstCategoryDay(...args),
  getFirstJournalDay: (...args) => getFirstJournalDay(...args),
  getFirstMetricDay: (...args) => getFirstMetricDay(...args),
}

/** The metric a chart's samples come from: the heart-rate zones are computed from heart rate. */
const sampledMetricOf = (pattern: string): string => {
  const metric = pattern === 'zone2_weekly' ? 'hr_zone_2_sec' : pattern
  return isHrZoneMetric(metric as MetricType) ? 'heart_rate' : metric
}

const activityFirstDay = async (
  user: string,
  source: ChartFirstDaySource,
  options: ChartFirstDayOptions,
  deps: ChartFirstDayDeps,
): Promise<string | undefined> => {
  const { pattern, tz } = source
  if (options.exactType) return pattern ? deps.getFirstActivityDay(user, [pattern], tz) : undefined
  if (source.source_type === 'activity_type') {
    return pattern
      ? deps.getFirstActivityDay(user, await deps.expandActivityTypes(user, [pattern]), tz)
      : undefined
  }
  const typeId = source.activity_type_id ?? source.tag_definition_id
  if (typeId) return deps.getFirstActivityDay(user, await deps.expandActivityTypes(user, [typeId]), tz)
  return pattern ? deps.getFirstActivityDayMatching(user, pattern, tz) : undefined
}

/**
 * The first local day (`YYYY-MM-DD` in `tz`) with data for a chart source, read the way the chart reads it:
 * an activity type with its subtypes, a metric from its trusted sources, a category with its sub-categories, the
 * journal through its filters. Undefined when the source has no data.
 */
export const getChartFirstDay = async (
  user: string,
  source: ChartFirstDaySource,
  options: ChartFirstDayOptions = {},
  deps: ChartFirstDayDeps = defaultDeps,
): Promise<string | undefined> => {
  const { pattern, tz } = source
  switch (source.source_type) {
    case 'journal': {
      const parsed = journalFiltersOf(source)
      if ('error' in parsed) throw new Error(parsed.error)
      return deps.getFirstJournalDay(user, { ...parsed.filters, tz })
    }
    case 'activity_type':
    case 'tag':
      return activityFirstDay(user, source, options, deps)
    case 'metric': {
      if (!pattern) return undefined
      const metric = sampledMetricOf(pattern)
      return deps.getFirstMetricDay(user, metric, getSourceFilter(metric), tz)
    }
    case 'productivity_category':
      return pattern ? deps.getFirstCategoryDay(user, pattern, tz) : undefined
  }
}

/** Whole days from `firstDay` to `today` (both `YYYY-MM-DD`), at least one; the fallback when there is no first day. */
export const allTimeLookbackDays = (firstDay: string | undefined, today: string): number =>
  firstDay === undefined
    ? CHART_ALL_TIME_FALLBACK_DAYS
    : Math.max(1, Temporal.PlainDate.from(firstDay).until(Temporal.PlainDate.from(today)).days)

/** A chart's lookback: as given, or for all time (0) the days from the source's first day to the day of `end`. */
export const resolveChartLookbackDays = async (
  user: string,
  source: ChartFirstDaySource,
  lookbackDays: number,
  end: Date = new Date(),
  options: ChartFirstDayOptions = {},
  deps: ChartFirstDayDeps = defaultDeps,
): Promise<number> =>
  lookbackDays === CHART_ALL_TIME_LOOKBACK_DAYS
    ? allTimeLookbackDays(await getChartFirstDay(user, source, options, deps), dayKey(end, source.tz))
    : lookbackDays
