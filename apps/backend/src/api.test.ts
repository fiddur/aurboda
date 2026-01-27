import express, { RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'

/**
 * Create a validation middleware for query parameters using a Zod schema.
 * This is extracted from api.ts for testing purposes.
 */
const validateQuery =
  <T extends z.ZodTypeAny>(schema: T): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      res.status(400).json({
        error: result.error.flatten().fieldErrors,
        success: false,
      })
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

describe('validateQuery middleware', () => {
  const testSchema = z.object({
    count: z.coerce.number().optional(),
    end: z.string(),
    start: z.string(),
  })

  function createTestApp() {
    const app = express()
    app.get('/test', validateQuery(testSchema), (req, res) => {
      // Access req.query after validation - this should work without throwing
      const { start, end, count } = req.query as unknown as z.infer<typeof testSchema>
      res.json({ count, end, start, success: true })
    })
    return app
  }

  test('validates and transforms query parameters', async () => {
    const app = createTestApp()
    const response = await request(app)
      .get('/test')
      .query({ count: '10', end: '2024-01-31', start: '2024-01-01' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      count: 10, // coerced to number
      end: '2024-01-31',
      start: '2024-01-01',
      success: true,
    })
  })

  test('returns 400 for missing required parameters', async () => {
    const app = createTestApp()
    const response = await request(app).get('/test').query({ start: '2024-01-01' }) // missing 'end'

    expect(response.status).toBe(400)
    expect(response.body.success).toBe(false)
    expect(response.body.error).toHaveProperty('end')
  })

  test('allows optional parameters to be omitted', async () => {
    const app = createTestApp()
    const response = await request(app).get('/test').query({ end: '2024-01-31', start: '2024-01-01' }) // 'count' is optional

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      count: undefined,
      end: '2024-01-31',
      start: '2024-01-01',
      success: true,
    })
  })

  test('req.query is accessible after validation middleware', async () => {
    // This test specifically verifies the Object.defineProperty fix works
    const app = express()
    let capturedQuery: unknown = null

    app.get('/capture', validateQuery(testSchema), (req, res) => {
      capturedQuery = req.query
      res.json({ captured: true })
    })

    await request(app).get('/capture').query({ end: '2024-01-31', start: '2024-01-01' })

    expect(capturedQuery).toEqual({
      end: '2024-01-31',
      start: '2024-01-01',
    })
  })
})
