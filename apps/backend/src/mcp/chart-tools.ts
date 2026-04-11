/**
 * MCP chart data tools — bucketed aggregation for bar charts.
 */
import { chartDataQuerySchema } from '@aurboda/api-spec'

import { getChartData } from '../services/chart-data.ts'
import { jsonResponse, type McpServer } from './helpers.ts'

export const registerChartTools = (server: McpServer, user: string) => {
  server.tool(
    'query_chart_data',
    `Query bucketed chart data for tags, metrics, productivity categories, or activity types.
Returns time-bucketed aggregated values suitable for bar charts.

Bucket sizes: 1d (daily), 1w (weekly), 1M (monthly)
Aggregation: count (number of occurrences), sum (total value), mean (average value)

Examples:
- Daily coffee counts this month: source_type="tag", pattern="coffee", bucket_size="1d", aggregation="count"
- Weekly average weight: source_type="metric", pattern="weight", bucket_size="1w", aggregation="mean"
- Monthly programming hours: source_type="productivity_category", pattern="Work > Programming", bucket_size="1M"`,
    { ...chartDataQuerySchema.shape },
    async ({
      aggregation,
      breakdown_fields,
      bucket_size,
      end,
      pattern,
      source_type,
      start,
      tag_definition_id,
    }) => {
      try {
        const buckets = await getChartData(user, {
          aggregation,
          breakdown_fields,
          bucket_size,
          end,
          pattern,
          source_type,
          start,
          tag_definition_id,
        })
        return jsonResponse({ data: { buckets }, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )
}
