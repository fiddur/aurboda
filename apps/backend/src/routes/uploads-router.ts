import type { Request, RequestHandler, Response } from 'express'

import {
  type CreateUploadUrlBody,
  createUploadUrlBodySchema,
  type UploadResultResponse,
  type UploadTarget,
  type UploadUrlResponse,
} from '@aurboda/api-spec'
import { raw } from 'express'

import type { UploadUrlRecord } from '../db/index.ts'

import { singleUpload } from '../api/upload.ts'
import { isValidUsername } from '../services/account-signup.ts'
import {
  hashUploadToken,
  isUploadToken,
  mintUploadUrl,
  type MintUploadUrlDeps,
  UPLOAD_MAX_BYTES,
  UPLOAD_URL_GONE_MESSAGE,
  type UploadOutcome,
  uploadTooLargeMessage,
} from '../services/upload-urls.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

/** `POST /uploads`: mints an upload URL. Mounted with the other REST routers, behind the JSON parser. */
export const createUploadUrlRouter = (
  authMiddleware: AnyMiddleware,
  deps: MintUploadUrlDeps,
): TypedRouter => {
  const router = typedRouter()

  router.post<Record<string, never>, UploadUrlResponse, CreateUploadUrlBody>(
    '/',
    authMiddleware,
    validateBody(createUploadUrlBodySchema),
    async (req, res) => {
      const result = await mintUploadUrl(req.user!, req.body, deps)
      if (!result.ok) return res.status(result.status).json({ error: result.message, success: false })
      res.status(201).json({ data: result.value, success: true })
    },
  )

  return router
}

export interface UploadRouterDeps {
  /** An account is one with a per-user database. */
  userExists: (user: string) => Promise<boolean>
  isDeletedUser: (user: string) => boolean
  findLive: (user: string, tokenHash: string) => Promise<UploadUrlRecord | undefined>
  spend: (user: string, tokenHash: string) => Promise<UploadUrlRecord | undefined>
  run: (user: string, url: UploadUrlRecord, buffer: Buffer) => Promise<UploadOutcome>
}

const isHttpClientError = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500
}

const isTooLarge = (error: unknown): boolean =>
  (error as { type?: unknown } | null)?.type === 'entity.too.large'

/** The body parser for a target's limit: multipart for a POST that says so, the raw bytes otherwise. */
const bodyParserFor = (req: Request, target: UploadTarget): RequestHandler => {
  const limit = UPLOAD_MAX_BYTES[target]
  if (req.method === 'POST' && req.is('multipart/form-data')) {
    return singleUpload({
      field: 'file',
      fields: 2,
      fileSize: limit,
      tooLargeMessage: uploadTooLargeMessage(target),
    })
  }
  return raw({ limit, type: () => true })
}

const uploadedBytes = (req: Request): Buffer | undefined => {
  if (req.file) return req.file.buffer
  return Buffer.isBuffer(req.body) ? req.body : undefined
}

/**
 * `PUT` and `POST /uploads/:user/:token`, without the auth middleware: the token is the credential.
 * Mounted ahead of the global JSON parser, which would otherwise eat a body sent as JSON. The URL
 * is looked up first, since its target sets the size limit; it is spent only once the whole body
 * has arrived, so a body over the limit or an empty one leaves it usable.
 */
export const createUploadRouter = (deps: UploadRouterDeps): TypedRouter => {
  const router = typedRouter()

  const gone = (res: Response<UploadResultResponse>) =>
    res.status(404).json({ error: UPLOAD_URL_GONE_MESSAGE, success: false })

  for (const method of ['put', 'post'] as const) {
    router[method]<{ user: string; token: string }, UploadResultResponse>(
      '/:user/:token',
      async (req, res, next) => {
        const { token, user } = req.params
        if (!isValidUsername(user) || !isUploadToken(token) || deps.isDeletedUser(user)) return gone(res)
        if (!(await deps.userExists(user))) return gone(res)
        const tokenHash = hashUploadToken(token)
        const live = await deps.findLive(user, tokenHash)
        if (!live) return gone(res)

        const afterBody = async (error?: unknown) => {
          if (isTooLarge(error)) {
            return res.status(413).json({ error: uploadTooLargeMessage(live.target), success: false })
          }
          if (isHttpClientError(error)) {
            return res.status(400).json({ error: 'Invalid upload', success: false })
          }
          if (error) return next(error)
          const buffer = uploadedBytes(req)
          if (!buffer || buffer.length === 0) {
            return res.status(400).json({ error: 'No file uploaded', success: false })
          }
          const spent = await deps.spend(user, tokenHash)
          if (!spent) return gone(res)
          const outcome = await deps.run(user, spent, buffer)
          res.status(outcome.status).json(outcome.body)
        }

        bodyParserFor(req, live.target)(req, res, (error?: unknown) => {
          afterBody(error).catch(next)
        })
      },
    )
  }

  return router
}
