import type { QuantChallengeThread, QuantError } from '@aurboda/api-spec'
import type { Federation } from '@fedify/fedify'
import type { Request } from 'express'

import {
  buildThreadDocument,
  createThreadDocumentDeps,
  type ThreadDocumentDeps,
} from '../services/challenge-thread-remote.ts'
import { type LoadChallenge, loadHostedChallenge } from '../services/challenge-thread.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

export type SignedActorOf = (req: Request) => Promise<string | null>

/**
 * The actor whose key signed the request, verified by Fedify (signature and key ownership); null
 * when it is unsigned or the signature does not hold. The URL is rebuilt the way
 * `@fedify/express` does, so it is the external URL the signer signed.
 */
export const createSignedActorOf =
  (federation: Federation<void>): SignedActorOf =>
  async (req) => {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(key, item)
      else if (typeof value === 'string') headers.append(key, value)
    }
    try {
      const request = new Request(`${req.protocol}://${req.host}${req.originalUrl}`, {
        headers,
        method: req.method,
      })
      const owner = await federation.createContext(request, undefined).getSignedKeyOwner()
      return owner?.id?.href ?? null
    } catch {
      return null
    }
  }

export interface ChallengeThreadFederationRouterConfig {
  signedActorOf: SignedActorOf
  webHost: string
  loadChallenge?: LoadChallenge
  document?: ThreadDocumentDeps
}

/**
 * `GET /users/:username/challenges/:slug/thread`: a hosted challenge's thread document for the
 * signer of the request. Under `/users/`, outside the API base, so the URL a member's server signs
 * is the URL this server sees.
 */
export const createChallengeThreadFederationRouter = (
  config: ChallengeThreadFederationRouterConfig,
): TypedRouter => {
  const router = typedRouter()
  const loadChallenge = config.loadChallenge ?? loadHostedChallenge
  const document = config.document ?? createThreadDocumentDeps(config.webHost)

  router.get<{ username: string; slug: string }, QuantChallengeThread | QuantError>(
    '/users/:username/challenges/:slug/thread',
    async (req, res) => {
      const { slug, username } = req.params
      res.setHeader('Cache-Control', 'no-store')
      const challenge = await loadChallenge(username, slug)
      if (challenge == null) return res.status(404).json({ error: 'Challenge not found' })
      const signer = await config.signedActorOf(req)
      res.json(await buildThreadDocument(document, username, challenge, signer))
    },
  )

  return router
}
