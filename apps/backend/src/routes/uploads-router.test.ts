import { MAX_FEED_IMAGE_BYTES, UPLOAD_URL_TTL_MINUTES } from '@aurboda/api-spec'
import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { NewUploadUrl, UploadUrlRecord } from '../db/index.ts'

import { hashUploadToken, type MintUploadUrlDeps, type UploadOutcome } from '../services/upload-urls.ts'
import { createUploadRouter, createUploadUrlRouter, type UploadRouterDeps } from './uploads-router.ts'

const API = 'https://aurboda.test/api'
const NOTE_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
const TOKEN = Buffer.alloc(32, 7).toString('base64url')
const GONE = { error: 'This upload URL is unknown, expired or already used', success: false }

/** An in-memory stand-in for the upload_urls table, with the same live/spend semantics. */
const memoryStore = (rows: UploadUrlRecord[]) => {
  const live = (row: UploadUrlRecord) => row.used_at === null && row.expires_at.getTime() > Date.now()
  return {
    findLive: vi.fn(async (_user: string, hash: string) =>
      rows.find((row) => row.token_hash === hash && live(row)),
    ),
    spend: vi.fn(async (_user: string, hash: string) => {
      const row = rows.find((candidate) => candidate.token_hash === hash && live(candidate))
      if (!row) return undefined
      row.used_at = new Date()
      return row
    }),
  }
}

const urlRow = (overrides: Partial<UploadUrlRecord> = {}): UploadUrlRecord => ({
  created_at: new Date(),
  expires_at: new Date(Date.now() + UPLOAD_URL_TTL_MINUTES * 60_000),
  target: 'feed_image',
  target_id: null,
  token_hash: hashUploadToken(TOKEN),
  used_at: null,
  ...overrides,
})

const stored: UploadOutcome = {
  body: { data: { target: 'profile_avatar', url: 'https://aurboda.test/u/alice/avatar.png' }, success: true },
  status: 201,
}

const buildApp = (rows: UploadUrlRecord[] = [urlRow()], overrides: Partial<UploadRouterDeps> = {}) => {
  const deps: UploadRouterDeps = {
    ...memoryStore(rows),
    isDeletedUser: vi.fn(() => false),
    run: vi.fn(async () => stored),
    userExists: vi.fn(async (user: string) => user === 'alice'),
    ...overrides,
  }
  const app = express()
  app.use('/uploads', createUploadRouter(deps))
  // The global parser comes after the upload routes in the real app too.
  app.use(express.json({ limit: '10mb' }))
  return { app, deps }
}

const put = (app: express.Express, path = `/uploads/alice/${TOKEN}`) => supertest(app).put(path)

