import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { WeatherDeps } from '../services/weather.ts'

import { createWeatherRouter } from './weather-router.ts'

const buildApp = () => {
  const deps: WeatherDeps = {
    getEntries: vi.fn(async () => [
      {
        metric: 'weather_code',
        source: 'open_meteo',
        time: new Date('2026-11-01T10:00:00Z'),
        unit: 'wmo',
        value: 0,
      },
    ]),
    getUserTimezone: vi.fn(async () => 'UTC'),
    locateHours: vi.fn(async (_user, hours) => hours.map(() => null)),
  }
  const app = express()
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/weather', createWeatherRouter(auth, deps))
  return { app, deps }
}

describe('GET /weather', () => {
  test('a day', async () => {
    const { app, deps } = buildApp()
    const response = await supertest(app).get('/weather?date=2026-11-01&tz=UTC')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      hours: [{ code: 0, time: '2026-11-01T10:00:00.000Z' }],
      success: true,
      summary: { condition: 'Clear sky', emoji: '☀️', hours: 1 },
    })
    expect(deps.getUserTimezone).not.toHaveBeenCalled()
  })

  test('a span', async () => {
    const { app } = buildApp()
    const response = await supertest(app).get('/weather?start=2026-11-01T10:20:00Z&end=2026-11-01T10:40:00Z')
    expect(response.status).toBe(200)
    expect(response.body.hours).toHaveLength(1)
  })

  test('400 for a span longer than 31 days', async () => {
    const { app } = buildApp()
    const ok = await supertest(app).get('/weather?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z')
    expect(ok.status).toBe(200)
    const tooLong = await supertest(app).get('/weather?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:01Z')
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.success).toBe(false)
  })

  test('400 with neither form', async () => {
    const response = await supertest(buildApp().app).get('/weather')
    expect(response.status).toBe(400)
    expect(response.body.success).toBe(false)
  })

  test('400 with both forms', async () => {
    const response = await supertest(buildApp().app).get(
      '/weather?date=2026-11-01&start=2026-11-01T10:20:00Z&end=2026-11-01T10:40:00Z',
    )
    expect(response.status).toBe(400)
  })

  test('400 with start but no end', async () => {
    const response = await supertest(buildApp().app).get('/weather?start=2026-11-01T10:20:00Z')
    expect(response.status).toBe(400)
  })
})
