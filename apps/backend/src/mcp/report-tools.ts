import { addReportBodySchema, reportsQuerySchema, tzSchema, updateReportBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addReport,
  deleteReportById,
  getLatestMetric,
  getReport,
  queryReports,
  updateReport,
} from '../services/reports.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

export const registerReportTools = (server: McpServer, user: string) => {
  server.tool(
    'add_report',
    'Create a structured lab report with grouped measurements (e.g., InBody scan, blood panel, hair mineral analysis). Each entry is also written to the metric time series for trend tracking. An entry metric that is a name or alias from list_metric_catalog resolves to the catalogue metric (added on first use), and its value is converted to the unit the metric is stored in; the entry keeps the value and unit as printed, with stored_value/stored_unit when they differ. An entry whose unit cannot be converted refuses the whole report. Flags are auto-derived from reference ranges if not set.',
    { ...addReportBodySchema.shape, tz: tzSchema },
    async ({ tz, ...params }) => {
      const result = await addReport(user, {
        date: params.date,
        entries: params.entries,
        location: params.location,
        notes: params.notes,
        report_type: params.report_type,
      })
      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to add report')
      }
      return tzJsonResponse(result, tz)
    },
  )

  server.tool(
    'get_report',
    'Fetch a single lab report by its ID, including all entries with their metadata.',
    { id: z.string().uuid().describe('The report ID'), tz: tzSchema },
    async ({ id, tz }) => {
      const result = await getReport(user, id)
      if (!result.success) {
        return errorResponse(result.error ?? 'Report not found')
      }
      return tzJsonResponse(result, tz)
    },
  )

  server.tool(
    'query_reports',
    'List lab reports, optionally filtered by type (e.g., "inbody", "blood_panel") and/or date range.',
    { ...reportsQuerySchema.shape, tz: tzSchema },
    async ({ tz, ...params }) => {
      const result = await queryReports(user, {
        end: params.end,
        report_type: params.report_type,
        start: params.start,
      })
      return tzJsonResponse(result, tz)
    },
  )

  server.tool(
    'update_report',
    'Update a lab report. Can modify metadata (report_type, date, location, notes) and/or replace all entries. When entries are provided, they fully replace existing entries, resolved and converted as in add_report. Flags are auto-derived from reference ranges if not set.',
    {
      id: z.string().uuid().describe('The report ID to update'),
      ...updateReportBodySchema.shape,
      tz: tzSchema,
    },
    async ({ id, tz, ...params }) => {
      const result = await updateReport(user, id, params)
      if (!result.success) {
        return errorResponse(result.error ?? 'Report not found')
      }
      return tzJsonResponse(result, tz)
    },
  )

  server.tool(
    'delete_report',
    'Delete a lab report and its write-through metric data from the time series.',
    { id: z.string().uuid().describe('The report ID to delete') },
    async ({ id }) => {
      const result = await deleteReportById(user, id)
      if (!result.success) {
        return errorResponse(result.error ?? 'Report not found')
      }
      return jsonResponse(result)
    },
  )

  server.tool(
    'get_latest_metric',
    'Get the most recent value for any metric regardless of age. Useful for lab data that may be months old (e.g., "what was last body_fat?", "latest ferritin?").',
    { metric: z.string().min(1).max(50).describe('Metric name (built-in or custom)'), tz: tzSchema },
    async ({ metric, tz }) => {
      const result = await getLatestMetric(user, metric)
      return tzJsonResponse(result, tz)
    },
  )
}
