import type { NextFunction, Request, Response } from 'express'
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { validateBody, validateQuery } from './validation.ts'

vi.mock('./services/audit-log.ts', () => ({
  auditWarn: vi.fn(),
}))

import { auditWarn } from './services/audit-log.ts'

const createMockReq = (overrides: Partial<Request> = {}) =>
  ({
    body: {},
    method: 'POST',
    path: '/test',
    query: {},
    ...overrides,
  }) as unknown as Request

const createMockRes = () => {
  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  }
  return res as unknown as Response
}

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

  test('returns 400 on invalid body', () => {
    const req = createMockReq({ body: { name: 123 } })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateBody(schema)(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    )
    expect(next).not.toHaveBeenCalled()
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

  test('returns 400 on invalid query', () => {
    const req = createMockReq({ query: { page: 'abc' } as unknown as Request['query'] })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    validateQuery(schema)(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(next).not.toHaveBeenCalled()
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
