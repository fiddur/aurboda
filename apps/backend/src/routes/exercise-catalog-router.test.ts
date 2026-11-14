import type { StoredExerciseCatalog } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import { createExerciseCatalogRouter } from './exercise-catalog-router.ts'

const catalog: StoredExerciseCatalog = {
  entries: [
    {
      aliases: ['Flat DB Press'],
      category: 'strength',
      equipment: ['dumbbell'],
      key: 'dumbbell_bench_press',
      muscles: { lower_pecs: 1, triceps_medial_lateral: 0.5 },
      name: 'Dumbbell Bench Press',
      same_as: { bodybuild: 'dumbbell bench press' },
      search_terms: ['DB'],
    },
    {
      aliases: [],
      category: 'stretching',
      equipment: [],
      key: 'chest_stretch',
      muscles: { chest: 0.5 },
      name: 'Chest Stretch',
      same_as: { fit: ['flexibility/chest_stretch'], free_exercise_db: 'Chest_Stretch' },
      search_terms: [],
    },
  ],
  sources: {
    bodybuild: { commit: 'a', license: 'AGPL-3.0', url: 'u' },
    free_exercise_db: { commit: 'b', license: 'Unlicense', url: 'u' },
    garmin_connect: { fetched: '2026-11-13', names_url: 'n', url: 'u' },
  },
  version: '2026.11.0',
}

const buildApp = () => {
  const app = express()
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(
    '/exercise-catalog',
    createExerciseCatalogRouter(auth, () => catalog) as unknown as express.RequestHandler,
  )
  return app
}

describe('GET /exercise-catalog', () => {
  test('searches and returns the version, total and API entries', async () => {
    const res = await supertest(buildApp()).get('/exercise-catalog').query({ q: 'db' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      data: {
        entries: [
          {
            aliases: ['Flat DB Press'],
            category: 'strength',
            equipment: [{ category: 'free_weights', key: 'dumbbell', name: 'Dumbbell' }],
            key: 'dumbbell_bench_press',
            muscles: [
              { group: 'chest', key: 'lower_pecs', name: 'Lower pecs', weight: 1 },
              {
                group: 'triceps',
                key: 'triceps_medial_lateral',
                name: 'Triceps (medial and lateral heads)',
                weight: 0.5,
              },
            ],
            name: 'Dumbbell Bench Press',
            same_as: { bodybuild: 'dumbbell bench press' },
          },
        ],
        total: 1,
        version: '2026.11.0',
      },
      success: true,
    })
  })

  test('coerces limit and offset from the query string', async () => {
    const res = await supertest(buildApp()).get('/exercise-catalog').query({ limit: '1', offset: '1' })
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(2)
    expect(res.body.data.entries.map((e: { key: string }) => e.key)).toEqual(['dumbbell_bench_press'])
  })

  test('name is an exact name-or-alias lookup', async () => {
    const res = await supertest(buildApp()).get('/exercise-catalog').query({ name: 'flat db press' })
    expect(res.body.data.entries.map((e: { key: string }) => e.key)).toEqual(['dumbbell_bench_press'])
  })

  test.each(['flexibility/chest_stretch', 'FLEXIBILITY/CHEST_STRETCH'])(
    'fit is an exact Garmin FIT lookup in any letter case: %s',
    async (fit) => {
      const res = await supertest(buildApp()).get('/exercise-catalog').query({ fit, q: 'db' })
      expect(res.status).toBe(200)
      expect(res.body.data.entries.map((e: { key: string }) => e.key)).toEqual(['chest_stretch'])
    },
  )

  test('an unknown fit returns nothing', async () => {
    const res = await supertest(buildApp()).get('/exercise-catalog').query({ fit: 'flexibility/nope' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ entries: [], total: 0 })
  })

  test.each([{ equipment: 'spaceship' }, { muscle: 'heart' }, { category: 'cardio' }, { limit: '101' }])(
    '400 on an invalid query %o',
    async (query) => {
      const res = await supertest(buildApp()).get('/exercise-catalog').query(query)
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    },
  )
})

describe('GET /exercise-catalog/:key', () => {
  test('returns the entry with the catalogue version', async () => {
    const res = await supertest(buildApp()).get('/exercise-catalog/chest_stretch')
    expect(res.status).toBe(200)
    expect(res.body.data.version).toBe('2026.11.0')
    expect(res.body.data.entry).toMatchObject({
      category: 'stretching',
      key: 'chest_stretch',
      name: 'Chest Stretch',
    })
  })

  test('404 for an unknown key', async () => {
    const res = await supertest(buildApp()).get('/exercise-catalog/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Exercise not found', success: false })
  })
})
