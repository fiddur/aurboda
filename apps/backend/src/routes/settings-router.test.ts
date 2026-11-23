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

  test('stores the menu paths, drops one no menu offers, and reads them back', async () => {
    const patched = await supertest(app())
      .patch('/user/settings')
      .send({ hidden_pages: ['/meals', '/feed', '/a-page-from-the-future'] })
    expect(patched.status).toBe(200)
    expect(patched.body.hidden_pages).toEqual(['/meals', '/feed'])

    const read = await supertest(app()).get('/user/settings')
    expect(read.body.hidden_pages).toEqual(['/meals', '/feed'])
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

describe('journal_strip_metadata over GET/PATCH /user/settings', () => {
  test('is false until set, and reads back what was stored', async () => {
    expect((await supertest(app()).get('/user/settings')).body.journal_strip_metadata).toBe(false)

    const patched = await supertest(app()).patch('/user/settings').send({ journal_strip_metadata: true })
    expect(patched.status).toBe(200)
    expect(patched.body.journal_strip_metadata).toBe(true)
    expect((await supertest(app()).get('/user/settings')).body.journal_strip_metadata).toBe(true)
  })

  test('refuses a value that is not a boolean', async () => {
    const res = await supertest(app()).patch('/user/settings').send({ journal_strip_metadata: 'yes' })
    expect(res.status).toBe(400)
    expect(store.settings).toEqual({})
  })
})

describe('tz over PATCH /user/settings', () => {
  test('stores the zone as device_timezone and answers it as tz', async () => {
    const res = await supertest(app()).patch('/user/settings').send({ tz: 'Europe/Stockholm' })
    expect(res.status).toBe(200)
    expect(res.body.tz).toBe('Europe/Stockholm')
    expect(res.body.tz_follows_device).toBe(false)
    expect(store.settings).toEqual({ device_timezone: 'Europe/Stockholm', tz_follows_device: false })
  })

  test('refuses an unknown zone', async () => {
    const res = await supertest(app()).patch('/user/settings').send({ tz: 'Mars/Olympus' })
    expect(res.status).toBe(400)
    expect(store.settings).toEqual({})
  })
})
