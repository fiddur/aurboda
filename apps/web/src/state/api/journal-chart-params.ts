import { type JournalChartFilters, journalChartFiltersOf } from '@aurboda/api-spec'

/** Copies the `journal_*` filters that are set (not empty) into a request's query. */
export const setJournalFilters = (query: JournalChartFilters, params: JournalChartFilters): void => {
  for (const [key, value] of Object.entries(journalChartFiltersOf(params))) {
    if (value) query[key as keyof JournalChartFilters] = value
  }
}
