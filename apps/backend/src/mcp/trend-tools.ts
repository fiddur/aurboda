/**
 * MCP trend analysis tools.
 */
import { getTrendQuerySchema } from '@aurboda/api-spec'

import { getUserSettings } from '../db/index.ts'
import { getTrend } from '../services/trends.ts'
import { jsonResponse, type McpServer } from './helpers.ts'

export const registerTrendTools = (server: McpServer, user: string) => {
  // Tool: get_trend
  server.tool(
    'get_trend',
    `Calculate time-weighted trend for tags or metrics using Exponential Moving Average (EMA).
EMA gives more weight to recent data while smoothing over a configurable period.
The half-life parameter controls decay: after half-life days, an event's weight drops to 50%.

Examples:
- Tag trend: "How many painkillers per month?" -> pattern: "pain_killer", sourceType: "tag"
- Metric trend: "What's my average weight trend?" -> pattern: "weight", sourceType: "metric"

Common half-life values:
- 7 days (quick): Responds to changes within a week
- 15 days (responsive): Balanced, good default
- 30 days (stable): Smooths out short-term variation`,
    { ...getTrendQuerySchema.shape },
    async ({ aggregation, display_period, half_life_days, lookback_days, pattern, source_type }) => {
      try {
        const settings = await getUserSettings(user)
        const customMetrics = settings?.custom_metrics ?? []

        const result = await getTrend(user, {
          aggregation,
          custom_metrics: customMetrics,
          display_period,
          half_life_days,
          lookback_days,
          pattern,
          source_type,
        })
        return jsonResponse({ data: result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )
}