describe('PUT /uploads/:user/:token', () => {
  test('hands the raw bytes to the URL’s target and answers 201 with what it stored', async () => {
    const { app, deps } = buildApp()
    const res = await put(app).set('Content-Type', 'image/png').send(Buffer.from('png-bytes'))
    expect(res.status).toBe(201)
    expect(res.body).toEqual(stored.body)
    expect(deps.run).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ target: 'feed_image', used_at: expect.any(Date) }),
      Buffer.from('png-bytes'),
    )
  })

  test.each(['note_attachment', 'feed_image', 'challenge_banner', 'profile_avatar'] as const)(
    'passes a %s URL to the runner',
    async (target) => {
      const target_id = target === 'note_attachment' || target === 'challenge_banner' ? NOTE_ID : null
      const { app, deps } = buildApp([urlRow({ target, target_id })])
      const res = await put(app).send(Buffer.from('bytes'))
      expect(res.status).toBe(201)
      expect(deps.run).toHaveBeenCalledWith(
        'alice',
        expect.objectContaining({ target, target_id }),
        Buffer.from('bytes'),
      )
    },
  )

  test('answers the runner’s failure status and body', async () => {
    const { app } = buildApp([urlRow()], {
      run: vi.fn(async () => ({ body: { error: 'Nope', success: false }, status: 415 })),
    })
    const res = await put(app).send(Buffer.from('svg'))
    expect(res.status).toBe(415)
    expect(res.body).toEqual({ error: 'Nope', success: false })
  })

  test('a body sent as application/json still arrives as its raw bytes', async () => {
    const { app, deps } = buildApp()
    const res = await put(app).set('Content-Type', 'application/json').send('{"not":"parsed"}')
    expect(res.status).toBe(201)
    expect(deps.run).toHaveBeenCalledWith('alice', expect.anything(), Buffer.from('{"not":"parsed"}'))
  })

  test('works once: the second use is gone', async () => {
    const { app, deps } = buildApp()
    expect((await put(app).send(Buffer.from('one'))).status).toBe(201)
    const second = await put(app).send(Buffer.from('two'))
    expect(second.status).toBe(404)
    expect(second.body).toEqual(GONE)
    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  test('a refused file uses the URL up all the same', async () => {
    const { app } = buildApp([urlRow()], {
      run: vi.fn(async () => ({ body: { error: 'Nope', success: false }, status: 400 })),
    })
    expect((await put(app).send(Buffer.from('one'))).status).toBe(400)
    expect((await put(app).send(Buffer.from('two'))).status).toBe(404)
  })

  test('an expired URL is gone', async () => {
    const { app, deps } = buildApp([urlRow({ expires_at: new Date(Date.now() - 1000) })])
    const res = await put(app).send(Buffer.from('late'))
    expect(res.status).toBe(404)
    expect(res.body).toEqual(GONE)
    expect(deps.run).not.toHaveBeenCalled()
  })

  test('an unknown token is gone', async () => {
    const { app } = buildApp()
    const res = await put(app, `/uploads/alice/${Buffer.alloc(32, 8).toString('base64url')}`).send(
      Buffer.from('x'),
    )
    expect(res.status).toBe(404)
    expect(res.body).toEqual(GONE)
  })

  test('a malformed token is gone without touching the database', async () => {
    const { app, deps } = buildApp()
    for (const token of ['short', `${TOKEN}A`, `${TOKEN.slice(1)}=`]) {
      const res = await put(app, `/uploads/alice/${token}`).send(Buffer.from('x'))
      expect(res.status).toBe(404)
      expect(res.body).toEqual(GONE)
    }
    expect(deps.userExists).not.toHaveBeenCalled()
    expect(deps.findLive).not.toHaveBeenCalled()
  })

  test('an unknown, invalid or deleted user is gone without touching their database', async () => {
    const { app, deps } = buildApp([urlRow()], { isDeletedUser: vi.fn((user: string) => user === 'carol') })
    for (const user of ['bob', 'Not A Name', 'carol']) {
      const res = await put(app, `/uploads/${encodeURIComponent(user)}/${TOKEN}`).send(Buffer.from('x'))
      expect(res.status).toBe(404)
      expect(res.body).toEqual(GONE)
    }
    expect(deps.userExists).toHaveBeenCalledTimes(1)
    expect(deps.userExists).toHaveBeenCalledWith('bob')
    expect(deps.findLive).not.toHaveBeenCalled()
  })

  test('a body over the target’s limit answers 413 and leaves the URL usable', async () => {
    const { app, deps } = buildApp()
    const res = await put(app).send(Buffer.alloc(MAX_FEED_IMAGE_BYTES + 1))
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'That picture is too large to send.', success: false })
    expect(deps.spend).not.toHaveBeenCalled()
    expect((await put(app).send(Buffer.from('smaller'))).status).toBe(201)
  })

  test('an empty body answers 400 and leaves the URL usable', async () => {
    const { app, deps } = buildApp()
    const res = await put(app).send(Buffer.alloc(0))
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'No file uploaded', success: false })
    expect(deps.spend).not.toHaveBeenCalled()
    expect((await put(app).send(Buffer.from('now'))).status).toBe(201)
  })

  test('a URL spent by a request racing this one is gone', async () => {
    const rows = [urlRow()]
    const { app, deps } = buildApp(rows, { spend: vi.fn(async () => undefined) })
    const res = await put(app).send(Buffer.from('x'))
    expect(res.status).toBe(404)
    expect(deps.run).not.toHaveBeenCalled()
  })
})

