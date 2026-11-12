import type { RequestHandler } from 'express'

import {
  type BaseResponse,
  type FeedImageResponse,
  type FeedImagesResponse,
  MAX_FEED_IMAGE_BYTES,
  MAX_FEED_IMAGES_PER_ACCOUNT,
} from '@aurboda/api-spec'
import multer from 'multer'

import type { FeedImageRecord } from '../db/index.ts'

import { deleteFeedImage, listFeedImages } from '../db/index.ts'
import { isAllowedImageType } from '../services/avatar.ts'
import {
  addFeedImage,
  addFeedImageFailureMessage,
  type AddFeedImageResult,
  defaultAddFeedImageDeps,
  PICTURE_NOT_FOUND_MESSAGE,
  PICTURE_TOO_LARGE_MESSAGE,
  serializeFeedImage,
  UNSUPPORTED_PICTURE_MESSAGE,
} from '../services/feed-image.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

export interface FeedImagesRouterDeps {
  addFeedImage: (user: string, buffer: Buffer) => Promise<AddFeedImageResult>
  listFeedImages: (user: string) => Promise<FeedImageRecord[]>
  deleteFeedImage: (user: string, id: string) => Promise<boolean>
}

const defaultDeps: FeedImagesRouterDeps = {
  addFeedImage: (user, buffer) => addFeedImage(user, buffer, defaultAddFeedImageDeps),
  deleteFeedImage: (user, id) => deleteFeedImage(user, id),
  listFeedImages: (user) => listFeedImages(user),
}

const imageUpload = multer({
  limits: { fileSize: MAX_FEED_IMAGE_BYTES },
  storage: multer.memoryStorage(),
})

const FAILURE_STATUS = { limit: 409, unsupported: 415 } as const

export const createFeedImagesRouter = (
  authMiddleware: RequestHandler,
  apiBaseUrl: string,
  deps: FeedImagesRouterDeps = defaultDeps,
): TypedRouter => {
  const router = typedRouter()

  router.post<Record<string, never>, FeedImageResponse>(
    '/',
    authMiddleware,
    (req, res, next) =>
      imageUpload.single('image')(req, res, (error: unknown) => {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: PICTURE_TOO_LARGE_MESSAGE, success: false })
        }
        next(error)
      }),
    async (req, res) => {
      const user = req.user!
      const file = req.file
      if (!file) return res.status(400).json({ error: 'No file uploaded', success: false })
      if (!isAllowedImageType(file.mimetype)) {
        return res.status(415).json({ error: UNSUPPORTED_PICTURE_MESSAGE, success: false })
      }
      const result = await deps.addFeedImage(user, file.buffer)
      if (!result.ok) {
        return res
          .status(FAILURE_STATUS[result.reason])
          .json({ error: addFeedImageFailureMessage(result.reason), success: false })
      }
      res.status(201).json({ image: serializeFeedImage(apiBaseUrl, user, result.image), success: true })
    },
  )

  router.get<Record<string, never>, FeedImagesResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const images = await deps.listFeedImages(user)
    res.json({
      images: images.map((image) => serializeFeedImage(apiBaseUrl, user, image)),
      limit: MAX_FEED_IMAGES_PER_ACCOUNT,
      success: true,
    })
  })

  router.delete<{ id: string }, BaseResponse>('/:id', authMiddleware, async (req, res) => {
    if (!(await deps.deleteFeedImage(req.user!, req.params.id))) {
      return res.status(404).json({ error: PICTURE_NOT_FOUND_MESSAGE, success: false })
    }
    res.json({ success: true })
  })

  return router
}
