/**
 * Validation middleware for Express routes using Zod schemas.
 */

import type { RequestHandler } from 'express'
import type { z } from 'zod'

import { auditWarn } from './services/audit-log.ts'

/**
 * Create a validation middleware for request body using a Zod schema.
 * Returns 400 with detailed validation errors on failure.
 * Logs to audit log for authenticated users.
 */
export const validateBody =
  <T extends z.ZodTypeAny>(schema: T): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors
      if (req.user) {
        auditWarn(req.user, 'data', `Validation error: ${req.method} ${req.path}`, {
          errors: fieldErrors,
        })
      }
      res.status(400).json({
        error: fieldErrors,
        success: false,
      })
      return
    }
    req.body = result.data
    next()
  }

/**
 * Create a validation middleware for query parameters using a Zod schema.
 * Returns 400 with detailed validation errors on failure.
 * Logs to audit log for authenticated users.
 */
export const validateQuery =
  <T extends z.ZodTypeAny>(schema: T): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors
      if (req.user) {
        auditWarn(req.user, 'data', `Validation error: ${req.method} ${req.path}`, {
          errors: fieldErrors,
        })
      }
      res.status(400).json({
        error: fieldErrors,
        success: false,
      })
      return
    }
    // Use Object.defineProperty since req.query may be a getter-only property
    Object.defineProperty(req, 'query', {
      configurable: true,
      value: result.data,
      writable: true,
    })
    next()
  }
