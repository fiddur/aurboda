/**
 * Reports route group.
 *
 * Handles: /reports/*
 */
import {
  type AddReportBody,
  addReportBodySchema,
  type DeleteReportResponse,
  type ReportResponse,
  type ReportsQuery,
  reportsQuerySchema,
  type ReportsResponse,
} from '@aurboda/api-spec'
import { type RequestHandler, Router } from 'express'

import { addReport, deleteReportById, getReport, queryReports } from '../services/reports.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createReportsRouter = (authMiddleware: RequestHandler): Router => {
  const router = Router()

  // GET /reports - Query reports with optional filters
  router.get<Record<string, never>, ReportsResponse, unknown, ReportsQuery>(
    '/',
    authMiddleware,
    validateQuery(reportsQuerySchema),
    async (req, res) => {
      const { report_type, start, end } = req.query
      const user = req.user!

      const result = await queryReports(user, { end, report_type, start })
      res.json({ data: result.data, success: true })
    },
  )

  // GET /reports/:id - Get a single report
  router.get<{ id: string }, ReportResponse>('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await getReport(user, id)

    if (!result.success) {
      return res.status(404).json({ error: result.error, success: false })
    }

    res.json({ data: result.data, success: true })
  })

  // POST /reports - Create a new report
  router.post<Record<string, never>, ReportResponse, AddReportBody>(
    '/',
    authMiddleware,
    validateBody(addReportBodySchema),
    async (req, res) => {
      const user = req.user!

      const result = await addReport(user, {
        date: req.body.date,
        entries: req.body.entries,
        location: req.body.location,
        notes: req.body.notes,
        report_type: req.body.report_type,
      })

      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }

      res.json({ data: result.data, success: true })
    },
  )

  // DELETE /reports/:id - Delete a report
  router.delete<{ id: string }, DeleteReportResponse>('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await deleteReportById(user, id)

    if (!result.success) {
      return res.status(404).json({ error: result.error, success: false })
    }

    res.json({ success: true })
  })

  return router
}
