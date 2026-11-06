import type { Request, Response } from 'express'

import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'

import { createUsageMiddleware } from './usage-middleware.ts'

const run = ({
  headers = { 'user-agent': 'Mozilla/5.0' },
  method = 'GET',
  originalUrl = '/activities',
  statusCode = 200,
  user = 'alice',
}: {
  headers?: Record<string, string>
  method?: string
  originalUrl?: string
  statusCode?: number
  user?: string | null
} = {}) => {
  const recordUsage = vi.fn()
  const req = { headers, method, originalUrl } as unknown as Request
  const res = Object.assign(new EventEmitter(), { statusCode }) as unknown as Response
  const next = vi.fn()

  createUsageMiddleware(recordUsage)(req, res, next)
  // authMiddleware sets the user later in the chain, before the response finishes.
  req.user = user ?? undefined
  res.emit('finish')

  return { next, recordUsage }
}

describe('createUsageMiddleware', () => {
  test('counts a successful GET as a read', () => {
    const { next, recordUsage } = run()
    expect(next).toHaveBeenCalledOnce()
    expect(recordUsage).toHaveBeenCalledWith('alice', 'read', 'web')
  })

  test('counts HEAD as a read', () => {
    expect(run({ method: 'HEAD' }).recordUsage).toHaveBeenCalledWith('alice', 'read', 'web')
  })

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('counts a successful %s as a write', (method) => {
    expect(run({ headers: { 'user-agent': 'okhttp/4' }, method }).recordUsage).toHaveBeenCalledWith(
      'alice',
      'write',
      'android',
    )
  })

  test('classifies the client from the headers', () => {
    expect(run({ headers: { 'user-agent': 'curl/8.0' } }).recordUsage).toHaveBeenCalledWith(
      'alice',
      'read',
      'api',
    )
  })

  test('does not count a failed request', () => {
    expect(run({ statusCode: 404 }).recordUsage).not.toHaveBeenCalled()
    expect(run({ statusCode: 500 }).recordUsage).not.toHaveBeenCalled()
  })

  test('does not count an unauthenticated request', () => {
    expect(run({ user: null }).recordUsage).not.toHaveBeenCalled()
  })

  test('skips OPTIONS and MCP, which its own router counts', () => {
    expect(run({ method: 'OPTIONS' }).recordUsage).not.toHaveBeenCalled()
    expect(run({ method: 'POST', originalUrl: '/mcp' }).recordUsage).not.toHaveBeenCalled()
    expect(run({ method: 'POST', originalUrl: '/mcp?x=1' }).recordUsage).not.toHaveBeenCalled()
  })
})
