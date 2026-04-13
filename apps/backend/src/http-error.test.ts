import { describe, expect, it } from 'vitest'

import { httpError, isHttpError } from './http-error.ts'

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
