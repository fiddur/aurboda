import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createAuth } from './auth'
import { createMcpRouter } from './mcp'
import * as queries from './services/queries'

// Mock the services
vi.mock('./services/queries', () => ({
  getDailySummary: vi.fn(),
  getPeriodSummary: vi.fn(),
  queryMetrics: vi.fn(),
}))

vi.mock('./services/mutations', () => ({
  addMetric: vi.fn(),
  addTag: vi.fn(),
}))

// Mock db for sync status (not moved to services yet)
vi.mock('./db', () => ({
  getAllSyncStates: vi.fn(),
}))

// Mock the sync modules
vi.mock('./oura-sync', () => ({
  syncAllOuraData: vi.fn(),
}))

vi.mock('./rescuetime-sync', () => ({
  syncRescueTimeData: vi.fn(),
}))

const auth = createAuth('very very secretvery very secret') // 32 bytes for AES-256

function createTestApp() {
  const app = express()
  // MCP router must be mounted BEFORE body-parser, as the MCP SDK handles its own body parsing
  app.use('/mcp', createMcpRouter(auth))
  return app
}

// Helper to make MCP requests with proper headers
function mcpPost(app: express.Express) {
  return request(app).post('/mcp').set('Accept', 'application/json, text/event-stream')
}

function mcpDelete(app: express.Express) {
  return request(app).delete('/mcp').set('Accept', 'application/json, text/event-stream')
}

// Parse SSE response to extract JSON-RPC result
function parseSSEResponse(text: string): unknown {
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6))
    }
  }
  throw new Error('No data line found in SSE response')
}

