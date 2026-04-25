import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import { createWellKnownRouter } from './well-known-router.ts'

const buildApp = (config: { androidPackageName: string; androidFingerprints: string[] }) => {
  const app = express()
  app.use(createWellKnownRouter(config))
  return app
}

describe('well-known/assetlinks.json', () => {
  test('returns empty array when no fingerprints configured', async () => {
    const app = buildApp({ androidFingerprints: [], androidPackageName: 'net.aurboda.app' })
    const res = await supertest(app).get('/.well-known/assetlinks.json')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  test('returns assetlinks statement with configured fingerprints', async () => {
    const app = buildApp({
      androidFingerprints: ['AA:BB:CC', 'DD:EE:FF'],
      androidPackageName: 'net.aurboda.app',
    })
    const res = await supertest(app).get('/.well-known/assetlinks.json')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].target).toEqual({
      namespace: 'android_app',
      package_name: 'net.aurboda.app',
      sha256_cert_fingerprints: ['AA:BB:CC', 'DD:EE:FF'],
    })
    expect(res.body[0].relation).toContain('delegate_permission/common.get_login_creds')
  })

  test('sets cache-control header', async () => {
    const app = buildApp({ androidFingerprints: ['AA'], androidPackageName: 'net.aurboda.app' })
    const res = await supertest(app).get('/.well-known/assetlinks.json')
    expect(res.headers['cache-control']).toMatch(/max-age=3600/)
  })
})
