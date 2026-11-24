import {
  breakdownFieldLabel,
  type ChartDataAggregation,
  isTagsBreakdownField,
  JOURNAL_OTHER_SERIES,
  type JournalChartFilters,
  normalizeTag,
  PEOPLE_BREAKDOWN_FIELD,
  TAGS_BREAKDOWN_FIELD,
} from '@aurboda/api-spec'
import { addDays, format } from 'date-fns'

import type { BarClickInfo } from '../../components/charts/BarChart'

import { JOURNAL_WITH_COMMENTS_ENTITY_TYPES } from '../../state/api/journal-params'
import { tagList } from '../Journal/journal-list'
import { isRelatedType, type RelatedFilter, relatedFilterFromQuery } from '../Journal/related'
import { computeBucketEnd } from './barDataHref'

/** The journal source's filters on the Chart page. */
export interface JournalState {
  journal_tags: string[]
  journal_related?: RelatedFilter
  journal_q: string
  /** "Also count comments on activities, meals and reports". */
  journal_comments: boolean
  /** A `journal_entity_types` the URL gave that is not the switch's own list, kept as given. */
  journal_entity_types: string
}

export const EMPTY_JOURNAL_STATE: JournalState = {
  journal_comments: false,
  journal_entity_types: '',
  journal_q: '',
  journal_related: undefined,
  journal_tags: [],
}

const DEFAULT_ENTITY_TYPES = 'time,day'

const relatedOf = (filters: JournalChartFilters): RelatedFilter | undefined => {
  const type = filters.journal_related_type
  return isRelatedType(type) ? relatedFilterFromQuery({ [type]: filters.journal_related_id }) : undefined
}

/** The journal state of a chart URL or a chart card's config, which name the filters alike. */
export const parseJournalQuery = (query: JournalChartFilters): JournalState => {
  const types = query.journal_entity_types?.trim() ?? ''
  const custom =
    types !== '' && types !== DEFAULT_ENTITY_TYPES && types !== JOURNAL_WITH_COMMENTS_ENTITY_TYPES
  return {
    journal_comments: custom || types === JOURNAL_WITH_COMMENTS_ENTITY_TYPES,
    journal_entity_types: custom ? types : '',
    journal_q: query.journal_q ?? '',
    journal_related: relatedOf(query),
    journal_tags: tagList(query.journal_tags),
  }
}

/**
 * The `journal_*` filters of the state: the URL's parameters, the chart-data and trend query's, and a
 * chart card's config fields. A related filter counts comments too, as the Journal list does.
 */
export const journalFilters = (state: JournalState): JournalChartFilters => {
  const withComments = state.journal_comments || state.journal_related !== undefined
  const q = state.journal_q.trim()
  return {
    ...(withComments
      ? { journal_entity_types: state.journal_entity_types || JOURNAL_WITH_COMMENTS_ENTITY_TYPES }
      : {}),
    ...(q ? { journal_q: q } : {}),
    ...(state.journal_related
      ? { journal_related_id: state.journal_related.id, journal_related_type: state.journal_related.type }
      : {}),
    ...(state.journal_tags.length > 0 ? { journal_tags: state.journal_tags.join(',') } : {}),
  }
}

export const JOURNAL_AGGREGATION_OPTIONS: { label: string; value: ChartDataAggregation }[] = [
  { label: 'Entries', value: 'count' },
  { label: 'Words', value: 'sum' },
]

/** A journal chart counts entries or sums their words; anything else is a count. */
export const parseJournalAggregation = (raw: string | undefined): ChartDataAggregation =>
  raw === 'sum' ? 'sum' : 'count'

/** Tags, and With (who the entry is related to) when the account has people or the chart already breaks down by them. */
export const journalBreakdownOptions = (
  breakdownFields: string[],
  hasPeople: boolean,
): { label: string; name: string }[] => [
  { label: breakdownFieldLabel(TAGS_BREAKDOWN_FIELD), name: TAGS_BREAKDOWN_FIELD },
  ...(hasPeople || breakdownFields.includes(PEOPLE_BREAKDOWN_FIELD)
    ? [{ label: breakdownFieldLabel(PEOPLE_BREAKDOWN_FIELD), name: PEOPLE_BREAKDOWN_FIELD }]
    : []),
]

const SUB_DAILY = new Set(['1m', '5m', '15m', '1h'])

/** The last local day of a bucket: the day before its end for a day, week or month, its own day for a shorter one. */
export const bucketLastDay = (bucketStart: string, bucketSize: string): string => {
  const start = new Date(bucketStart)
  if (SUB_DAILY.has(bucketSize)) return format(start, 'yyyy-MM-dd')
  return format(addDays(computeBucketEnd(start, bucketSize), -1), 'yyyy-MM-dd')
}

/** The tag of a clicked series, when the chart breaks down by tags and the series is one tag. */
const seriesTag = (
  seriesName: string | undefined,
  breakdownFields: string[] | undefined,
): string | undefined => {
  const index = breakdownFields?.findIndex(isTagsBreakdownField) ?? -1
  if (!seriesName || index < 0 || seriesName === JOURNAL_OTHER_SERIES) return undefined
  const part = seriesName.split(' / ')[index]
  return part && part !== '(none)' && part !== JOURNAL_OTHER_SERIES
    ? (normalizeTag(part) ?? undefined)
    : undefined
}

/**
 * The Journal at a clicked bar: gone to the bucket's last day (it lists that day and older, so the
 * bucket's entries come first), filtered as the chart is, and by the clicked series' tag.
 */
export const journalBarHref = (
  info: BarClickInfo,
  bucketSize: string,
  breakdownFields: string[] | undefined,
  filters: JournalChartFilters,
): string => {
  const state = parseJournalQuery(filters)
  const tag = seriesTag(info.series_name, breakdownFields)
  const tags = tag && !state.journal_tags.includes(tag) ? [...state.journal_tags, tag] : state.journal_tags
  const params = new URLSearchParams({ date: bucketLastDay(info.bucket_start, bucketSize) })
  if (tags.length > 0) params.set('tag', tags.join(','))
  if (state.journal_related) params.set(state.journal_related.type, state.journal_related.id)
  if (state.journal_q) params.set('q', state.journal_q)
  if (state.journal_comments) params.set('comments', '1')
  return `/journal?${params}`
}