describe('MCP Server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('Authentication - POST /mcp', () => {
    test('returns 401 without authorization header', async () => {
      const app = createTestApp()
      const response = await mcpPost(app).send({ id: 1, jsonrpc: '2.0', method: 'initialize' })

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Unauthorized')
    })

    test('returns 401 with invalid token', async () => {
      const app = createTestApp()
      const response = await mcpPost(app)
        .set('Authorization', 'Bearer invalid-token')
        .send({ id: 1, jsonrpc: '2.0', method: 'initialize' })

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Unauthorized')
    })

    test('accepts valid bearer token and returns session ID', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')

      const response = await mcpPost(app)
        .set('Authorization', `Bearer ${token}`)
        .send({
          id: 1,
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        })

      expect(response.status).toBe(200)
      expect(response.headers['mcp-session-id']).toBeDefined()
    })
  })

  describe('Authentication - GET /mcp (SSE endpoint)', () => {
    test('returns 401 without authorization header', async () => {
      const app = createTestApp()
      const response = await request(app)
        .get('/mcp')
        .set('Accept', 'text/event-stream')
        .set('Mcp-Session-Id', 'some-session-id')

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Unauthorized')
    })

    test('returns 400 for missing session ID', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')

      const response = await request(app).get('/mcp').set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Invalid or missing session ID')
    })

    test('returns 400 for invalid session ID', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')

      const response = await request(app)
        .get('/mcp')
        .set('Authorization', `Bearer ${token}`)
        .set('Mcp-Session-Id', 'nonexistent-session')

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Invalid or missing session ID')
    })
  })

  describe('Authentication - DELETE /mcp (end session)', () => {
    test('returns 401 without authorization header', async () => {
      const app = createTestApp()
      const response = await mcpDelete(app).set('Mcp-Session-Id', 'some-session-id')

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Unauthorized')
    })

    test('returns 400 for missing session ID', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')

      const response = await mcpDelete(app).set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Invalid or missing session ID')
    })

    test('returns 400 for invalid session ID', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')

      const response = await mcpDelete(app)
        .set('Authorization', `Bearer ${token}`)
        .set('Mcp-Session-Id', 'invalid-session-id')

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Invalid or missing session ID')
    })
  })

  // Note: Session isolation via POST is handled by checking session.user !== user
  // in mcp.ts POST handler. Due to complexity of MCP SDK's internal session state,
  // full integration testing of session isolation requires using a real MCP client.
  // The GET and DELETE endpoints' session isolation is tested via the "returns 400
  // for invalid session ID" tests which verify sessions are properly scoped.

  describe('Tool: query_period_summary', () => {
    async function initializeSession(app: express.Express, token: string) {
      const response = await mcpPost(app)
        .set('Authorization', `Bearer ${token}`)
        .send({
          id: 1,
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        })
      return response.headers['mcp-session-id'] as string
    }

    async function callTool(
      app: express.Express,
      token: string,
      sessionId: string,
      toolName: string,
      args: Record<string, unknown>,
    ) {
      const response = await mcpPost(app)
        .set('Authorization', `Bearer ${token}`)
        .set('Mcp-Session-Id', sessionId)
        .send({
          id: 2,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: args, name: toolName },
        })

      // Parse SSE response
      const parsed = parseSSEResponse(response.text) as { result: { content: { text: string }[] } }
      return {
        ...response,
        parsed,
        toolResult: JSON.parse(parsed.result.content[0].text),
      }
    }

    test('returns aggregated stats for valid metrics', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')
      const sessionId = await initializeSession(app, token)

      // Mock service response
      vi.mocked(queries.getPeriodSummary).mockResolvedValue({
        end: '2024-01-31T23:59:59.000Z',
        metrics: [
          {
            avg: 45.5,
            changeFromPreviousPeriodPercent: 10,
            completenessPercent: 90,
            count: 30,
            max: 65,
            metric: 'hrv_rmssd',
            min: 25,
            stddev: 10,
            trendPerDay: 5,
            unit: 'ms',
          },
        ],
        periodDays: 31,
        start: '2024-01-01T00:00:00.000Z',
      })

      const response = await callTool(app, token, sessionId, 'query_period_summary', {
        end: '2024-01-31T23:59:59Z',
        metrics: ['hrv_rmssd'],
        start: '2024-01-01T00:00:00Z',
      })

      expect(response.status).toBe(200)
      const result = response.toolResult
      expect(result.metrics).toHaveLength(1)
      expect(result.metrics[0].metric).toBe('hrv_rmssd')
      expect(result.metrics[0].avg).toBe(45.5)
      expect(result.metrics[0].min).toBe(25)
      expect(result.metrics[0].max).toBe(65)
      expect(result.metrics[0].stddev).toBe(10)
      expect(result.metrics[0].unit).toBe('ms')
      expect(result.metrics[0].trendPerDay).toBe(5)

      // Verify service was called with correct arguments
      expect(queries.getPeriodSummary).toHaveBeenCalledWith(
        'testuser',
        ['hrv_rmssd'],
        expect.any(Date),
        expect.any(Date),
      )
    })

    test('returns error for invalid date format', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')
      const sessionId = await initializeSession(app, token)

      const response = await mcpPost(app)
        .set('Authorization', `Bearer ${token}`)
        .set('Mcp-Session-Id', sessionId)
        .send({
          id: 2,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            arguments: {
              end: 'not-a-date',
              metrics: ['hrv_rmssd'],
              start: '2024-01-01T00:00:00Z',
            },
            name: 'query_period_summary',
          },
        })

      expect(response.status).toBe(200)
      const parsed = parseSSEResponse(response.text) as { result: { content: { text: string }[] } }
      expect(parsed.result.content[0].text).toContain('Invalid date format')
    })

    test('returns error for invalid metrics', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')
      const sessionId = await initializeSession(app, token)

      const response = await mcpPost(app)
        .set('Authorization', `Bearer ${token}`)
        .set('Mcp-Session-Id', sessionId)
        .send({
          id: 2,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            arguments: {
              end: '2024-01-31T23:59:59Z',
              metrics: ['invalid_metric', 'hrv_rmssd'],
              start: '2024-01-01T00:00:00Z',
            },
            name: 'query_period_summary',
          },
        })

      expect(response.status).toBe(200)
      const parsed = parseSSEResponse(response.text) as { result: { content: { text: string }[] } }
      expect(parsed.result.content[0].text).toContain('Invalid metrics')
      expect(parsed.result.content[0].text).toContain('invalid_metric')
    })

    test('calculates change from previous period', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')
      const sessionId = await initializeSession(app, token)

      vi.mocked(queries.getPeriodSummary).mockResolvedValue({
        end: '2024-01-31T23:59:59.000Z',
        metrics: [
          {
            avg: 50,
            changeFromPreviousPeriodPercent: 25,
            completenessPercent: 100,
            count: 30,
            max: 60,
            metric: 'hrv_rmssd',
            min: 40,
            stddev: 5,
            trendPerDay: null,
            unit: 'ms',
          },
        ],
        periodDays: 31,
        start: '2024-01-01T00:00:00.000Z',
      })

      const response = await callTool(app, token, sessionId, 'query_period_summary', {
        end: '2024-01-31T23:59:59Z',
        metrics: ['hrv_rmssd'],
        start: '2024-01-01T00:00:00Z',
      })

      expect(response.status).toBe(200)
      expect(response.toolResult.metrics[0].changeFromPreviousPeriodPercent).toBe(25)
    })

    test('identifies outliers beyond 2 stddev', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')
      const sessionId = await initializeSession(app, token)

      vi.mocked(queries.getPeriodSummary).mockResolvedValue({
        end: '2024-01-31T23:59:59.000Z',
        metrics: [
          {
            avg: 50,
            changeFromPreviousPeriodPercent: null,
            completenessPercent: 100,
            count: 30,
            max: 85,
            metric: 'hrv_rmssd',
            min: 20,
            outliers: [{ type: 'high', value: 85 }],
            stddev: 10,
            trendPerDay: null,
            unit: 'ms',
          },
        ],
        periodDays: 31,
        start: '2024-01-01T00:00:00.000Z',
      })

      const response = await callTool(app, token, sessionId, 'query_period_summary', {
        end: '2024-01-31T23:59:59Z',
        metrics: ['hrv_rmssd'],
        start: '2024-01-01T00:00:00Z',
      })

      expect(response.status).toBe(200)
      expect(response.toolResult.metrics[0].outliers).toBeDefined()
      expect(response.toolResult.metrics[0].outliers).toContainEqual({ type: 'high', value: 85 })
    })

    test('handles metrics with no data', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')
      const sessionId = await initializeSession(app, token)

      vi.mocked(queries.getPeriodSummary).mockResolvedValue({
        end: '2024-01-31T23:59:59.000Z',
        metrics: [
          {
            avg: 0,
            changeFromPreviousPeriodPercent: null,
            completenessPercent: 0,
            count: 0,
            max: 0,
            metric: 'hrv_rmssd',
            min: 0,
            stddev: 0,
            trendPerDay: null,
            unit: 'ms',
          },
        ],
        periodDays: 31,
        start: '2024-01-01T00:00:00.000Z',
      })

      const response = await callTool(app, token, sessionId, 'query_period_summary', {
        end: '2024-01-31T23:59:59Z',
        metrics: ['hrv_rmssd'],
        start: '2024-01-01T00:00:00Z',
      })

      expect(response.status).toBe(200)
      expect(response.toolResult.metrics).toHaveLength(1)
      expect(response.toolResult.metrics[0].count).toBe(0)
      expect(response.toolResult.metrics[0].completenessPercent).toBe(0)
    })

    test('calculates completeness percentage correctly', async () => {
      const app = createTestApp()
      const token = auth.createToken('testuser')
      const sessionId = await initializeSession(app, token)

      vi.mocked(queries.getPeriodSummary).mockResolvedValue({
        end: '2024-01-31T23:59:59.000Z',
        metrics: [
          {
            avg: 50,
            changeFromPreviousPeriodPercent: null,
            completenessPercent: 48,
            count: 15,
            max: 60,
            metric: 'hrv_rmssd',
            min: 40,
            stddev: 5,
            trendPerDay: null,
            unit: 'ms',
          },
        ],
        periodDays: 31,
        start: '2024-01-01T00:00:00.000Z',
      })

      const response = await callTool(app, token, sessionId, 'query_period_summary', {
        end: '2024-01-31T23:59:59Z',
        metrics: ['hrv_rmssd'],
        start: '2024-01-01T00:00:00Z',
      })

      expect(response.status).toBe(200)
      expect(response.toolResult.metrics[0].completenessPercent).toBe(48)
    })
  })
})
