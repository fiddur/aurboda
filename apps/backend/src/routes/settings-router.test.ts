import type { RequestHandler } from 'express'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createSettingsRouter } from './settings-router.ts'

const store = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))

vi.mock('../db/index.ts', () => ({
  getAllSyncStates: async () => [],
  getGoals: async () => [],
  getOAuthToken: async () => null,
  getUserSettings: async () => store.settings,
  replaceGoals: async () => {},
  upsertUserSettings: async (_user: string, updates: Record<string, unknown>, clear: string[] = []) => {
    const next = { ...store.settings, ...updates }
    for (const key of clear) delete next[key]
    store.settings = next
    return next
  },
}))

vi.mock('../services/central-db.ts', () => ({
  getCentralDb: () => ({
    getLastFmApiKey: async () => null,
    getServerSetting: async () => null,
  }),
}))

const auth: RequestHandler = (req, _res, next) => {
  req.user = 'tester'
  next()
}

const app = () => express().use(express.json()).use(createSettingsRouter(auth))

beforeEach(() => {
  store.settings = {}
})

describe('hidden_pages over GET/PATCH /user/settings', () => {
  test('is an empty list until set', async () => {
    const res = await supertest(app()).get('/user/settings')
    expect(res.status).toBe(200)
    expect(res.body.hidden_pages).toEqual([])
  })

  test('stores the list as given, an unknown path included, and reads it back', async () => {
    const hidden = ['/meals', '/feed', '/a-page-from-the-future']
    const patched = await supertest(app()).patch('/user/settings').send({ hidden_pages: hidden })
    expect(patched.status).toBe(200)
    expect(patched.body.hidden_pages).toEqual(hidden)

    const read = await supertest(app()).get('/user/settings')
    expect(read.body.hidden_pages).toEqual(hidden)
  })

  test('null shows every page again', async () => {
    await supertest(app())
      .patch('/user/settings')
      .send({ hidden_pages: ['/meals'] })
    const res = await supertest(app()).patch('/user/settings').send({ hidden_pages: null })
    expect(res.body.hidden_pages).toEqual([])
    expect(store.settings).not.toHaveProperty('hidden_pages')
  })

  test('refuses a path that does not start with a slash', async () => {
    const res = await supertest(app())
      .patch('/user/settings')
      .send({ hidden_pages: ['meals'] })
    expect(res.status).toBe(400)
    expect(store.settings).toEqual({})
  })
})

describe('tz over PATCH /user/settings', () => {
  test('stores the zone as device_timezone and answers it as tz', async () => {
    const res = await supertest(app()).patch('/user/settings').send({ tz: 'Europe/Stockholm' })
    expect(res.status).toBe(200)
    expect(res.body.tz).toBe('Europe/Stockholm')
    expect(store.settings).toEqual({ device_timezone: 'Europe/Stockholm' })
  })

  test('refuses an unknown zone', async () => {
    const res = await supertest(app()).patch('/user/settings').send({ tz: 'Mars/Olympus' })
    expect(res.status).toBe(400)
    expect(store.settings).toEqual({})
  })
})
