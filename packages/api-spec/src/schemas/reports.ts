/**
 * Reports group related lab measurements (InBody scans, blood panels, hair mineral analyses, etc.)
 * into structured containers with method/confidence metadata and reference ranges.
 */

import { z } from 'zod'

import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  createDataResponseSchema,
  iso8601DateTimeSchema,
} from './common.ts'

export const confidenceSchema = z.enum(['measured', 'estimated', 'derived']).meta({
  description: 'Confidence level: measured (direct), estimated (indirect), or derived (calculated)',
  id: 'Confidence',
})

export type Confidence = z.infer<typeof confidenceSchema>

export const reportFlagSchema = z.enum(['critical_low', 'low', 'normal', 'high', 'critical_high']).meta({
  description: 'Flag indicating where the value falls relative to its reference range',
  id: 'ReportFlag',
})

export type ReportFlag = z.infer<typeof reportFlagSchema>

export const reportEntrySchema = z
  .object({
    confidence: confidenceSchema.optional().meta({
      description: 'Confidence level of the measurement',
    }),
    flag: reportFlagSchema.optional().meta({
      description: 'Flag relative to reference range (auto-derived if not set)',
    }),
    id: z.string().uuid().optional().meta({ description: 'Entry ID' }),
    method: z.string().max(50).optional().meta({
      description: 'Measurement method (e.g., "bia_segmental", "blood_draw", "dexa")',
    }),
    metric: z.string().min(1).max(100).meta({
      description:
        'Metric name (e.g., "skeletal_muscle_mass", "ferritin"). A name, display name or alias from the built-in metric catalogue (GET /metric-catalog) resolves to the catalogue name, and the metric is added on first use',
    }),
    reference_high: z
      .number()
      .optional()
      .meta({ description: 'Upper bound of normal range, in the unit of the entry as given' }),
    reference_low: z
      .number()
      .optional()
      .meta({ description: 'Lower bound of normal range, in the unit of the entry as given' }),
    stored_unit: z.string().optional().meta({
      description:
        'The unit the value is stored in for the metric series; present when the value was converted for the metric series',
    }),
    stored_value: z.number().optional().meta({
      description:
        'The value as stored in the metric series; present when the value was converted for the metric series',
    }),
    unit: z.string().min(1).max(30).meta({
      description:
        'Unit of measurement as printed (e.g., "kg", "%", "ng/mL"). For a catalogue metric it is converted to the unit the metric is stored in, and refused when it cannot be converted',
    }),
    value: z.number().meta({ description: 'Measured value, as printed' }),
  })
  .meta({ description: 'A single measured or derived value within a lab report', id: 'ReportEntry' })

export type ReportEntry = z.infer<typeof reportEntrySchema>

export const reportSchema = z
  .object({
    created_at: iso8601DateTimeSchema.optional(),
    date: iso8601DateTimeSchema.meta({
      description: 'Date/time of the report (when the lab visit/scan occurred)',
    }),
    entries: z.array(reportEntrySchema).meta({ description: 'Measured values in this report' }),
    id: z.string().uuid().optional().meta({ description: 'Report ID' }),
    location: z
      .string()
      .max(255)
      .optional()
      .meta({ description: 'Where the test was performed (e.g., "Genki gym", "Lab name")' }),
    notes: z
      .string()
      .optional()
      .meta({ description: 'Contextual notes (e.g., "Fasted 12h", "Exercised before scan")' }),
    report_type: z
      .string()
      .min(1)
      .max(100)
      .meta({ description: 'Type of report (e.g., "inbody", "blood_panel", "hair_mineral_analysis")' }),
  })
  .meta({ description: 'A structured lab report grouping related measurements', id: 'Report' })

export type Report = z.infer<typeof reportSchema>

export const addReportBodySchema = z
  .object({
    date: iso8601DateTimeSchema.meta({ description: 'Date/time of the report' }),
    entries: z
      .array(reportEntrySchema.omit({ id: true, stored_unit: true, stored_value: true }))
      .min(1)
      .meta({
        description: 'Measured values (at least one entry required)',
      }),
    location: z.string().max(255).optional().meta({ description: 'Where the test was performed' }),
    notes: z.string().optional().meta({ description: 'Contextual notes' }),
    report_type: z
      .string()
      .min(1)
      .max(100)
      .meta({ description: 'Type of report (e.g., "inbody", "blood_panel")' }),
  })
  .meta({
    description: 'Create a new lab report with grouped measurements',
    id: 'AddReportBody',
  })

