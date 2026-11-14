import type { StoredMetricCatalog } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createMetricCatalogRouter } from './metric-catalog-router.ts'

vi.mock('../db/index.ts', () => ({
  getCustomMetricDefinitions: vi.fn().mockResolvedValue([{ name: 'ferritin', unit: 'ng/mL' }]),
}))

const catalog: StoredMetricCatalog = {
  entries: [
    {
      aliases: ['serum ferritin'],
      display_name: 'Ferritin',
      group: 'blood_count',
      name: 'ferritin',
      unit: 'µg/L',
      units: [{ factor: 1, unit: 'ng/mL' }],
    },
    {
      aliases: ['ldl'],
      display_name: 'LDL cholesterol',
      group: 'lipids',
      name: 'ldl_cholesterol',
      unit: 'mmol/L',
      units: [{ factor: 0.02586, unit: 'mg/dL' }],
    },
  ],
  groups: [
    { key: 'lipids', name: 'Lipids' },
    { key: 'blood_count', name: 'Iron and blood count' },
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
    '/metric-catalog',
    createMetricCatalogRouter(auth, () => catalog) as unknown as express.RequestHandler,
  )
  return app
}

describe('GET /metric-catalog', () => {
  test('lists every entry with in_use and in_use_unit, the groups and the version', async () => {
    const res = await supertest(buildApp()).get('/metric-catalog')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      data: {
        entries: [
          { ...catalog.entries[0], in_use: true, in_use_unit: 'ng/mL' },
          { ...catalog.entries[1], in_use: false },
        ],
        groups: catalog.groups,
        version: '2026.11.1',
      },
      success: true,
    })
  })

  test('filters by q', async () => {
    const res = await supertest(buildApp()).get('/metric-catalog').query({ q: 'ldl' })
    expect(res.status).toBe(200)
    expect(res.body.data.entries.map((e: { name: string }) => e.name)).toEqual(['ldl_cholesterol'])
  })

  test('refuses an over-long q', async () => {
    const res = await supertest(buildApp())
      .get('/metric-catalog')
      .query({ q: 'x'.repeat(101) })
    expect(res.status).toBe(400)
  })
})
