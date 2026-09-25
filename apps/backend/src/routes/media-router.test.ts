import type { MediaPlay } from '@aurboda/api-spec'

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
) => {
  const app = express()
  app.use(createMediaRouter(auth, getPlays, getPlay) as unknown as express.RequestHandler)
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

describe('GET /plays/:id', () => {
  test('returns the play', async () => {
    const getPlay = vi.fn().mockResolvedValue(samplePlay)
    const res = await supertest(buildApp(vi.fn(), getPlay)).get(`/plays/${encodeURIComponent('play/1')}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: samplePlay, success: true })
    expect(getPlay).toHaveBeenCalledWith('tester', 'play/1')
  })

  test('404s when the play does not exist', async () => {
    const getPlay = vi.fn().mockResolvedValue(null)
    const res = await supertest(buildApp(vi.fn(), getPlay)).get('/plays/missing')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Media play not found', success: false })
  })
})
