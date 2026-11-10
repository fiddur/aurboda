import type { MediaPlay, TopMedia } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createMediaRouter } from './media-router.ts'

const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  req.user = 'tester'
  next()
}

const buildApp = (
  getPlays: (user: string, window: { start: Date; end: Date }) => Promise<MediaPlay[]>,
  getPlay: (user: string, id: string) => Promise<MediaPlay | null> = vi.fn(),
  getTop: (
    user: string,
    window: { start: Date; end: Date },
    by: 'artist' | 'album' | 'track',
    limit: number,
  ) => Promise<TopMedia> = vi.fn(),
) => {
  const app = express()
  app.use(createMediaRouter(auth, getPlays, getPlay, getTop) as unknown as express.RequestHandler)
  return app
}

describe('GET /plays', () => {
  test('returns the plays in the window', async () => {
    const getPlays = vi.fn().mockResolvedValue([])
    const res = await supertest(buildApp(getPlays))
      .get('/plays')
      .query({ end: '2026-01-11T00:00:00Z', start: '2026-01-10T00:00:00Z' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [], success: true })
    expect(getPlays).toHaveBeenCalledWith('tester', {
      end: new Date('2026-01-11T00:00:00Z'),
      start: new Date('2026-01-10T00:00:00Z'),
    })
  })

  test('rejects a missing window', async () => {
    const getPlays = vi.fn()
    const res = await supertest(buildApp(getPlays)).get('/plays').query({ start: '2026-01-10T00:00:00Z' })

    expect(res.status).toBe(400)
    expect(getPlays).not.toHaveBeenCalled()
  })
})

const samplePlay: MediaPlay = {
  album: '',
  artist: '',
  device: 'laptop',
  ended_at: '2026-01-10T10:32:00.000Z',
  id: 'play/1',
  kind: null,
  max_position_secs: 1790,
  played_ratio: 0.95,
  played_secs: 1710,
  player: 'firefox',
  seek_count: 0,
  source: 'mpris',
  started_at: '2026-01-10T10:02:00.000Z',
  title: 'Yin Yoga',
  track_secs: 1800,
  url: 'https://www.truenakedyoga.com/videos/yin-hips',
}

describe('GET /play', () => {
  test.each(['play/1', '1758718800000-Thunderstruck-AC/DC', 'with space & 100%'])(
    'returns the play for id %s',
    async (id) => {
      const getPlay = vi.fn().mockResolvedValue({ ...samplePlay, id })
      const res = await supertest(buildApp(vi.fn(), getPlay)).get('/play').query({ id })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ data: { ...samplePlay, id }, success: true })
      expect(getPlay).toHaveBeenCalledWith('tester', id)
    },
  )

  test('rejects a missing id', async () => {
    const getPlay = vi.fn()
    const res = await supertest(buildApp(vi.fn(), getPlay)).get('/play')

    expect(res.status).toBe(400)
    expect(getPlay).not.toHaveBeenCalled()
  })

  test('404s when the play does not exist', async () => {
    const getPlay = vi.fn().mockResolvedValue(null)
    const res = await supertest(buildApp(vi.fn(), getPlay)).get('/play').query({ id: 'missing' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Media play not found', success: false })
  })
})

describe('GET /plays/top', () => {
  const window = { end: '2026-11-01T00:00:00Z', start: '2026-10-01T00:00:00Z' }

  test('ranks the plays in the window, ten by default', async () => {
    const top: TopMedia = { distinct: 1, items: [{ name: 'Bach', plays: 3 }], total_plays: 3 }
    const getTop = vi.fn().mockResolvedValue(top)
    const res = await supertest(buildApp(vi.fn(), vi.fn(), getTop))
      .get('/plays/top')
      .query({ ...window, by: 'artist' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: top, success: true })
    expect(getTop).toHaveBeenCalledWith(
      'tester',
      { end: new Date(window.end), start: new Date(window.start) },
      'artist',
      10,
      undefined,
    )
  })

  test('passes the play source on', async () => {
    const getTop = vi.fn().mockResolvedValue({ distinct: 0, items: [], total_plays: 0 })
    const res = await supertest(buildApp(vi.fn(), vi.fn(), getTop))
      .get('/plays/top')
      .query({ ...window, by: 'track', limit: 5, source: 'lastfm' })

    expect(res.status).toBe(200)
    expect(getTop).toHaveBeenCalledWith(
      'tester',
      { end: new Date(window.end), start: new Date(window.start) },
      'track',
      5,
      'lastfm',
    )
  })

  test('rejects an unknown grouping, a limit out of bounds and an unknown source', async () => {
    const getTop = vi.fn()
    const app = buildApp(vi.fn(), vi.fn(), getTop)

    expect(
      (
        await supertest(app)
          .get('/plays/top')
          .query({ ...window, by: 'genre' })
      ).status,
    ).toBe(400)
    expect(
      (
        await supertest(app)
          .get('/plays/top')
          .query({ ...window, by: 'track', limit: 0 })
      ).status,
    ).toBe(400)
    expect(
      (
        await supertest(app)
          .get('/plays/top')
          .query({ ...window, by: 'track', limit: 51 })
      ).status,
    ).toBe(400)
    expect(
      (
        await supertest(app)
          .get('/plays/top')
          .query({ ...window, by: 'track', source: 'spotify' })
      ).status,
    ).toBe(400)
    expect(getTop).not.toHaveBeenCalled()
  })
})