describe('POST /uploads/:user/:token', () => {
  test('takes the file from a multipart form’s `file` field', async () => {
    const { app, deps } = buildApp()
    const res = await supertest(app)
      .post(`/uploads/alice/${TOKEN}`)
      .attach('file', Buffer.from('png-bytes'), { contentType: 'image/png', filename: 'p.png' })
    expect(res.status).toBe(201)
    expect(deps.run).toHaveBeenCalledWith('alice', expect.anything(), Buffer.from('png-bytes'))
  })

  test('a form without the file answers 400 and leaves the URL usable', async () => {
    const { app, deps } = buildApp()
    const res = await supertest(app).post(`/uploads/alice/${TOKEN}`).field('other', 'x')
    expect(res.status).toBe(400)
    expect(deps.spend).not.toHaveBeenCalled()
  })

  test('a multipart file over the limit answers 413', async () => {
    const { app, deps } = buildApp()
    const res = await supertest(app)
      .post(`/uploads/alice/${TOKEN}`)
      .attach('file', Buffer.alloc(MAX_FEED_IMAGE_BYTES + 1), { contentType: 'image/png', filename: 'p.png' })
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'That picture is too large to send.', success: false })
    expect(deps.spend).not.toHaveBeenCalled()
  })

  test('takes raw bytes too', async () => {
    const { app, deps } = buildApp()
    const res = await supertest(app)
      .post(`/uploads/alice/${TOKEN}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('raw'))
    expect(res.status).toBe(201)
    expect(deps.run).toHaveBeenCalledWith('alice', expect.anything(), Buffer.from('raw'))
  })
})

describe('POST /uploads', () => {
  const buildMintApp = () => {
    const inserted: NewUploadUrl[] = []
    const deps: MintUploadUrlDeps = {
      apiBaseUrl: API,
      challengeExists: vi.fn(async () => true),
      insert: vi.fn(async (_user: string, url: NewUploadUrl) => {
        inserted.push(url)
      }),
      noteEntryFailure: vi.fn(async () => null),
      now: () => new Date('2026-11-23T10:00:00Z'),
      randomBytes: () => Buffer.alloc(32, 7),
    }
    const auth: express.RequestHandler = (req, res, next) => {
      if (req.headers.authorization !== 'Bearer ok') {
        res.status(401).json({ error: 'Unauthorized', success: false })
        return
      }
      req.user = 'alice'
      next()
    }
    const app = express()
    app.use(express.json())
    app.use('/uploads', createUploadUrlRouter(auth, deps))
    return { app, inserted }
  }

  test('mints a URL for the authenticated user', async () => {
    const { app, inserted } = buildMintApp()
    const res = await supertest(app)
      .post('/uploads')
      .set('Authorization', 'Bearer ok')
      .send({ note_id: NOTE_ID, target: 'note_attachment' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      data: {
        expires_at: '2026-11-23T10:15:00.000Z',
        max_bytes: 20 * 1024 * 1024,
        method: 'PUT',
        target: 'note_attachment',
        upload_url: `${API}/uploads/alice/${TOKEN}`,
      },
      success: true,
    })
    expect(inserted).toHaveLength(1)
  })

  test('requires authentication', async () => {
    const { app, inserted } = buildMintApp()
    const res = await supertest(app).post('/uploads').send({ target: 'feed_image' })
    expect(res.status).toBe(401)
    expect(inserted).toHaveLength(0)
  })

  test('validates the body', async () => {
    const { app, inserted } = buildMintApp()
    const unknown = await supertest(app)
      .post('/uploads')
      .set('Authorization', 'Bearer ok')
      .send({ target: 'fit' })
    expect(unknown.status).toBe(400)
    const badId = await supertest(app)
      .post('/uploads')
      .set('Authorization', 'Bearer ok')
      .send({ note_id: 'nope', target: 'note_attachment' })
    expect(badId.status).toBe(400)
    expect(inserted).toHaveLength(0)
  })

  test('answers the mint refusal', async () => {
    const { app } = buildMintApp()
    const res = await supertest(app)
      .post('/uploads')
      .set('Authorization', 'Bearer ok')
      .send({ target: 'note_attachment' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'note_attachment needs a note_id', success: false })
  })
})
