/**
 * Uses Object.assign rather than a class to align with the project's functional style.
 */

export interface HttpError extends Error {
  status: number
}

export const httpError = (status: number, message: string): HttpError =>
  Object.assign(new Error(message), { status })

export const isHttpError = (err: unknown): err is HttpError =>
  err instanceof Error && typeof (err as HttpError).status === 'number'

export interface DatabaseErrorLike extends Error {
  code: string
  severity: string
}

export const isDatabaseError = (err: unknown): err is DatabaseErrorLike =>
  err instanceof Error &&
  typeof (err as DatabaseErrorLike).severity === 'string' &&
  typeof (err as DatabaseErrorLike).code === 'string'

/** A 5xx must not echo a Postgres message: it can name columns, types and the offending input. */
export const errorResponseBody = (err: Error, status: number): { error: string; success: false } => ({
  error: status >= 500 && isDatabaseError(err) ? 'Internal server error' : err.message,
  success: false,
})
