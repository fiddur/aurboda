import {
  type ChartDataBreakdownBucket,
  type ChartDataBucket,
  displayPeriodMultipliers,
  isPeopleBreakdownField,
  isTagsBreakdownField,
  JOURNAL_AGGREGATION_ERROR,
  JOURNAL_BREAKDOWN_ERROR,
  JOURNAL_BREAKDOWN_MAX_SERIES,
  JOURNAL_OTHER_SERIES,
  type JournalChartFilters,
  NOTES_SEARCH_RELATED_PAIR_ERROR,
  NOTES_SEARCH_TAGS_ERROR,
  type NoteRelatedEntityType,
  noteRelatedEntityTypes,
  notesSearchEntityTypeError,
  parseNotesSearchEntityTypes,
  parseNotesSearchTags,
  type TrendDisplayPeriod,
  type TrendHistoryPoint,
  type TrendResult,
  unknownNotesSearchEntityType,
} from '@aurboda/api-spec'

import {
  getFirstJournalDay,
  getJournalSeries,
  type JournalFilterParams,
  type JournalSeriesRow,
} from '../db/index.ts'
import { UUID_RE } from '../utils.ts'
import { dayEndInTz, dayKey, dayKeysEndingAt, dayStartInTz } from './day-keys.ts'
import { splitSearchText } from './notes.ts'
import { NONE_LABEL, stablePersonSeriesLabels } from './people-breakdown.ts'
import { computeEma, displayUnits, warmupLength } from './trend-ema.ts'

type JournalFilters = Omit<JournalFilterParams, 'tz'>

const isRelatedType = (type: string): type is NoteRelatedEntityType =>
  (noteRelatedEntityTypes as readonly string[]).includes(type)

