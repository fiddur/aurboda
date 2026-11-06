import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { CentralDb } from '../services/central-db.ts'
import type { InvitationAuth } from '../services/invitation.ts'

import { gravlRedirectUri } from '../integrations/gravl/client.ts'
import { createAdminRouter } from './admin-router.ts'

const centralDb = {
  getAdminCount: vi.fn().mockResolvedValue(1),
  getAuditLogRetentionDays: vi.fn().mockResolvedValue(3),
  getLastFmApiKey: vi.fn().mockResolvedValue(null),
  getOuraWebhookEnabled: vi.fn().mockResolvedValue(false),
  getServerSetting: vi.fn().mockResolvedValue(null),
  getSignupMode: vi.fn().mockResolvedValue('closed'),
  setServerSetting: vi.fn().mockResolvedValue(undefined),
} as unknown as CentralDb

const pass: RequestHandler = (_req, _res, next) => next()

const buildApp = () => {
  const app = express()
  app.use(express.json())
  app.use(
    '/admin',
    createAdminRouter(
      pass,
      pass,
      centralDb,
      {} as InvitationAuth,
      'https://web.example.test',
      gravlRedirectUri('https://api.example.test/api'),
      async (username) => username === 'fiddur',
    ),
  )
  return app
}

describe('admin settings', () => {
  test('GET returns the absolute Gravl redirect URI the OAuth flow uses', async () => {
    const res = await supertest(buildApp()).get('/admin/settings')
    expect(res.status).toBe(200)
    expect(res.body.gravl_redirect_uri).toBe('https://api.example.test/api/auth/gravlcb')
  })

  test('PATCH returns it too, so the cached settings keep it', async () => {
    const res = await supertest(buildApp()).patch('/admin/settings').send({ gravl_client_id: 'abc' })
    expect(res.status).toBe(200)
    expect(res.body.gravl_redirect_uri).toBe('https://api.example.test/api/auth/gravlcb')
  })
})

describe('instance blog setting', () => {
  test('GET returns null when no blog user is set', async () => {
    const res = await supertest(buildApp()).get('/admin/settings')
    expect(res.body.blog_username).toBeNull()
  })

  test('PATCH stores an existing user as the blog user', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp()).patch('/admin/settings').send({ blog_username: 'fiddur' })
    expect(res.status).toBe(200)
    expect(centralDb.setServerSetting).toHaveBeenCalledWith('blog_username', 'fiddur')
  })

  test('PATCH rejects an unknown user with 400 and stores nothing', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp()).patch('/admin/settings').send({ blog_username: 'ghost' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('ghost')
    expect(centralDb.setServerSetting).not.toHaveBeenCalled()
  })

  test('PATCH with null clears the setting', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp()).patch('/admin/settings').send({ blog_username: null })
    expect(res.status).toBe(200)
    expect(centralDb.setServerSetting).toHaveBeenCalledWith('blog_username', '')
  })
})
