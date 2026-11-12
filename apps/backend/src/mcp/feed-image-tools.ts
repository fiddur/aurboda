/** Mirrors the REST `/feed/images` capabilities. */
import { addFeedImageInputSchema, MAX_FEED_IMAGE_BYTES, MAX_FEED_IMAGES_PER_ACCOUNT } from '@aurboda/api-spec'
import { z } from 'zod'

import type { FeedImageRecord } from '../db/index.ts'

import { deleteFeedImage, listFeedImages } from '../db/index.ts'
import {
  addFeedImage,
  addFeedImageFailureMessage,
  type AddFeedImageResult,
  defaultAddFeedImageDeps,
  PICTURE_NOT_FOUND_MESSAGE,
  PICTURE_TOO_LARGE_MESSAGE,
  serializeFeedImage,
} from '../services/feed-image.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export interface FeedImageToolsDeps {
  apiBaseUrl?: string
  addFeedImage?: (user: string, buffer: Buffer) => Promise<AddFeedImageResult>
  listFeedImages?: (user: string) => Promise<FeedImageRecord[]>
  deleteFeedImage?: (user: string, id: string) => Promise<boolean>
}

export const registerFeedImageTools = (server: McpServer, user: string, deps: FeedImageToolsDeps = {}) => {
  const add =
    deps.addFeedImage ?? ((u: string, buffer: Buffer) => addFeedImage(u, buffer, defaultAddFeedImageDeps))
  const list = deps.listFeedImages ?? ((u: string) => listFeedImages(u))
  const remove = deps.deleteFeedImage ?? ((u: string, id: string) => deleteFeedImage(u, id))

  server.tool(
    'add_feed_image',
    `Store a picture and get back its public URL, to put in markdown as \`![description](url)\` in an article's prose, a comment or an activity description. The picture is stored as WebP with its longest edge at most 1600 px, turned upright and without its metadata (no camera or GPS position); an animated GIF keeps its first frame. Anyone with the URL can see the picture. One account may store ${MAX_FEED_IMAGES_PER_ACCOUNT} pictures. Returns { id, url, width, height, byte_size, created_at }.`,
    { ...addFeedImageInputSchema.shape },
    async ({ data_base64 }) => {
      if (!deps.apiBaseUrl) return errorResponse('Pictures are not available')
      const buffer = Buffer.from(data_base64, 'base64')
      if (buffer.length > MAX_FEED_IMAGE_BYTES) return errorResponse(PICTURE_TOO_LARGE_MESSAGE)
      const result = await add(user, buffer)
      if (!result.ok) return errorResponse(addFeedImageFailureMessage(result.reason))
      return jsonResponse(serializeFeedImage(deps.apiBaseUrl, user, result.image))
    },
  )

  server.tool(
    'list_feed_images',
    'List the pictures you have stored for what you write, newest first, with how many one account may store.',
    {},
    async () => {
      if (!deps.apiBaseUrl) return errorResponse('Pictures are not available')
      const apiBaseUrl = deps.apiBaseUrl
      const images = await list(user)
      return jsonResponse({
        images: images.map((image) => serializeFeedImage(apiBaseUrl, user, image)),
        limit: MAX_FEED_IMAGES_PER_ACCOUNT,
      })
    },
  )

  server.tool(
    'delete_feed_image',
    'Delete a stored picture. Markdown that still embeds its URL shows a broken picture afterwards.',
    { id: z.string().uuid().describe('Picture ID') },
    async ({ id }) => {
      if (!(await remove(user, id))) return errorResponse(PICTURE_NOT_FOUND_MESSAGE)
      return jsonResponse({ success: true })
    },
  )
}
