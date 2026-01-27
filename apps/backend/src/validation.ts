/**
 * Validation middleware for Express routes using Zod schemas.
 */

import type { RequestHandler } from 'express'
import { z } from 'zod'

/**
 * Create a validation middleware for request body using a Zod schema.
 * Returns 400 with detailed validation errors on failure.
 */
export const validateBody =
  <T extends z.ZodTypeAny>(schema: T): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({
        error: result.error.flatten().fieldErrors,
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
 * The validated data is assigned back to req.query; route generics provide typing.
 */
export const validateQuery =
  <T extends z.ZodTypeAny>(schema: T): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      res.status(400).json({
        error: result.error.flatten().fieldErrors,
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
