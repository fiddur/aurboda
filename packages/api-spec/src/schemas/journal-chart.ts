/**
 * Journal entries as a chart source (`source_type: 'journal'`): the thread roots the Journal lists,
 * counted (`count`) or their words summed (`sum`), broken down by tag or by person, filtered as
 * `GET /notes/search` filters.
 */

import { z } from 'zod'

import { isPeopleBreakdownField, PEOPLE_BREAKDOWN_FIELD } from './breakdown-fields.ts'
import {
  NOTES_SEARCH_RELATED_PAIR_ERROR,
  NOTES_SEARCH_TAGS_ERROR,
  noteRelatedEntityTypeSchema,
  notesSearchEntityTypeError,
  parseNotesSearchTags,
  unknownNotesSearchEntityType,
} from './notes.ts'

/** The reserved breakdown field for a journal entry's tags (explicit and #hashtags). */
export const TAGS_BREAKDOWN_FIELD = '@tags'

export const isTagsBreakdownField = (field: string): boolean => field === TAGS_BREAKDOWN_FIELD

export const JOURNAL_BREAKDOWN_FIELDS: readonly string[] = [TAGS_BREAKDOWN_FIELD, PEOPLE_BREAKDOWN_FIELD]

export const JOURNAL_BREAKDOWN_MAX_SERIES = 8

export const JOURNAL_OTHER_SERIES = 'Other'

export const JOURNAL_BREAKDOWN_NOTE = `For a journal source, @tags gives one series per tag (an entry with several tags counted under each, (none) for an untagged one) and @people one per person the entry is related to ((none) for no one); together they give "<tag> / <person>" series. A journal breakdown keeps at most ${JOURNAL_BREAKDOWN_MAX_SERIES} series: the ${JOURNAL_BREAKDOWN_MAX_SERIES - 1} with the highest total over the range, and the rest summed as "${JOURNAL_OTHER_SERIES}".`

/** The `GET /notes/search` filters, for a journal source only. */
export const journalChartFilterShape = {
  journal_entity_types: z.string().optional().meta({
    description:
      'Journal source: comma-separated root types to count (default "time,day", the free-standing entries); add "activity", "meal", "report", "productivity" or "metric" to count comments on those too',
    example: 'time,day',
  }),
  journal_q: z.string().max(500).optional().meta({
    description:
      'Journal source: only entries matching this full-text search over title and content (words, "quoted phrases", -excluded, or); a match in a reply counts its entry',
  }),
  journal_related_id: z.string().uuid().optional().meta({
    description: 'Journal source, with journal_related_type: only entries related to this entity (by its id)',
  }),
  journal_related_type: noteRelatedEntityTypeSchema.optional().meta({
    description:
      'Journal source, with journal_related_id: whether it names a person, an activity, a meal, a report or a check-in',
  }),
  journal_tags: z.string().optional().meta({
    description: 'Journal source: comma-separated tags; only entries carrying all of them',
    example: 'travel,family',
  }),
}

export interface JournalChartFilters {
  journal_entity_types?: string
  journal_q?: string
  journal_related_id?: string
  journal_related_type?: string
  journal_tags?: string
}

const JOURNAL_FILTER_KEYS = [
  'journal_entity_types',
  'journal_q',
  'journal_related_id',
  'journal_related_type',
  'journal_tags',
] as const satisfies readonly (keyof JournalChartFilters)[]

/** The `journal_*` filters of a query object, without the ones it leaves unset. */
export const journalChartFiltersOf = <T extends JournalChartFilters>(
  query: T,
): Pick<T, (typeof JOURNAL_FILTER_KEYS)[number]> =>
  Object.fromEntries(
    JOURNAL_FILTER_KEYS.flatMap((key) => (query[key] === undefined ? [] : [[key, query[key]]])),
  ) as Pick<T, (typeof JOURNAL_FILTER_KEYS)[number]>

export const JOURNAL_BREAKDOWN_ERROR = 'a journal breakdown is @tags or @people'
export const JOURNAL_MEASURE_ERROR = 'measure and filter_field are for activity_type sources'
export const JOURNAL_AGGREGATION_ERROR = 'a journal chart counts entries (count) or sums their words (sum)'
export const JOURNAL_FILTERS_NEED_JOURNAL_ERROR = 'journal_* filters need source_type journal'
export const TAGS_BREAKDOWN_NEEDS_JOURNAL_ERROR = '@tags is a journal breakdown'

export interface JournalChartQuery extends JournalChartFilters {
  aggregation?: string
  breakdown_fields?: string[]
  filter_field?: string
  filter_value?: string
  measure?: unknown
  source_type: string
}

const journalFilterError = (query: JournalChartFilters): string | undefined => {
  if (parseNotesSearchTags(query.journal_tags) === null) return NOTES_SEARCH_TAGS_ERROR
  const unknownType = unknownNotesSearchEntityType(query.journal_entity_types)
  if (unknownType !== undefined) return notesSearchEntityTypeError(unknownType)
  if ((query.journal_related_type === undefined) !== (query.journal_related_id === undefined)) {
    return NOTES_SEARCH_RELATED_PAIR_ERROR
  }
  return undefined
}

/** The first rule a chart or trend query breaks about the journal source, as its message. */
export const journalChartError = (query: JournalChartQuery): string | undefined => {
  const fields = query.breakdown_fields ?? []
  if (query.source_type !== 'journal') {
    if (JOURNAL_FILTER_KEYS.some((key) => query[key] !== undefined)) return JOURNAL_FILTERS_NEED_JOURNAL_ERROR
    if (fields.some(isTagsBreakdownField)) return TAGS_BREAKDOWN_NEEDS_JOURNAL_ERROR
    return undefined
  }
  if (!fields.every((field) => isTagsBreakdownField(field) || isPeopleBreakdownField(field))) {
    return JOURNAL_BREAKDOWN_ERROR
  }
  if (query.measure !== undefined || query.filter_field !== undefined || query.filter_value !== undefined) {
    return JOURNAL_MEASURE_ERROR
  }
  if (query.aggregation === 'mean' || query.aggregation === 'max') return JOURNAL_AGGREGATION_ERROR
  return journalFilterError(query)
}
