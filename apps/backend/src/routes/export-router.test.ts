import type { Writable } from 'node:stream'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { DumpExporter } from '../services/export-dump.ts'

import { createDumpLinkIssuer } from '../services/export-dump.ts'
import { createExportTokens } from '../services/export-token.ts'
import { createExportRouter } from './export-router.ts'

const SECRET = '0123456789abcdef0123456789abcdef'
const NOW = new Date('2026-11-06T12:00:00Z')

const okExporter = (body = 'dump-bytes'): DumpExporter & { runs: number } => {
  const exporter = {
    check: async () => ({ ok: true }) as const,
    runs: 0,
    start: async () => ({
      ok: true as const,
      run: async (out: Writable) => {
        exporter.runs += 1
        await new Promise<void>((resolve) => out.end(body, resolve))
        return { bytes: body.length }
      },
    }),
  }
  return exporter
}

const buildApp = (exporter: DumpExporter, now = () => NOW) => {
  const tokens = createExportTokens(SECRET)
  const app = express()
  app.use(express.json())
  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization !== 'Bearer good') {
      res.status(401).json({ error: 'Unauthorized', success: false })
      return
    }
    req.user = 'alice'
    next()
  }
  const requestDumpLink = createDumpLinkIssuer({ apiBaseUrl: 'http://api.test', exporter, tokens })
  app.use('/export', createExportRouter({ authMiddleware, exporter, now, requestDumpLink, tokens }))
  return { app, tokens }
}

const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!

describe('POST /export/dump-link', () => {
  test('needs the bearer token', async () => {
    const { app } = buildApp(okExporter())
    expect((await supertest(app).post('/export/dump-link')).status).toBe(401)
  })

  test('returns an absolute URL carrying a token, and its expiry', async () => {
    const { app, tokens } = buildApp(okExporter())
    const res = await supertest(app).post('/export/dump-link').set('Authorization', 'Bearer good')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.url).toMatch(/^http:\/\/api\.test\/export\/dump\?token=/)
    expect(tokens.verifyExportToken(tokenFrom(res.body.url))?.user).toBe('alice')
    expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  test('passes on a failed check', async () => {
    const exporter: DumpExporter = {
      check: async () => ({ error: 'An export is already running', ok: false, status: 409 }),
      start: async () => ({ error: 'An export is already running', ok: false, status: 409 }),
    }
    const { app } = buildApp(exporter)
    const res = await supertest(app).post('/export/dump-link').set('Authorization', 'Bearer good')
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'An export is already running', success: false })
  })
})

describe('GET /export/dump', () => {
  test('streams the dump as an attachment without a bearer token', async () => {
    const exporter = okExporter()
    const { app, tokens } = buildApp(exporter)
    const { token } = tokens.createExportToken('alice', 600, NOW)

    const res = await supertest(app)
      .get('/export/dump')
      .query({ token })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/gzip')
    expect(res.headers['content-disposition']).toBe('attachment; filename="aurboda-alice-2026-11-06.sql.gz"')
    expect(res.headers['cache-control']).toBe('no-store')
    expect((res.body as Buffer).toString()).toBe('dump-bytes')
  })

  test('a completed download spends the token', async () => {
    const exporter = okExporter()
    const { app, tokens } = buildApp(exporter)
    const { token } = tokens.createExportToken('alice', 600, NOW)

    expect((await supertest(app).get('/export/dump').query({ token })).status).toBe(200)
    expect((await supertest(app).get('/export/dump').query({ token })).status).toBe(401)
    expect(exporter.runs).toBe(1)
  })

  test('rejects a bad token with 401', async () => {
    const { app } = buildApp(okExporter())
    const res = await supertest(app).get('/export/dump').query({ token: 'garbage' })
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  test('rejects an expired token with 401', async () => {
    const exporter = okExporter()
    const { app, tokens } = buildApp(exporter, () => new Date(Date.now() + 3600_000))
    const { token } = tokens.createExportToken('alice', 600)
    expect((await supertest(app).get('/export/dump').query({ token })).status).toBe(401)
    expect(exporter.runs).toBe(0)
  })

  test('answers 409 while an export is already running', async () => {
    const exporter: DumpExporter = {
      check: async () => ({ ok: true }),
      start: async () => ({ error: 'An export is already running', ok: false, status: 409 }),
    }
    const { app, tokens } = buildApp(exporter)
    const { token } = tokens.createExportToken('alice', 600, NOW)
    const res = await supertest(app).get('/export/dump').query({ token })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('An export is already running')
  })
})
