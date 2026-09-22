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