/** The `journal_*` parameters as the db filters, or what is wrong with them. */
export const journalFiltersOf = (
  input: JournalChartFilters,
): { error: string } | { filters: JournalFilters } => {
  const tags = parseNotesSearchTags(input.journal_tags)
  if (tags === null) return { error: NOTES_SEARCH_TAGS_ERROR }
  const unknownType = unknownNotesSearchEntityType(input.journal_entity_types)
  if (unknownType !== undefined) return { error: notesSearchEntityTypeError(unknownType) }
  const { journal_related_id: relatedId, journal_related_type: relatedType } = input
  if ((relatedType === undefined) !== (relatedId === undefined)) {
    return { error: NOTES_SEARCH_RELATED_PAIR_ERROR }
  }
  if (relatedType !== undefined && !isRelatedType(relatedType)) {
    return { error: `Not a related type: ${relatedType} (one of ${noteRelatedEntityTypes.join(', ')})` }
  }
  if (relatedId !== undefined && !UUID_RE.test(relatedId)) return { error: `Not a UUID: ${relatedId}` }
  return {
    filters: {
      entity_types: parseNotesSearchEntityTypes(input.journal_entity_types),
      ...(relatedType !== undefined && relatedId !== undefined
        ? { related: { entity_id: relatedId, entity_type: relatedType } }
        : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(input.journal_q === undefined ? {} : { text: splitSearchText(input.journal_q) }),
    },
  }
}

const filtersOrThrow = (input: JournalChartFilters): JournalFilters => {
  const parsed = journalFiltersOf(input)
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed.filters
}

const valueOf = (aggregation: string | undefined): 'count' | 'words' => {
  if (aggregation === undefined || aggregation === 'count') return 'count'
  if (aggregation === 'sum') return 'words'
  throw new Error(JOURNAL_AGGREGATION_ERROR)
}

const breakdownOf = (fields: string[]): { tags: boolean; people: boolean } => {
  if (!fields.every((f) => isTagsBreakdownField(f) || isPeopleBreakdownField(f))) {
    throw new Error(JOURNAL_BREAKDOWN_ERROR)
  }
  return { people: fields.some(isPeopleBreakdownField), tags: fields.some(isTagsBreakdownField) }
}

const rowPeople = (rows: JournalSeriesRow[]) => rows.flatMap((row) => (row.person ? [row.person] : []))

/** Each row's series name: its tag and/or person (by `labels`) in the order of `fields`, joined by ` / `. */
export const journalSeriesNames = (
  rows: JournalSeriesRow[],
  fields: string[],
  labels: Map<string, string>,
): string[] =>
  rows.map((row) =>
    fields
      .map((field) => {
        if (isTagsBreakdownField(field)) return row.tag ?? NONE_LABEL
        return row.person ? (labels.get(row.person.id) ?? NONE_LABEL) : NONE_LABEL
      })
      .join(' / '),
  )

/**
 * At most `max` series: with more, the `max - 1` with the highest total (ties by name) are kept and
 * the rest fold into {@link JOURNAL_OTHER_SERIES}. `series` is the kept names sorted, `Other` last;
 * `nameOf` maps each series to the one it is shown as.
 */
export const foldSeries = (
  totals: Map<string, number>,
  max = JOURNAL_BREAKDOWN_MAX_SERIES,
): { series: string[]; nameOf: Map<string, string> } => {
  const names = [...totals.keys()]
  if (names.length <= max) {
    return { nameOf: new Map(names.map((n) => [n, n])), series: names.toSorted() }
  }
  const kept = new Set(
    names
      .toSorted((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, max - 1),
  )
  return {
    nameOf: new Map(names.map((n) => [n, kept.has(n) ? n : JOURNAL_OTHER_SERIES])),
    series: [...[...kept].toSorted(), JOURNAL_OTHER_SERIES],
  }
}

const sumInto = (target: Map<string, number>, key: string, value: number): void => {
  target.set(key, (target.get(key) ?? 0) + value)
}

export interface JournalChartInput extends JournalChartFilters {
  aggregation?: string
  breakdown_fields?: string[]
  bucket_size: string
  end: string
  start: string
}

export interface JournalChartResult {
  buckets: (ChartDataBucket | ChartDataBreakdownBucket)[]
  breakdown_fields?: string[]
  breakdown_series?: string[]
}

/** The entries (or their words) per bucket, optionally per tag and/or person, folded to the series cap. */
export const getJournalChartData = async (
  user: string,
  input: JournalChartInput,
  tz: string,
): Promise<JournalChartResult> => {
  const filters = filtersOrThrow(input)
  const fields = input.breakdown_fields ?? []
  const rows = await getJournalSeries(user, {
    ...filters,
    breakdown: breakdownOf(fields),
    bucket_size: input.bucket_size,
    end: new Date(input.end),
    start: new Date(input.start),
    tz,
    value: valueOf(input.aggregation),
  })
  if (fields.length === 0) {
    return {
      buckets: rows.map((row) => ({ bucket_start: row.bucket_start.toISOString(), value: row.value })),
    }
  }

  const names = journalSeriesNames(rows, fields, await stablePersonSeriesLabels(user, rowPeople(rows)))
  const totals = new Map<string, number>()
  rows.forEach((row, i) => sumInto(totals, names[i], row.value))
  const { nameOf, series } = foldSeries(totals)
  const byBucket = new Map<string, Map<string, number>>()
  rows.forEach((row, i) => {
    const bucket = byBucket.getOrInsertComputed(row.bucket_start.toISOString(), () => new Map())
    sumInto(bucket, nameOf.get(names[i]) ?? names[i], row.value)
  })
  return {
    breakdown_fields: fields,
    breakdown_series: series,
    buckets: [...byBucket].map(([bucketStart, values]) => ({
      bucket_start: bucketStart,
      series: Object.fromEntries(values),
    })),
  }
}

export interface JournalTrendInput extends JournalChartFilters {
  aggregation?: string
  breakdown_fields?: string[]
  /** The trend ends on the calendar day holding this instant; now when unset. */
  end?: Date
}

export interface JournalTrendOptions {
  displayPeriod: TrendDisplayPeriod
  halfLifeDays: number
  lookbackDays: number
  tz: string
}

/**
 * The zero-filled EMA of the entries (or words) per day, from the day of the first matching entry.
 * With a breakdown, one EMA per series, the series folded to the cap before the EMA so `Other` is
 * the EMA of the summed rest.
 */
export const getJournalTrend = async (
  user: string,
  input: JournalTrendInput,
  { displayPeriod, halfLifeDays, lookbackDays, tz }: JournalTrendOptions,
): Promise<TrendResult> => {
  const filters = filtersOrThrow(input)
  const fields = input.breakdown_fields ?? []
  const value = valueOf(input.aggregation)
  const multiplier = displayPeriodMultipliers[displayPeriod]
  const warmupCount = warmupLength(halfLifeDays, multiplier)
  const lastDay = input.end === undefined ? dayKey(new Date(), tz) : dayKey(input.end, tz)
  const days = dayKeysEndingAt(dayStartInTz(lastDay, tz), lookbackDays + warmupCount + 1, tz)
  const [rows, firstDay] = await Promise.all([
    getJournalSeries(user, {
      ...filters,
      breakdown: breakdownOf(fields),
      bucket_size: '1d',
      end: dayEndInTz(lastDay, tz),
      start: dayStartInTz(days[0], tz),
      tz,
      value,
    }),
    getFirstJournalDay(user, { ...filters, tz }),
  ])
  const ema = (daily: Map<string, number>): TrendHistoryPoint[] =>
    firstDay === undefined
      ? []
      : computeEma(daily, days, halfLifeDays, multiplier, { displayStartIdx: warmupCount, firstDay })

  const base = {
    aggregation: value === 'count' ? 'count' : 'sum',
    display_period: displayPeriod,
    display_unit: value === 'count' ? displayUnits[displayPeriod] : `words ${displayUnits[displayPeriod]}`,
    half_life_days: halfLifeDays,
    lookback_days: lookbackDays,
    pattern: '',
    source_type: 'journal',
  } as const

  if (fields.length === 0) {
    const daily = new Map<string, number>()
    for (const row of rows) sumInto(daily, dayKey(row.bucket_start, tz), row.value)
    const history = ema(daily)
    return { ...base, current_value: history.at(-1)?.value ?? 0, history }
  }

  const names = journalSeriesNames(rows, fields, await stablePersonSeriesLabels(user, rowPeople(rows)))
  const displayStart = days[Math.min(Math.ceil(warmupCount), days.length - 1)]
  const totals = new Map<string, number>()
  rows.forEach((row, i) => {
    if (!totals.has(names[i])) totals.set(names[i], 0)
    if (dayKey(row.bucket_start, tz) >= displayStart) sumInto(totals, names[i], row.value)
  })
  const { nameOf, series } = foldSeries(totals)
  const seriesDaily = new Map<string, Map<string, number>>()
  rows.forEach((row, i) => {
    const daily = seriesDaily.getOrInsertComputed(nameOf.get(names[i]) ?? names[i], () => new Map())
    sumInto(daily, dayKey(row.bucket_start, tz), row.value)
  })
  return {
    ...base,
    breakdown_histories: Object.fromEntries(series.map((s) => [s, ema(seriesDaily.get(s) ?? new Map())])),
    breakdown_series: series,
    current_value: 0,
    history: [],
  }
}
