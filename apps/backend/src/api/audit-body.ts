import type { Request } from 'express'

export type AuditBodyShape =
  | { type: 'object'; fields: number }
  | { type: 'array'; items: number }
  | { type: 'string' | 'number' | 'boolean' | 'null' }

const scalarType = (value: unknown): 'string' | 'number' | 'boolean' | 'null' | undefined => {
  if (value === null) return 'null'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number' || typeof value === 'bigint') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return undefined
}

/**
 * Audit `details` for a request body: its shape only, never a value or a key
 * name, so the audit log holds no copy of what the user wrote. A body-less
 * request reaches here as `undefined` or, from the JSON parser, `{}`.
 */
export const summarizeAuditBody = (body: unknown): { body: AuditBodyShape } | undefined => {
  if (Array.isArray(body)) return { body: { items: body.length, type: 'array' } }
  if (body !== null && typeof body === 'object') {
    const fields = Object.keys(body).length
    return fields === 0 ? undefined : { body: { fields, type: 'object' } }
  }
  const type = scalarType(body)
  return type === undefined ? undefined : { body: { type } }
}

export type AuditErrorType =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'rate_limited'
  | 'client_error'
  | 'server_error'

const ERROR_TYPES: Record<number, AuditErrorType> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  429: 'rate_limited',
}

export const auditErrorType = (status: number): AuditErrorType =>
  status >= 500 ? 'server_error' : (ERROR_TYPES[status] ?? 'client_error')

const routeTemplates = new WeakMap<Request, string>()

/**
 * Records `baseUrl + route.path` at the moment the router assigns `req.route`.
 * Read later, `req.baseUrl` is already reset when the request left its router
 * through `next(err)`, so the template has to be taken while routing.
 */
export const trackRouteTemplate = (req: Request): void => {
  let route: unknown = req.route
  Object.defineProperty(req, 'route', {
    configurable: true,
    enumerable: true,
    get: () => route,
    set: (value: unknown) => {
      route = value
      const path = (value as { path?: unknown } | undefined)?.path
      if (typeof path === 'string') routeTemplates.set(req, `${req.baseUrl}${path}`)
    },
  })
}

/** The audited operation: the method and the matched route template, never the path with its ids. */
export const auditOperation = (req: Request): string => {
  const tracked = routeTemplates.get(req)
  if (tracked !== undefined) return `${req.method} ${tracked}`
  const path = (req.route as { path?: unknown } | undefined)?.path
  return typeof path === 'string' ? `${req.method} ${req.baseUrl}${path}` : `${req.method} (no route)`
}

/** The audit entry for an error that reached the global handler; `err.message` is left out, since it can echo input. */
export const unhandledErrorAudit = (
  req: Request,
  err: Error,
  status: number,
): { message: string; details: Record<string, unknown> } => ({
  details: { error_name: err.name, error_type: auditErrorType(status), status },
  message: auditOperation(req),
})
