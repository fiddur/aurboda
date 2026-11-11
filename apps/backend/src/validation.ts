import type { Request, RequestHandler } from 'express'
import type { ParamsDictionary } from 'express-serve-static-core'
import type { z } from 'zod'

import { auditWarn } from './services/audit-log.ts'
import { trimStrings } from './trim-input.ts'

/**
 * Field errors keyed by field, plus object-level messages (a `.refine` without a `path`) under
 * `_errors`, which `flatten().fieldErrors` alone would drop.
 */
export const validationErrors = (error: z.ZodError): Record<string, string[]> => {
  const { fieldErrors, formErrors } = error.flatten()
  return formErrors.length > 0 ? { ...fieldErrors, _errors: formErrors } : { ...fieldErrors }
}

/**
 * Returns 400 with detailed validation errors on failure.
 * Logs to audit log for authenticated users.
 *
 * Returns a handler typed with the schema's output as ReqBody so downstream
 * handlers in the chain see the coerced type (not the raw `unknown`).
 */
export const validateBody =
  // oxlint-disable-next-line typescript/no-explicit-any -- query/params unconstrained
  <T extends z.ZodTypeAny>(schema: T): RequestHandler<ParamsDictionary, any, z.infer<T>, any> =>
    (req, res, next) => {
      const result = schema.safeParse(trimStrings(req.body))
      if (!result.success) {
        const errors = validationErrors(result.error)
        if (req.user) {
          auditWarn(req.user, 'data', `Validation error: ${req.method} ${req.path}`, { errors })
        }
        res.status(400).json({ error: errors, success: false })
        return
      }
      req.body = result.data
      next()
    }

/**
 * `validateQuery` for a route whose query comes in more than one shape: `select` picks the
 * schema from the raw query (e.g. by which params are present), and that schema alone
 * validates it, so its errors are the ones reported. The handler sees the union of the outputs.
 */
export const validateQueryOneOf =
  <T extends z.ZodTypeAny>(
    select: (query: Request['query']) => T,
    // oxlint-disable-next-line typescript/no-explicit-any -- params/body unconstrained
  ): RequestHandler<ParamsDictionary, any, any, z.infer<T>> =>
  (req, res, next) => {
    const result = select(req.query as Request['query']).safeParse(trimStrings(req.query))
    if (!result.success) {
      const errors = validationErrors(result.error)
      if (req.user) {
        auditWarn(req.user, 'data', `Validation error: ${req.method} ${req.path}`, { errors })
      }
      res.status(400).json({ error: errors, success: false })
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

/**
 * Returns 400 with detailed validation errors on failure.
 * Logs to audit log for authenticated users.
 *
 * Returns a handler typed with the schema's output as ReqQuery so downstream
 * handlers in the chain see the coerced type (not the raw `ParsedQs`).
 */
export const validateQuery = <T extends z.ZodTypeAny>(
  schema: T,
  // oxlint-disable-next-line typescript/no-explicit-any -- params/body unconstrained
): RequestHandler<ParamsDictionary, any, any, z.infer<T>> => validateQueryOneOf(() => schema)
