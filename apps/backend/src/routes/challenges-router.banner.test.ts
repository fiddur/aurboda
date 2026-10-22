import express from 'express'
import sharp from 'sharp'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as DbModule from '../db/index.ts'
import type { ChallengeRecord } from '../db/index.ts'

vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  deleteChallengeBanner: vi.fn(),
  getChallengeById: vi.fn(),
  upsertChallengeBanner: vi.fn(),
}))

const db = await import('../db/index.ts')
const { createChallengesRouter } = await import('./challenges-router.ts')

const record = (overrides: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  announce_winner: false,
  banner_updated_at: null,
  created_at: new Date('2026-09-01T00:00:00Z'),
  end_ts: new Date('2026-11-01T00:00:00Z'),
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'October steps',
  result_published_at: null,
  slug: 'oct',
  spec: {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: '1d',
    pattern: 'steps',
    source_type: 'metric',
    unit: 'steps',
  },
  start_ts: new Date('2026-10-01T00:00:00Z'),
  timezone: 'UTC',
  updated_at: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
})

const bannerSetAt = new Date('2026-10-01T08:00:00Z')

const buildApp = () => {
  const app = express()
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(
    '/challenges',
    createChallengesRouter(auth, 'https://aurboda.net', 'https://aurboda.net/api', async () => ({
      challenges: [],
      peers_unreachable: 0,
    })) as unknown as express.RequestHandler,
  )
  return app
}

const pngBuffer = () =>
  sharp({ create: { background: { b: 90, g: 150, r: 20 }, channels: 3, height: 300, width: 500 } })
    .png()
    .toBuffer()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /challenges/:id/banner', () => {
  test('stores the processed banner and answers with the banner URL', async () => {
    vi.mocked(db.getChallengeById)
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(record({ banner_updated_at: bannerSetAt }))
    const res = await supertest(buildApp())
      .post('/challenges/c1/banner')
      .attach('banner', await pngBuffer(), { contentType: 'image/png', filename: 'b.png' })
    expect(res.status).toBe(200)
    expect(res.body.challenge.banner_url).toBe(
      `https://aurboda.net/u/tester/oct/banner.webp?v=${bannerSetAt.getTime()}`,
    )
    expect(db.upsertChallengeBanner).toHaveBeenCalledWith('tester', 'c1', 'image/webp', expect.any(Buffer))
    const stored = vi.mocked(db.upsertChallengeBanner).mock.calls[0][3]
    const meta = await sharp(stored).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 630])
  })

  test('rejects when no file is uploaded', async () => {
    const res = await supertest(buildApp()).post('/challenges/c1/banner')
    expect(res.status).toBe(400)
    expect(db.upsertChallengeBanner).not.toHaveBeenCalled()
  })

  test('rejects an unsupported content type', async () => {
    const res = await supertest(buildApp())
      .post('/challenges/c1/banner')
      .attach('banner', Buffer.from('%PDF-'), { contentType: 'application/pdf', filename: 'b.pdf' })
    expect(res.status).toBe(400)
    expect(db.upsertChallengeBanner).not.toHaveBeenCalled()
  })

  test('rejects an image sharp cannot decode', async () => {
    vi.mocked(db.getChallengeById).mockResolvedValue(record())
    const res = await supertest(buildApp())
      .post('/challenges/c1/banner')
      .attach('banner', Buffer.from('not really a png'), { contentType: 'image/png', filename: 'b.png' })
    expect(res.status).toBe(400)
    expect(db.upsertChallengeBanner).not.toHaveBeenCalled()
  })

  test('404 when the challenge is not the user’s', async () => {
    vi.mocked(db.getChallengeById).mockResolvedValue(null)
    const res = await supertest(buildApp())
      .post('/challenges/nope/banner')
      .attach('banner', await pngBuffer(), { contentType: 'image/png', filename: 'b.png' })
    expect(res.status).toBe(404)
    expect(db.upsertChallengeBanner).not.toHaveBeenCalled()
  })
})

describe('DELETE /challenges/:id/banner', () => {
  test('removes the banner and answers with banner_url null', async () => {
    vi.mocked(db.getChallengeById)
      .mockResolvedValueOnce(record({ banner_updated_at: bannerSetAt }))
      .mockResolvedValueOnce(record())
    vi.mocked(db.deleteChallengeBanner).mockResolvedValue(true)
    const res = await supertest(buildApp()).delete('/challenges/c1/banner')
    expect(res.status).toBe(200)
    expect(res.body.challenge.banner_url).toBeNull()
    expect(db.deleteChallengeBanner).toHaveBeenCalledWith('tester', 'c1')
  })

  test('404 for an unknown challenge', async () => {
    vi.mocked(db.getChallengeById).mockResolvedValue(null)
    const res = await supertest(buildApp()).delete('/challenges/nope/banner')
    expect(res.status).toBe(404)
    expect(db.deleteChallengeBanner).not.toHaveBeenCalled()
  })
})