export type AddReportBody = z.infer<typeof addReportBodySchema>

/** When entries is provided, it fully replaces all existing entries. */
export const updateReportBodySchema = z
  .object({
    date: iso8601DateTimeSchema.optional().meta({ description: 'New date/time of the report' }),
    entries: z
      .array(reportEntrySchema.omit({ id: true, stored_unit: true, stored_value: true }))
      .min(1)
      .optional()
      .meta({
        description: 'Replacement entries (fully replaces all existing entries when provided)',
      }),
    location: z
      .string()
      .max(255)
      .optional()
      .nullable()
      .meta({ description: 'Where the test was performed (null to clear)' }),
    notes: z.string().optional().nullable().meta({ description: 'Contextual notes (null to clear)' }),
    report_type: z.string().min(1).max(100).optional().meta({ description: 'Type of report' }),
  })
  .meta({
    description: 'Update a lab report — metadata and/or entries',
    id: 'UpdateReportBody',
  })

export type UpdateReportBody = z.infer<typeof updateReportBodySchema>

export const reportsQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.optional().meta({ description: 'End date/time filter' }),
    report_type: z.string().optional().meta({ description: 'Filter by report type' }),
    start: iso8601DateTimeSchema.optional().meta({ description: 'Start date/time filter' }),
  })
  .meta({ description: 'Query parameters for listing reports', id: 'ReportsQuery' })

export type ReportsQuery = z.infer<typeof reportsQuerySchema>

export const reportResponseSchema = createDataResponseSchema(reportSchema).meta({
  id: 'ReportResponse',
})

export type ReportResponse = z.infer<typeof reportResponseSchema>

export const reportsResponseSchema = createDataArrayResponseSchema(reportSchema).meta({
  id: 'ReportsResponse',
})

export type ReportsResponse = z.infer<typeof reportsResponseSchema>

export const deleteReportResponseSchema = baseResponseSchema.meta({ id: 'DeleteReportResponse' })

export type DeleteReportResponse = z.infer<typeof deleteReportResponseSchema>

export const updateReportResponseSchema = createDataResponseSchema(reportSchema).meta({
  id: 'UpdateReportResponse',
})

export type UpdateReportResponse = z.infer<typeof updateReportResponseSchema>

export const REPORT_IMPORT_MAX_TEXT_LENGTH = 500_000
export const REPORT_IMPORT_MAX_ROWS = 5000

const columnIndexSchema = z.number().int().min(0).max(1000)

export const reportImportLayoutSchema = z.enum(['long', 'wide']).meta({
  description:
    'long: one row per result, with date, test and value columns. wide: one row per test and one column per date, the date in the header',
  id: 'ReportImportLayout',
})

export type ReportImportLayout = z.infer<typeof reportImportLayoutSchema>

export const reportImportDateOrderSchema = z.enum(['dmy', 'mdy']).meta({
  description: 'How to read an ambiguous date like 1/3/2026: dmy = 1 March, mdy = 3 January',
  id: 'ReportImportDateOrder',
})

export type ReportImportDateOrder = z.infer<typeof reportImportDateOrderSchema>

export const reportImportMappingSchema = z
  .object({
    date: columnIndexSchema.optional().meta({ description: 'long: index (from 0) of the date column' }),
    date_columns: z.array(columnIndexSchema).max(1000).optional().meta({
      description:
        'wide: indexes of the columns whose header is a date. When left out, every other column whose header reads as a date is one',
    }),
    date_order: reportImportDateOrderSchema.default('dmy'),
    has_header: z.boolean().default(true).meta({ description: 'Whether the first row holds column names' }),
    layout: reportImportLayoutSchema,
    metric: columnIndexSchema.meta({ description: 'Index (from 0) of the column holding the test name' }),
    reference_high: columnIndexSchema.optional().meta({ description: 'Index of the reference high column' }),
    reference_low: columnIndexSchema.optional().meta({ description: 'Index of the reference low column' }),
    reference_range: columnIndexSchema.optional().meta({
      description: 'Index of a column holding the whole reference range, like "3,5-5,0", "< 5" or "> 1,0"',
    }),
    unit: columnIndexSchema.optional().meta({
      description:
        'Index of the unit column. Without one, a result is taken to be in the unit its metric is stored in',
    }),
    value: columnIndexSchema.optional().meta({ description: 'long: index (from 0) of the value column' }),
  })
  .superRefine((mapping, ctx) => {
    if (mapping.layout !== 'long') return
    if (mapping.date === undefined) {
      ctx.addIssue({ code: 'custom', message: 'A long sheet needs a date column', path: ['date'] })
    }
    if (mapping.value === undefined) {
      ctx.addIssue({ code: 'custom', message: 'A long sheet needs a value column', path: ['value'] })
    }
  })
  .meta({
    description: 'Which spreadsheet column holds what, for importing lab reports (column indexes start at 0)',
    id: 'ReportImportMapping',
  })

