/**
 * Lab report schemas.
 *
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

// ============================================================================
// Enums
// ============================================================================

/**
 * Confidence level of a measurement.
 */
export const confidenceSchema = z.enum(['measured', 'estimated', 'derived']).meta({
  description: 'Confidence level: measured (direct), estimated (indirect), or derived (calculated)',
  id: 'Confidence',
})

export type Confidence = z.infer<typeof confidenceSchema>

/**
 * Flag indicating where a value falls relative to its reference range.
 */
export const reportFlagSchema = z.enum(['critical_low', 'low', 'normal', 'high', 'critical_high']).meta({
  description: 'Flag indicating where the value falls relative to its reference range',
  id: 'ReportFlag',
})

export type ReportFlag = z.infer<typeof reportFlagSchema>

// ============================================================================
// Report Entry
// ============================================================================

/**
 * A single entry within a report — one measured/derived value.
 */
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
    metric: z
      .string()
      .min(1)
      .max(100)
      .meta({ description: 'Metric name (e.g., "skeletal_muscle_mass", "ferritin")' }),
    reference_high: z.number().optional().meta({ description: 'Upper bound of normal range' }),
    reference_low: z.number().optional().meta({ description: 'Lower bound of normal range' }),
    unit: z.string().min(1).max(30).meta({ description: 'Unit of measurement (e.g., "kg", "%", "ng/mL")' }),
    value: z.number().meta({ description: 'Measured value' }),
  })
  .meta({ description: 'A single measured or derived value within a lab report', id: 'ReportEntry' })

export type ReportEntry = z.infer<typeof reportEntrySchema>

// ============================================================================
// Report
// ============================================================================

/**
 * A lab report containing grouped entries from a single lab visit or scan.
 */
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

// ============================================================================
// Request Schemas
// ============================================================================

/**
 * Add report request body.
 */
export const addReportBodySchema = z
  .object({
    date: iso8601DateTimeSchema.meta({ description: 'Date/time of the report' }),
    entries: z
      .array(reportEntrySchema.omit({ id: true }))
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

/**
 * Update report request body — all fields optional (PATCH semantics).
 * When entries is provided, it fully replaces all existing entries.
 */
export const updateReportBodySchema = z
  .object({
    date: iso8601DateTimeSchema.optional().meta({ description: 'New date/time of the report' }),
    entries: z
      .array(reportEntrySchema.omit({ id: true }))
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

/**
 * Reports query schema — filter by type and/or date range.
 */
export const reportsQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.optional().meta({ description: 'End date/time filter' }),
    report_type: z.string().optional().meta({ description: 'Filter by report type' }),
    start: iso8601DateTimeSchema.optional().meta({ description: 'Start date/time filter' }),
  })
  .meta({ description: 'Query parameters for listing reports', id: 'ReportsQuery' })

export type ReportsQuery = z.infer<typeof reportsQuerySchema>

// ============================================================================
// Response Schemas
// ============================================================================

/**
 * Single report response.
 */
export const reportResponseSchema = createDataResponseSchema(reportSchema).meta({
  id: 'ReportResponse',
})

export type ReportResponse = z.infer<typeof reportResponseSchema>

/**
 * Multiple reports response.
 */
export const reportsResponseSchema = createDataArrayResponseSchema(reportSchema).meta({
  id: 'ReportsResponse',
})

export type ReportsResponse = z.infer<typeof reportsResponseSchema>

/**
 * Delete report response.
 */
export const deleteReportResponseSchema = baseResponseSchema.meta({ id: 'DeleteReportResponse' })

export type DeleteReportResponse = z.infer<typeof deleteReportResponseSchema>

/**
 * Update report response.
 */
export const updateReportResponseSchema = createDataResponseSchema(reportSchema).meta({
  id: 'UpdateReportResponse',
})

export type UpdateReportResponse = z.infer<typeof updateReportResponseSchema>
