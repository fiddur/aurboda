import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { validMetrics } from '@aurboda/api-spec'

import { convertTimestamps } from './tz-utils.ts'

export const metricDescription = `Metric name. Valid metrics: ${validMetrics.join(', ')}`

export const jsonResponse = (data: unknown) => ({
  content: [{ text: JSON.stringify(data, null, 2), type: 'text' as const }],
})

export const tzJsonResponse = (data: unknown, tz: string) => ({
  content: [
    {
      text: JSON.stringify({ ...(convertTimestamps(data, tz) as object), tz }, null, 2),
      type: 'text' as const,
    },
  ],
})

export const errorResponse = (message: string) => ({
  content: [{ text: message, type: 'text' as const }],
})

/**
 * Helper to parse optional ISO date string (for fields using plain z.string()).
 * Note: Fields using startDateTimeQuerySchema/endDateTimeQuerySchema are already
 * validated by zod, so they can be converted directly with new Date().
 */
export const parseOptionalDate = (dateStr: string): Date | null => {
  const date = new Date(dateStr)
  return isNaN(date.getTime()) ? null : date
}

/** Optional sync provider dependency for tools that trigger auto-sync. */
export type { SyncProvider } from '../services/queries/index.ts'

/** Type alias for McpServer to avoid repetitive imports. */
export type { McpServer }