export type ReportImportMapping = z.infer<typeof reportImportMappingSchema>

export const importReportsBodySchema = z
  .object({
    dry_run: z.boolean().default(false).meta({
      description: 'true returns the preview of what would be imported and writes nothing',
    }),
    location: z.string().max(255).optional().meta({ description: 'Where the tests were performed' }),
    mapping: reportImportMappingSchema,
    notes: z.string().optional().meta({ description: 'Contextual notes for the created reports' }),
    report_type: z
      .string()
      .min(1)
      .max(100)
      .meta({ description: 'Type of the created reports (e.g., "blood_panel")' }),
    text: z.string().min(1).max(REPORT_IMPORT_MAX_TEXT_LENGTH).meta({
      description:
        'The table as text: a paste from a spreadsheet (tab-separated) or a CSV file (semicolon or comma separated)',
    }),
  })
  .meta({
    description:
      'Import lab results from a spreadsheet table. One report per date; results already imported are skipped',
    id: 'ImportReportsBody',
  })

export type ImportReportsBody = z.infer<typeof importReportsBodySchema>

export const reportImportRowStatusSchema = z.enum(['new', 'exists', 'error', 'skipped']).meta({
  description:
    'new: will be (or was) imported. exists: a report on that date already has this metric. error: see error. skipped: a row without a test name',
  id: 'ReportImportRowStatus',
})

export type ReportImportRowStatus = z.infer<typeof reportImportRowStatusSchema>

export const reportImportRowSchema = z
  .object({
    column: z.number().int().optional().meta({ description: 'Column index of the cell (wide layout)' }),
    date: z.string().optional().meta({ description: 'Date of the result (YYYY-MM-DD)' }),
    error: z.string().optional().meta({ description: 'Why the row or cell is not imported' }),
    metric: z.string().optional().meta({ description: 'The test name as given' }),
    row: z.number().int().meta({ description: 'Row number in the table, counting from 1' }),
    status: reportImportRowStatusSchema,
    unit: z.string().optional(),
    value: z.number().optional(),
  })
  .meta({
    description: 'The outcome for one result (a row, or a cell of a wide sheet)',
    id: 'ReportImportRow',
  })

export type ReportImportRow = z.infer<typeof reportImportRowSchema>

export const reportImportSummarySchema = z
  .object({
    entries_existing: z.number().int().meta({ description: 'Results already imported (skipped)' }),
    entries_new: z.number().int().meta({ description: 'Results imported, or to be imported in a dry run' }),
    errors: z.number().int().meta({ description: 'Rows or cells that cannot be imported' }),
    reports_new: z.number().int().meta({ description: 'Reports created, or to be created' }),
    reports_updated: z.number().int().meta({ description: 'Existing reports results were added to' }),
  })
  .meta({ id: 'ReportImportSummary' })

export type ReportImportSummary = z.infer<typeof reportImportSummarySchema>

export const importReportsResultSchema = z
  .object({
    dry_run: z.boolean(),
    message: z.string().optional().meta({ description: 'Set when nothing was new to import' }),
    report_ids: z.array(z.string()).optional().meta({
      description: 'After a real run: the reports created or added to',
    }),
    rows: z.array(reportImportRowSchema).meta({
      description: 'Per result, errors first; capped (see rows_truncated) while the summary counts all',
    }),
    rows_truncated: z.boolean().meta({ description: 'Whether rows was cut short' }),
    summary: reportImportSummarySchema,
  })
  .meta({ id: 'ImportReportsResult' })

export type ImportReportsResult = z.infer<typeof importReportsResultSchema>

export const importReportsResponseSchema = createDataResponseSchema(importReportsResultSchema).meta({
  id: 'ImportReportsResponse',
})

export type ImportReportsResponse = z.infer<typeof importReportsResponseSchema>
