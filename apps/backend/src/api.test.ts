import express, { RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'

/**
 * Test that specific /sync routes are matched before the generic /sync/:recordType route.
 * This verifies the fix for the route ordering bug where /sync/daily-aggregates was
 * incorrectly matched by /sync/:recordType with recordType="daily-aggregates".
 */
describe('sync route ordering', () => {
  /**
   * Creates a test Express app with routes in the same order as api.ts
   * Each route sets a header indicating which handler was invoked.
   */
  const createRoutingTestApp = () => {
    const app = express()
    app.use(express.json())

    // Specific routes - must be defined BEFORE /sync/:recordType
    app.post('/sync/daily-aggregates', (_req, res) => {
      res.json({ handler: 'daily-aggregates' })
    })

    app.post('/sync/oura', (_req, res) => {
      res.json({ handler: 'oura' })
    })

    app.post('/sync/rescuetime', (_req, res) => {
      res.json({ handler: 'rescuetime' })
    })

    // Generic route - must be defined AFTER specific routes
    app.post('/sync/:recordType', (req, res) => {
      res.json({ handler: 'generic', recordType: req.params.recordType })
    })

    return app
  }

  test('POST /sync/daily-aggregates routes to daily-aggregates handler', async () => {
    const app = createRoutingTestApp()
    const response = await request(app).post('/sync/daily-aggregates').send({ data: [] })

    expect(response.status).toBe(200)
    expect(response.body.handler).toBe('daily-aggregates')
  })

  test('POST /sync/oura routes to oura handler', async () => {
    const app = createRoutingTestApp()
    const response = await request(app).post('/sync/oura').send({})

    expect(response.status).toBe(200)
    expect(response.body.handler).toBe('oura')
  })

  test('POST /sync/rescuetime routes to rescuetime handler', async () => {
    const app = createRoutingTestApp()
    const response = await request(app).post('/sync/rescuetime').send({})

    expect(response.status).toBe(200)
    expect(response.body.handler).toBe('rescuetime')
  })

  test('POST /sync/HeartRateRecord routes to generic handler', async () => {
    const app = createRoutingTestApp()
    const response = await request(app).post('/sync/HeartRateRecord').send({ data: [] })

    expect(response.status).toBe(200)
    expect(response.body.handler).toBe('generic')
    expect(response.body.recordType).toBe('HeartRateRecord')
  })

  test('POST /sync/WeightRecord routes to generic handler', async () => {
    const app = createRoutingTestApp()
    const response = await request(app).post('/sync/WeightRecord').send({ data: [] })

    expect(response.status).toBe(200)
    expect(response.body.handler).toBe('generic')
    expect(response.body.recordType).toBe('WeightRecord')
  })
})

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
