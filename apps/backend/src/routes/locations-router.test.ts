import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { NamedLocation } from '../services/locations.ts'

import { createLocationsRouter } from './locations-router.ts'

vi.mock('../services/locations.ts', () => ({
  deleteNamedLocation: vi.fn(),
  getDetectedLocations: vi.fn(),
  getNamedLocations: vi.fn(),
  getRawLocationPoints: vi.fn(),
  insertNamedLocation: vi.fn(),
  updateNamedLocation: vi.fn(),
}))

vi.mock('../services/queries/index.ts', () => ({
  getLocationSummary: vi.fn(),
  getPlacesSummary: vi.fn(),
  queryLocations: vi.fn(),
  queryOvernightStays: vi.fn(),
}))

vi.mock('../db/index.ts', () => ({ getDetectedLocations: vi.fn() }))

const service = await import('../services/locations.ts')
const queries = await import('../services/queries/index.ts')

const home = { id: 'loc-1', lat: 59.33, lon: 18.07, name: 'Home', radius: 100 } as unknown as NamedLocation

const buildApp = (onNamedLocationsChanged?: (user: string) => void) => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(
    '/locations',
    createLocationsRouter(auth, onNamedLocationsChanged) as unknown as express.RequestHandler,
  )
  return app
}

describe('locations router named-location change notification', () => {
  const onChanged = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(service.insertNamedLocation).mockResolvedValue(home)
    vi.mocked(service.updateNamedLocation).mockResolvedValue(home)
    vi.mocked(service.deleteNamedLocation).mockResolvedValue(true)
    vi.mocked(service.getNamedLocations).mockResolvedValue([home])
  })

  test('POST /named notifies once with the user', async () => {
    const res = await supertest(buildApp(onChanged))
      .post('/locations/named')
      .send({ lat: 59.33, lon: 18.07, name: 'Home', radius: 100 })

    expect(res.status).toBe(200)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('tester')
  })

  test('PATCH /named/:id notifies once with the user', async () => {
    const res = await supertest(buildApp(onChanged)).patch('/locations/named/loc-1').send({ name: 'Cabin' })

    expect(res.status).toBe(200)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('tester')
  })

  test('DELETE /named/:id notifies once with the user', async () => {
    const res = await supertest(buildApp(onChanged)).delete('/locations/named/loc-1')

    expect(res.status).toBe(200)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('tester')
  })

  test('POST /detected/promote notifies once with the user', async () => {
    const res = await supertest(buildApp(onChanged))
      .post('/locations/detected/promote')
      .send({ lat: 59.33, lon: 18.07, name: 'Home', radius: 100 })

    expect(res.status).toBe(200)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('tester')
  })

  test('PATCH /named/:id answering 404 does not notify', async () => {
    vi.mocked(service.updateNamedLocation).mockResolvedValue(null)

    const res = await supertest(buildApp(onChanged)).patch('/locations/named/missing').send({ name: 'Cabin' })

    expect(res.status).toBe(404)
    expect(onChanged).not.toHaveBeenCalled()
  })

  test('DELETE /named/:id answering 404 does not notify', async () => {
    vi.mocked(service.deleteNamedLocation).mockResolvedValue(false)

    const res = await supertest(buildApp(onChanged)).delete('/locations/named/missing')

    expect(res.status).toBe(404)
    expect(onChanged).not.toHaveBeenCalled()
  })

  test('GET /named does not notify', async () => {
    const res = await supertest(buildApp(onChanged)).get('/locations/named')

    expect(res.status).toBe(200)
    expect(onChanged).not.toHaveBeenCalled()
  })

  test('works without a callback', async () => {
    const res = await supertest(buildApp())
      .post('/locations/named')
      .send({ lat: 59.33, lon: 18.07, name: 'Home', radius: 100 })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(home)
  })
})

describe('GET /locations/places-summary', () => {
  beforeEach(() => vi.clearAllMocks())

  const query = { end: '2026-10-31T23:59:59Z', start: '2026-10-01T00:00:00Z', tz: 'Europe/Stockholm' }

  test('summarizes the places in the range with the home place', async () => {
    const summary = {
      distinct_places: 3,
      nights_away: 2,
      nights_by_place: [{ name: 'Flat', nights: 28 }],
      nights_elsewhere: 2,
      nights_home: 28,
      nights_no_data: 1,
      places: [],
      visits: 40,
    }
    vi.mocked(queries.getPlacesSummary).mockResolvedValue(summary)

    const res = await supertest(buildApp())
      .get('/locations/places-summary')
      .query({ ...query, home_location: 'Flat' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: summary, success: true })
    expect(queries.getPlacesSummary).toHaveBeenCalledWith('tester', {
      end: new Date(query.end),
      homeName: 'Flat',
      start: new Date(query.start),
      tz: 'Europe/Stockholm',
    })
  })

  test('400s without a timezone', async () => {
    const res = await supertest(buildApp())
      .get('/locations/places-summary')
      .query({ end: query.end, start: query.start })

    expect(res.status).toBe(400)
    expect(queries.getPlacesSummary).not.toHaveBeenCalled()
  })
})
