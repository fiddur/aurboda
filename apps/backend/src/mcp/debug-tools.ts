/**
 * MCP debugging tools — inspect raw integration payloads and audit log entries.
 *
 * Useful when "the sync ran clean but nothing landed" — check what the
 * upstream API actually returned (query_raw_records) and any warnings/errors
 * the sync logged along the way (query_audit_log).
 */

import { auditLogQuerySchema, queryRawRecordsQuerySchema, tzSchema } from '@aurboda/api-spec'

import { queryRawRecords } from '../db/index.ts'
import { getAuditLog } from '../services/audit-log.ts'
import { type McpServer, tzJsonResponse } from './helpers.ts'
import { formatInTz } from './tz-utils.ts'

export const registerDebugTools = (server: McpServer, user: string) => {
  server.tool(
    'query_raw_records',
    `Query the raw_records table — every upstream JSON payload the sync integrations have stored.
Use to debug "the sync ran clean but no activity/metric landed": inspect what the external API actually returned.

Default response only contains top-level data keys (data_keys). Pass include_data=true to get the full JSON.
Results are ordered by recorded_at DESC.

Typical usage:
- List Garmin sleep payloads for this week: source="garmin", record_type="garmin_sleep", start=<iso>, end=<iso>
- Fetch one specific payload in full: external_id="garmin-sleep-2026-04-22", include_data=true`,
    {
      ...queryRawRecordsQuerySchema.shape,
      tz: tzSchema,
    },
    async ({ end, external_id, include_data, limit, offset, record_type, source, start, tz }) => {
      const result = await queryRawRecords(user, {
        end: end ? new Date(end) : undefined,
        external_id,
        limit,
        offset,
        record_type,
        source,
        start: start ? new Date(start) : undefined,
      })

      return tzJsonResponse(
        {
          data: result.rows.map((row) => ({
            data: include_data ? row.data : undefined,
            data_keys: Object.keys(row.data ?? {}),
            external_id: row.external_id,
            id: row.id,
            received_at: formatInTz(row.received_at, tz),
            record_type: row.record_type,
            recorded_at: formatInTz(row.recorded_at, tz),
            source: row.source,
          })),
          success: true,
          total: result.total,
        },
        tz,
      )
    },
  )

  server.tool(
    'query_audit_log',
    `Query the user's audit log — per-user events (sync, auth, settings, data, deduction) written by the backend.
Use to confirm whether something ran, what failed, or what was rate-limited. Filters can be combined freely.
Results are ordered by timestamp DESC.`,
    {
      ...auditLogQuerySchema.shape,
      tz: tzSchema,
    },
    async ({ since, tz, until, ...rest }) => {
      const result = await getAuditLog(user, {
        ...rest,
        since: since ? new Date(since) : undefined,
        until: until ? new Date(until) : undefined,
      })

      return tzJsonResponse(
        {
          data: result.rows.map((row) => ({
            category: row.category,
            details: row.details ?? undefined,
            id: row.id,
            level: row.level,
            message: row.message,
            timestamp: formatInTz(row.timestamp, tz),
          })),
          success: true,
          total: result.total,
        },
        tz,
      )
    },
  )
}
