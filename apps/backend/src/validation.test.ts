import type { NextFunction, Request, Response } from 'express'

import { addActivityBodySchema, createSharedDashboardBodySchema } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { validateBody, validateQuery, validateQueryOneOf, validationErrors } from './validation.ts'

vi.mock('./services/audit-log.ts', () => ({
  auditWarn: vi.fn(),
}))

import { auditWarn } from './services/audit-log.ts'

// oxlint-disable-next-line typescript/no-explicit-any -- mock used across schemas
const createMockReq = (overrides: Partial<Request> = {}): Request<any, any, any, any> =>
  ({
    body: {},
    method: 'POST',
    path: '/test',
    query: {},
    ...overrides,
    // oxlint-disable-next-line typescript/no-explicit-any -- mock used across schemas
  }) as unknown as Request<any, any, any, any>

const createMockRes = () => {
  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  }
  return res as unknown as Response
}

const exactlyOneSchema = z
  .object({ a: z.string().optional(), b: z.string().optional() })
  .refine((v) => (v.a === undefined) !== (v.b === undefined), { message: 'Give exactly one of a or b' })

describe('validationErrors', () => {
  test('carries the message of a path-less refine under _errors', () => {
    const result = createSharedDashboardBodySchema.safeParse({ name: 'x' })
    if (result.success) throw new Error('expected the schema to reject a body without config or preset')

    expect(validationErrors(result.error)).toEqual({ _errors: ['Give exactly one of config or preset'] })
  })
})

describe('validateBody', () => {
  const schema = z.object({ name: z.string() })

  test('calls next on valid body', () => {
    const req = createMockReq({ body: { name: 'test' } })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateBody(schema)(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.body).toEqual({ name: 'test' })
  })

  test('trims surrounding whitespace from string values before parsing', () => {
    const req = createMockReq({
      body: {
        activity_type: 'running ',
        start_time: ' 2024-03-15T10:30:00Z',
        title: ' Morning  run ',
      },
    })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateBody(addActivityBodySchema)(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.body).toEqual(expect.objectContaining({ activity_type: 'running', title: 'Morning  run' }))
  })

  test('keeps a password exactly as sent', () => {
    const req = createMockReq({ body: { password: ' pass word ', username: ' fredrik ' } })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateBody(z.object({ password: z.string(), username: z.string() }))(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.body).toEqual({ password: ' pass word ', username: 'fredrik' })
  })

  test('returns 400 on invalid body', () => {
    const req = createMockReq({ body: { name: 123 } })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateBody(schema)(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
    expect(next).not.toHaveBeenCalled()
  })

  test('returns the message of a path-less refine under _errors', () => {
    const req = createMockReq({ body: { a: 'x', b: 'y' } })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateBody(exactlyOneSchema)(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: { _errors: ['Give exactly one of a or b'] },
      success: false,
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('returns field errors without an _errors key', () => {
    const req = createMockReq({ body: { name: 123 } })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateBody(schema)(req, res, next)

    expect(res.json).toHaveBeenCalledWith({ error: { name: [expect.any(String)] }, success: false })
  })

  test('logs to audit log for authenticated user on validation failure', () => {
    vi.mocked(auditWarn).mockClear()
    const req = createMockReq({ body: { name: 123 }, user: 'testuser' })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateBody(schema)(req, res, next)

    expect(auditWarn).toHaveBeenCalledWith(
      'testuser',
      'data',
      'Validation error: POST /test',
      expect.objectContaining({ errors: expect.any(Object) }),
    )
  })

  test('does not log to audit log for unauthenticated request', () => {
    vi.mocked(auditWarn).mockClear()
    const req = createMockReq({ body: { name: 123 } })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateBody(schema)(req, res, next)

    expect(auditWarn).not.toHaveBeenCalled()
  })
})

describe('validateQuery', () => {
  const schema = z.object({ page: z.coerce.number() })

  test('calls next on valid query', () => {
    const req = createMockReq({ query: { page: '1' } as unknown as Request['query'] })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateQuery(schema)(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('trims surrounding whitespace from query values', () => {
    const req = createMockReq({ query: { q: ' oat milk ' } as unknown as Request['query'] })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateQuery(z.object({ q: z.string() }))(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.query).toEqual({ q: 'oat milk' })
  })

  test('returns 400 on invalid query', () => {
    const req = createMockReq({ query: { page: 'abc' } as unknown as Request['query'] })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateQuery(schema)(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns the message of a path-less refine under _errors', () => {
    const req = createMockReq({ query: {} as unknown as Request['query'] })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateQuery(exactlyOneSchema)(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: { _errors: ['Give exactly one of a or b'] },
      success: false,
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('returns field errors without an _errors key', () => {
    const req = createMockReq({ query: { page: 'abc' } as unknown as Request['query'] })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateQuery(schema)(req, res, next)

    expect(res.json).toHaveBeenCalledWith({ error: { page: [expect.any(String)] }, success: false })
  })

  test('logs to audit log for authenticated user on validation failure', () => {
    vi.mocked(auditWarn).mockClear()
    const req = createMockReq({
      method: 'GET',
      path: '/metrics',
      query: { page: 'abc' } as unknown as Request['query'],
      user: 'testuser',
    })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateQuery(schema)(req, res, next)

    expect(auditWarn).toHaveBeenCalledWith(
      'testuser',
      'data',
      'Validation error: GET /metrics',
      expect.objectContaining({ errors: expect.any(Object) }),
    )
  })

  test('does not log to audit log for unauthenticated request', () => {
    vi.mocked(auditWarn).mockClear()
    const req = createMockReq({ query: { page: 'abc' } as unknown as Request['query'] })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateQuery(schema)(req, res, next)

    expect(auditWarn).not.toHaveBeenCalled()
  })
})

describe('validateQueryOneOf', () => {
  const rangeSchema = z.object({ from: z.string(), to: z.string() })
  const idSchema = z.object({ id: z.string() })
  const middleware = validateQueryOneOf((query) =>
    'from' in query || 'to' in query ? rangeSchema : idSchema,
  )

  test('validates with the schema the query selects and passes the parsed query on', () => {
    const req = createMockReq({ query: { from: 'a', to: 'b' } as unknown as Request['query'] })
    const next = vi.fn() as unknown as NextFunction

    middleware(req, createMockRes(), next)

    expect(next).toHaveBeenCalled()
    expect(req.query).toEqual({ from: 'a', to: 'b' })
  })

  test('reports the errors of the selected schema only', () => {
    const req = createMockReq({ query: { from: 'a', id: 'x' } as unknown as Request['query'] })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: { to: [expect.any(String)] }, success: false })
    expect(next).not.toHaveBeenCalled()
  })

  test('falls through to the other schema when the selector picks it', () => {
    const req = createMockReq({ query: { id: 'x' } as unknown as Request['query'] })
    const next = vi.fn() as unknown as NextFunction

    middleware(req, createMockRes(), next)

    expect(next).toHaveBeenCalled()
    expect(req.query).toEqual({ id: 'x' })
  })
})
