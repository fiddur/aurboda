import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createPublicAvatarRouter } from './public-avatar-router.ts'

const storedAvatar = { content_type: 'image/webp', data: Buffer.from('webp-bytes') }

const buildApp = (loadAvatar = vi.fn(async () => storedAvatar)) => {
  const app = express()
  app.use(createPublicAvatarRouter({ loadAvatar }))
  return { app, loadAvatar }
}

describe('GET /u/:username/avatar.png', () => {
  test('serves the stored avatar with its content type and cache headers', async () => {
    const { app, loadAvatar } = buildApp()
    const res = await supertest(app).get('/u/fiddur/avatar.png')
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/webp')
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    expect(loadAvatar).toHaveBeenCalledWith('fiddur')
  })

  test('serves a generated identicon for an invalid username without DB access', async () => {
    const { app, loadAvatar } = buildApp()
    const res = await supertest(app).get('/u/Invalid..Name/avatar.png')
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/png')
    // PNG magic bytes from the generated identicon.
    expect(res.body.subarray(0, 4).toString('hex')).toBe('89504e47')
    expect(loadAvatar).not.toHaveBeenCalled()
  })
})
