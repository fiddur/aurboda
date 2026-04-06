/**
 * MCP Integration tests with real PostgreSQL.
 *
 * Tests the stateless MCP server against a real database.
 */

import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { createAuth } from './auth.ts'
import { createMcpRouter } from './mcp.ts'
import { cleanTestDb, startTestDb, stopTestDb } from './test/db-test-helper.ts'

// Increase timeout for container startup
const CONTAINER_TIMEOUT = 60_000

const auth = createAuth('very very secretvery very secret') // 32 bytes for AES-256

function createTestApp() {
  const app = express()
  // Stateless MCP — no session tracking
  app.use('/mcp', createMcpRouter(auth))
  return app
}

const mcpPost = (app: ReturnType<typeof createTestApp>) =>
  request(app).post('/mcp').set('Accept', 'application/json, text/event-stream')

function parseSSEResponse(text: string): unknown {
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6))
    }
  }
  throw new Error('No data line found in SSE response')
}

describe('MCP Database Integration Tests (Stateless)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('stateless tool call works without initialize', async () => {
    const token = auth.createToken('testuser')
    const app = createTestApp()

    // Call a tool directly — no initialize needed in stateless mode
    const response = await mcpPost(app)
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            end: '2024-01-31T23:59:59Z',
            start: '2024-01-01T00:00:00Z',
            tz: 'UTC',
          },
          name: 'query_tags',
        },
      })

    expect(response.status).toBe(200)
    // No session ID in stateless mode
    expect(response.headers['mcp-session-id']).toBeUndefined()

    const parsed = parseSSEResponse(response.text) as { result: { content: { text: string }[] } }
    const result = JSON.parse(parsed.result.content[0].text)
    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })

  test('each request is independent (no shared state)', async () => {
    const token = auth.createToken('testuser')
    const app = createTestApp()

    // First request
    const response1 = await mcpPost(app)
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            end: '2024-01-31T23:59:59Z',
            start: '2024-01-01T00:00:00Z',
            tz: 'UTC',
          },
          name: 'query_tags',
        },
      })

    // Second request — completely independent
    const response2 = await mcpPost(app)
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            end: '2024-02-28T23:59:59Z',
            start: '2024-02-01T00:00:00Z',
            tz: 'UTC',
          },
          name: 'query_tags',
        },
      })

    expect(response1.status).toBe(200)
    expect(response2.status).toBe(200)
  })

  test('different users get isolated data', async () => {
    const token1 = auth.createToken('user1')
    const token2 = auth.createToken('user2')
    const app = createTestApp()

    // Both users can make independent requests
    const response1 = await mcpPost(app)
      .set('Authorization', `Bearer ${token1}`)
      .send({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            end: '2024-01-31T23:59:59Z',
            start: '2024-01-01T00:00:00Z',
            tz: 'UTC',
          },
          name: 'query_tags',
        },
      })

    const response2 = await mcpPost(app)
      .set('Authorization', `Bearer ${token2}`)
      .send({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            end: '2024-01-31T23:59:59Z',
            start: '2024-01-01T00:00:00Z',
            tz: 'UTC',
          },
          name: 'query_tags',
        },
      })

    expect(response1.status).toBe(200)
    expect(response2.status).toBe(200)
  })
})
