import {
  chartBreakdownError,
  chartDataQuerySchema,
  chartFilterError,
  JOURNAL_BREAKDOWN_MAX_SERIES,
  JOURNAL_OTHER_SERIES,
  journalChartError,
  journalChartFiltersOf,
  timeWeightedAveragesNote,
} from '@aurboda/api-spec'

import { getChartData } from '../services/chart-data.ts'
import { jsonResponse, type McpServer } from './helpers.ts'

export const registerChartTools = (server: McpServer, user: string) => {
  server.tool(
    'query_chart_data',
    `Query bucketed chart data for tags, metrics, productivity categories, activity types, or journal entries.
Returns time-bucketed aggregated values suitable for bar charts.

Bucket sizes: 1d (daily), 1w (weekly), 1M (monthly)
Aggregation: count (number of occurrences), sum (total value), mean (average value), max (highest value)
Means of metrics in buckets wider than 5 minutes: ${timeWeightedAveragesNote}
Measures: for activity types with list items (strength sets), measure (volume, e1rm, max_weight, set_count, max_time, total_reps, max_reps) charts that measure of each session instead of duration or count; filter_field/filter_value (e.g. sets.exercise = Bench Press) takes it over one exercise's items, and breakdown_fields=["sets.exercise"] gives one series per exercise. With a summed measure (set_count, volume, total_reps), breakdown_fields=["sets.exercise.muscle_group"] gives one series per muscle group, each set counted by the exercise's recruitment weight (bench press: 1 set for the chest, 0.5 for the shoulders); exercises not in the catalogue fall under "Not in the catalogue", and those in it without muscle data under "No muscle group". It combines with scalar fields, not with another item path. One muscle group alone: filter_field="sets.exercise.muscle_group" with a muscle group key as filter_value (chest, shoulders, lats, quadriceps, …) takes a summed measure over the exercises that train it, each weighted by its recruitment; breakdown_fields=["sets.exercise"] then splits it per exercise. list_muscle_groups and get_muscle_group_history give when each group was last trained and one group's totals, exercises and sessions.
Who it was with: breakdown_fields=["@people"] (activity_type) gives one series per person by name, an activity with several people counted in each, "(none)" for no one; it combines with data fields and item paths like a data field.
Journal: source_type="journal" (no pattern) charts the journal's entries, the thread roots search_notes lists: aggregation count is entries per bucket, sum the words written (an entry's own content, not its replies). breakdown_fields takes only "@tags" (one series per tag, explicit or #hashtag, an entry counted under each of its tags, "(none)" for untagged) and "@people" (one per person the entry is related to, "(none)" for no one); both give "<tag> / <person>" series. At most ${JOURNAL_BREAKDOWN_MAX_SERIES} series: the ${JOURNAL_BREAKDOWN_MAX_SERIES - 1} largest over the range and the rest summed as "${JOURNAL_OTHER_SERIES}". Filters as in search_notes: journal_tags (comma-separated, all of them), journal_related_type + journal_related_id, journal_q (full text), journal_entity_types (default "time,day"). measure, filter_field and filter_value do not apply.
Time zone: pass tz (IANA, e.g. "Europe/Stockholm") so days, weeks and months start at the user's local midnight; omitted means UTC.

Examples:
- Daily coffee counts this month: source_type="tag", pattern="coffee", bucket_size="1d", aggregation="count"
- Weekly average weight: source_type="metric", pattern="weight", bucket_size="1w", aggregation="mean"
- Monthly programming hours: source_type="productivity_category", pattern="Work > Programming", bucket_size="1M"
- Weekly sets per muscle group: source_type="activity_type", pattern="strength_training", measure="set_count", aggregation="sum", bucket_size="1w", breakdown_fields=["sets.exercise.muscle_group"]
- Weekly chest sets per exercise: source_type="activity_type", pattern="strength_training", measure="set_count", aggregation="sum", bucket_size="1w", filter_field="sets.exercise.muscle_group", filter_value="chest", breakdown_fields=["sets.exercise"]
- Highest Bench Press e1RM per week: source_type="activity_type", pattern="strength_training", measure="e1rm", aggregation="max", bucket_size="1w", filter_field="sets.exercise", filter_value="Bench Press"
- Journal entries per week by tag: source_type="journal", bucket_size="1w", aggregation="count", breakdown_fields=["@tags"]
- Words written per month in entries tagged travel: source_type="journal", bucket_size="1M", aggregation="sum", journal_tags="travel"

Each screentime category is also an activity type (its activity_type_name), so source_type="activity_type" with that name works too.`,
    { ...chartDataQuerySchema.shape },
    async (params) => {
      const {
        aggregation,
        breakdown_fields,
        bucket_size,
        end,
        filter_field,
        filter_value,
        measure,
        pattern,
        source_type,
        start,
        tag_definition_id,
        tz,
      } = params
      const queryError =
        journalChartError(params) ??
        chartBreakdownError(breakdown_fields, measure) ??
        chartFilterError(filter_field, filter_value, breakdown_fields, measure)
      if (queryError) return jsonResponse({ error: queryError, success: false })
      try {
        const buckets = await getChartData(user, {
          aggregation,
          breakdown_fields,
          bucket_size,
          end,
          filter_field,
          filter_value,
          measure,
          pattern,
          source_type,
          start,
          tag_definition_id,
          tz,
          ...journalChartFiltersOf(params),
        })
        return jsonResponse({ data: { buckets }, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )
}
