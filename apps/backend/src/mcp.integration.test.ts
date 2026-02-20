/**
 * MCP Integration tests with real PostgreSQL.
 *
 * Tests the full MCP session persistence flow using a real database.
 */

import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createAuth } from './auth'
import { createMcpRouter } from './mcp'
import { createDbSessionStore } from './mcp-session-store'
import { cleanTestDb, startTestDb, stopTestDb } from './test/db-test-helper'

// Increase timeout for container startup
const CONTAINER_TIMEOUT = 60_000

const auth = createAuth('very very secretvery very secret') // 32 bytes for AES-256

function createTestApp() {
  const app = express()
  // Use database-backed session store
  const sessionStore = createDbSessionStore()
  app.use('/mcp', createMcpRouter(auth, undefined, undefined, { sessionStore }))
  return app
}

const mcpPost = (app: ReturnType<typeof createTestApp>) =>
  request(app).post('/mcp').set('Accept', 'application/json, text/event-stream')

describe('MCP Database Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('session persists in database and survives app restart', async () => {
    const token = auth.createToken('testuser')

    // Create first app instance
    const app1 = createTestApp()

    // Initialize a session
    const initResponse = await mcpPost(app1)
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

    expect(initResponse.status).toBe(200)
    const sessionId = initResponse.headers['mcp-session-id'] as string
    expect(sessionId).toBeDefined()
    console.log('Got session ID:', sessionId)

    // Simulate restart by creating a new app instance
    // This creates a fresh in-memory sessions map but uses the same database
    const app2 = createTestApp()

    // Try to use the same session ID on the new app instance
    const response = await mcpPost(app2)
      .set('Authorization', `Bearer ${token}`)
      .set('Mcp-Session-Id', sessionId)
      .send({
        id: 2,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
          protocolVersion: '2024-11-05',
        },
      })

    expect(response.status).toBe(200)
    // The session ID should be preserved
    expect(response.headers['mcp-session-id']).toBe(sessionId)
  })

  test('session is saved to database on creation', async () => {
    const token = auth.createToken('testuser')
    const app = createTestApp()

    const initResponse = await mcpPost(app)
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

    expect(initResponse.status).toBe(200)
    const sessionId = initResponse.headers['mcp-session-id'] as string

    // Verify session was saved to database by creating a new app and restoring
    const app2 = createTestApp()

    // After restart, we need to re-initialize (but the session ID is preserved)
    const response = await mcpPost(app2)
      .set('Authorization', `Bearer ${token}`)
      .set('Mcp-Session-Id', sessionId)
      .send({
        id: 2,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
          protocolVersion: '2024-11-05',
        },
      })

    // If the session was restored, we should get a 200 response with the same session ID
    expect(response.status).toBe(200)
    expect(response.headers['mcp-session-id']).toBe(sessionId)
  })

  test('session for different user cannot be restored', async () => {
    const token1 = auth.createToken('user1')
    const token2 = auth.createToken('user2')

    const app1 = createTestApp()

    // Create session for user1
    const initResponse = await mcpPost(app1)
      .set('Authorization', `Bearer ${token1}`)
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

    const sessionId = initResponse.headers['mcp-session-id'] as string

    // Create new app instance and try to use user1's session as user2
    const app2 = createTestApp()

    const response = await mcpPost(app2)
      .set('Authorization', `Bearer ${token2}`)
      .set('Mcp-Session-Id', sessionId)
      .send({
        id: 2,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
          protocolVersion: '2024-11-05',
        },
      })

    // Should get a 200 response but with a NEW session ID (not the old one)
    expect(response.status).toBe(200)
    expect(response.headers['mcp-session-id']).not.toBe(sessionId)
  })
})
