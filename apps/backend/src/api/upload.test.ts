import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import { singleUpload } from './upload.ts'

const buildApp = (tooLargeMessage?: string) => {
  const app = express()
  app.post(
    '/upload',
    singleUpload({ field: 'file', fields: 2, fileSize: 16, tooLargeMessage }),
    (req, res) => {
      res.json({ size: req.file?.size, success: true })
    },
  )
  app.use((_err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: 'Internal error', success: false })
  })
  return app
}

const post = (app: express.Express) => supertest(app).post('/upload')

describe('singleUpload', () => {
  test('passes a file within the limits on to the route', async () => {
    const res = await post(buildApp()).field('note', 'x').attach('file', Buffer.from('small'), 'a.bin')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ size: 5, success: true })
  })

  test('answers 413 for a file over the size limit', async () => {
    const res = await post(buildApp()).attach('file', Buffer.alloc(17), 'big.bin')
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'File too large', success: false })
  })

  test('answers 413 with the route message when it has one', async () => {
    const res = await post(buildApp('That picture is too large.')).attach('file', Buffer.alloc(17), 'big.bin')
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'That picture is too large.', success: false })
  })

  test('answers 400 for a second file', async () => {
    const res = await post(buildApp())
      .attach('file', Buffer.from('one'), 'a.bin')
      .attach('file', Buffer.from('two'), 'b.bin')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid upload', success: false })
  })

  test('answers 400 for a file under another field name', async () => {
    const res = await post(buildApp()).attach('other', Buffer.from('one'), 'a.bin')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid upload', success: false })
  })

  test('answers 400 for too many form fields', async () => {
    const res = await post(buildApp())
      .field('a', '1')
      .field('b', '2')
      .field('c', '3')
      .attach('file', Buffer.from('small'), 'a.bin')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid upload', success: false })
  })
})
