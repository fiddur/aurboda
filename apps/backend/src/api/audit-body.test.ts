import express, { type Request } from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import {
  auditErrorType,
  auditOperation,
  summarizeAuditBody,
  trackRouteTemplate,
  unhandledErrorAudit,
} from './audit-body.ts'

describe('summarizeAuditBody', () => {
  test('is undefined without a body', () => {
    expect(summarizeAuditBody(undefined)).toBeUndefined()
    expect(summarizeAuditBody({})).toBeUndefined()
  })

  test('keeps an object as its number of fields, without keys or values', () => {
    const result = summarizeAuditBody({ content: 'my private note', password: 'hunter2' })
    expect(result).toEqual({ body: { fields: 2, type: 'object' } })
    expect(JSON.stringify(result)).not.toMatch(/content|password|hunter2|private/)
  })

  test('keeps an array as its length', () => {
    expect(summarizeAuditBody([{ a: 1 }, 'x', 3])).toEqual({ body: { items: 3, type: 'array' } })
  })

  test('keeps a scalar as its type', () => {
    expect(summarizeAuditBody('secret')).toEqual({ body: { type: 'string' } })
    expect(summarizeAuditBody(42)).toEqual({ body: { type: 'number' } })
    expect(summarizeAuditBody(false)).toEqual({ body: { type: 'boolean' } })
    expect(summarizeAuditBody(null)).toEqual({ body: { type: 'null' } })
  })
})

describe('auditErrorType', () => {
  test.each([
    [400, 'validation'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [413, 'too_large'],
    [429, 'rate_limited'],
    [402, 'client_error'],
    [415, 'client_error'],
    [500, 'server_error'],
    [503, 'server_error'],
  ])('%i is %s', (status, type) => {
    expect(auditErrorType(status)).toBe(type)
  })
})

/** Runs a request through a real app and returns what `auditOperation` said when the response finished. */
const operationOf = async (
  mount: (app: express.Express) => void,
  method: 'post' | 'delete',
  path: string,
): Promise<string> => {
  const app = express()
  let operation = ''
  app.use((req, res, next) => {
    trackRouteTemplate(req)
    res.on('finish', () => {
      operation = auditOperation(req)
    })
    next()
  })
  mount(app)
  app.use((_err: Error, _req: Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({})
  })
  await supertest(app)[method](path)
  return operation
}

describe('auditOperation', () => {
  test('is the route template of a mounted router, not the path with its id', async () => {
    const operation = await operationOf(
      (app) => {
        const router = express.Router()
        router.post('/:id', (_req, res) => void res.json({}))
        app.use('/notes', router)
      },
      'post',
      '/notes/123e4567',
    )
    expect(operation).toBe('POST /notes/:id')
  })

  test('joins the mount paths of nested routers', async () => {
    const operation = await operationOf(
      (app) => {
        const inner = express.Router()
        inner.delete('/:image_id', (_req, res) => void res.json({}))
        const outer = express.Router()
        outer.use('/images', inner)
        app.use('/feed', outer)
      },
      'delete',
      '/feed/images/abc',
    )
    expect(operation).toBe('DELETE /feed/images/:image_id')
  })

  test('keeps the template when the handler fails and the error leaves the router', async () => {
    const operation = await operationOf(
      (app) => {
        const router = express.Router()
        router.post('/:id', () => {
          throw new Error('boom')
        })
        app.use('/notes', router)
      },
      'post',
      '/notes/42',
    )
    expect(operation).toBe('POST /notes/:id')
  })

  test('Express assigns req.route by plain assignment (trackRouteTemplate relies on it): nested router, next(err)', async () => {
    const operation = await operationOf(
      (app) => {
        const inner = express.Router()
        inner.post('/:id', (_req, _res, next) => next(new Error('boom')))
        const outer = express.Router()
        outer.use('/items', inner)
        app.use('/lists', outer)
      },
      'post',
      '/lists/items/42',
    )
    expect(operation).toBe('POST /lists/items/:id')
  })

  test('says no route when nothing matched', async () => {
    const operation = await operationOf(() => {}, 'post', '/nothing/here/42')
    expect(operation).toBe('POST (no route)')
  })
})

describe('unhandledErrorAudit', () => {
  test('keeps the route, status and error name, not the message', async () => {
    const app = express()
    let entry: ReturnType<typeof unhandledErrorAudit> | undefined
    app.use((req, _res, next) => {
      trackRouteTemplate(req)
      next()
    })
    const router = express.Router()
    router.post('/:id', () => {
      throw new TypeError('cannot read hunter2')
    })
    app.use('/notes', router)
    app.use((err: Error, req: Request, res: express.Response, _next: express.NextFunction) => {
      entry = unhandledErrorAudit(req, err, 500)
      res.status(500).json({})
    })
    await supertest(app).post('/notes/42')
    expect(entry).toEqual({
      details: { error_name: 'TypeError', error_type: 'server_error', status: 500 },
      message: 'POST /notes/:id',
    })
  })
})
