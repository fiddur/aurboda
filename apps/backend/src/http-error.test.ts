import { describe, expect, it } from 'vitest'

import { errorResponseBody, httpError, isDatabaseError, isHttpError } from './http-error.ts'

describe('httpError', () => {
  it('creates an Error with the given status and message', () => {
    const err = httpError(404, 'Not found')
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
  })

  it('has a stack trace', () => {
    const err = httpError(500, 'boom')
    expect(err.stack).toBeDefined()
  })
})

describe('isHttpError', () => {
  it('returns true for httpError instances', () => {
    expect(isHttpError(httpError(400, 'bad'))).toBe(true)
  })

  it('returns true for errors with a numeric status property', () => {
    const err = Object.assign(new Error('test'), { status: 401 })
    expect(isHttpError(err)).toBe(true)
  })

  it('returns false for plain Error without status', () => {
    expect(isHttpError(new Error('plain'))).toBe(false)
  })

  it('returns false for non-Error objects', () => {
    expect(isHttpError({ status: 400, message: 'not an error' })).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isHttpError(null)).toBe(false)
    expect(isHttpError(undefined)).toBe(false)
  })
})

const pgError = (message: string) =>
  Object.assign(new Error(message), { code: '22P02', routine: 'string_to_uuid', severity: 'ERROR' })

describe('isDatabaseError', () => {
  it('returns true for a pg-shaped error', () => {
    expect(isDatabaseError(pgError('invalid input syntax for type uuid: "null"'))).toBe(true)
  })

  it('returns false for a Node system error, which has a code but no severity', () => {
    expect(isDatabaseError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toBe(
      false,
    )
  })

  it('returns false for plain errors and non-errors', () => {
    expect(isDatabaseError(new Error('plain'))).toBe(false)
    expect(isDatabaseError({ code: '22P02', severity: 'ERROR' })).toBe(false)
  })
})

describe('errorResponseBody', () => {
  it('hides a database message behind a generic one', () => {
    expect(errorResponseBody(pgError('invalid input syntax for type uuid: "null"'), 500)).toEqual({
      error: 'Internal server error',
      success: false,
    })
  })

  it('keeps an HttpError message', () => {
    const err = httpError(404, 'Activity not found')
    expect(errorResponseBody(err, err.status)).toEqual({ error: 'Activity not found', success: false })
  })

  it('keeps a plain Error message', () => {
    expect(errorResponseBody(new Error('boom'), 500)).toEqual({ error: 'boom', success: false })
  })
})
