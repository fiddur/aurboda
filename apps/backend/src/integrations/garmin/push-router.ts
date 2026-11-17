import { json, type RequestHandler, Router } from 'express'

import { type GarminPushRequest, type GarminPushResult, isGarminPushToken } from './push.ts'

export interface GarminPushRouterDeps {
  receive: (request: GarminPushRequest) => Promise<GarminPushResult>
  enqueue: (job: () => Promise<void>) => unknown
  logError: (message: string) => void
}

/**
 * The large body limit Garmin's pushes need, granted only to a request that carries the
 * endpoint's token: anything else under the path is answered 404 before its body is read.
 */
export const garminPushBodyParser = (pushToken: string): RequestHandler => {
  const parse = json({ limit: '50mb' })
  return (req, res, next) => {
    const [token = '', ...rest] = req.path.split('/').filter(Boolean)
    if (rest.length > 0 || !isGarminPushToken(token, pushToken)) {
      res.status(404).end()
      return
    }
    parse(req, res, next)
  }
}

/** Answers with an empty body whatever happens, and logs no path: the path is the secret. */
export const createGarminPushRouter = (deps: GarminPushRouterDeps): Router => {
  const router = Router()

  router.post('/:token', async (req, res) => {
    let result: GarminPushResult
    try {
      result = await deps.receive({
        body: req.body,
        clientIdHeader: req.get('garmin-client-id'),
        token: req.params.token,
      })
    } catch (error) {
      deps.logError(`Garmin push failed: ${error instanceof Error ? error.message : String(error)}`)
      res.status(500).end()
      return
    }
    res.status(result.status).end()
    if (result.process) deps.enqueue(result.process)
  })

  return router
}
