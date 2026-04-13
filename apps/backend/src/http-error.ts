/**
 * HTTP error utilities for centralized error handling.
 *
 * Provides a factory function and type guard for errors with HTTP status codes.
 * Uses Object.assign rather than a class to align with the project's functional style.
 */

export interface HttpError extends Error {
  status: number
}

/** Create an Error with an HTTP status code attached. */
export const httpError = (status: number, message: string): HttpError =>
  Object.assign(new Error(message), { status })

/** Type guard: does this error carry an HTTP status code? */
export const isHttpError = (err: unknown): err is HttpError =>
  err instanceof Error && typeof (err as HttpError).status === 'number'
