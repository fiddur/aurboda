import type { StoredActivityTypeCatalog } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createActivityTypeCatalogRouter } from './activity-type-catalog-router.ts'

vi.mock('../db/index.ts', () => ({
  getActivityTypeNames: vi.fn().mockResolvedValue(['sauna']),
}))

const catalog: StoredActivityTypeCatalog = {
  entries: [
    {
      aliases: [],
      color: '#f97316',
      display_category: 'wellness',
      display_name: 'Sauna',
      group: 'recovery',
      icon: '🧖',
      name: 'sauna',
      same_as: {},
    },
    {
      aliases: [],
      color: '#dc2626',
      data_schema: { fields: [{ max: 10, min: 0, name: 'severity', type: 'number' }] },
      display_category: 'health',
      display_name: 'Headache',
      group: 'symptoms',
      icon: '🤕',
      name: 'headache',
      parent_type: 'symptom',
      same_as: { apple_healthkit: ['HKCategoryTypeIdentifierHeadache'] },
    },
  ],
  groups: [
    { key: 'recovery', name: 'Recovery' },
    { key: 'symptoms', name: 'Symptoms' },
  ],
  version: '2026.11.1',
}

const buildApp = () => {
  const app = express()
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(
    '/activity-type-catalog',
    createActivityTypeCatalogRouter(auth, () => catalog) as unknown as express.RequestHandler,
  )
  return app
}

describe('GET /activity-type-catalog', () => {
  test('lists every entry with in_use, the groups and the version', async () => {
    const res = await supertest(buildApp()).get('/activity-type-catalog')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      data: {
        entries: [
          { ...catalog.entries[0], in_use: true },
          { ...catalog.entries[1], in_use: false },
        ],
        groups: catalog.groups,
        version: '2026.11.1',
      },
      success: true,
    })
  })

  test('filters by q', async () => {
    const res = await supertest(buildApp()).get('/activity-type-catalog').query({ q: 'head' })
    expect(res.status).toBe(200)
    expect(res.body.data.entries.map((e: { name: string }) => e.name)).toEqual(['headache'])
  })

  test('refuses an over-long q', async () => {
    const res = await supertest(buildApp())
      .get('/activity-type-catalog')
      .query({ q: 'x'.repeat(101) })
    expect(res.status).toBe(400)
  })
})
