import { chartDataQuerySchema } from '@aurboda/api-spec'

import { getChartData } from '../services/chart-data.ts'
import { jsonResponse, type McpServer } from './helpers.ts'

export const registerChartTools = (server: McpServer, user: string) => {
  server.tool(
    'query_chart_data',
    `Query bucketed chart data for tags, metrics, productivity categories, or activity types.
Returns time-bucketed aggregated values suitable for bar charts.

Bucket sizes: 1d (daily), 1w (weekly), 1M (monthly)
Aggregation: count (number of occurrences), sum (total value), mean (average value), max (highest value)
Measures: for activity types with list items (strength sets), measure (volume, e1rm, max_weight, set_count, max_time) charts that measure of each session instead of duration or count; filter_field/filter_value (e.g. sets.exercise = Bench Press) takes it over one exercise's items, and breakdown_fields=["sets.exercise"] gives one series per exercise.
Time zone: pass tz (IANA, e.g. "Europe/Stockholm") so days, weeks and months start at the user's local midnight; omitted means UTC.

Examples:
- Daily coffee counts this month: source_type="tag", pattern="coffee", bucket_size="1d", aggregation="count"
- Weekly average weight: source_type="metric", pattern="weight", bucket_size="1w", aggregation="mean"
- Monthly programming hours: source_type="productivity_category", pattern="Work > Programming", bucket_size="1M"
- Highest Bench Press e1RM per week: source_type="activity_type", pattern="strength_training", measure="e1rm", aggregation="max", bucket_size="1w", filter_field="sets.exercise", filter_value="Bench Press"

Each screentime category is also an activity type (its activity_type_name), so source_type="activity_type" with that name works too.`,
    { ...chartDataQuerySchema.shape },
    async ({
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
    }) => {
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
        })
        return jsonResponse({ data: { buckets }, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )
}
