import { FEED_IMAGE_MAX_EDGE, type FeedImage, MAX_FEED_IMAGES_PER_ACCOUNT } from '@aurboda/api-spec'
import sharp from 'sharp'

import type { FeedImageRecord, NewFeedImage } from '../db/index.ts'

import { countFeedImages, insertFeedImage } from '../db/index.ts'
import { assertAllowedFormat } from './avatar.ts'

export const UNSUPPORTED_PICTURE_MESSAGE =
  'That is not a picture Aurboda can use. PNG, JPEG, WebP or GIF works.'
export const PICTURE_TOO_LARGE_MESSAGE = 'That picture is too large to send.'
export const PICTURE_LIMIT_MESSAGE = `You have stored as many pictures as one account may hold (${MAX_FEED_IMAGES_PER_ACCOUNT}). Delete some first.`
export const PICTURE_NOT_FOUND_MESSAGE = 'Picture not found'

/**
 * Throws when the bytes are not a PNG, JPEG, WebP or GIF, whatever type the
 * client claimed. sharp writes no metadata unless asked to, so the EXIF block
 * (camera, GPS position) is dropped once `.rotate()` has applied its orientation.
 */
export const processFeedImage = async (buffer: Buffer): Promise<NewFeedImage> => {
  await assertAllowedFormat(buffer)
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({
      fit: 'inside',
      height: FEED_IMAGE_MAX_EDGE,
      width: FEED_IMAGE_MAX_EDGE,
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
  return { content_type: 'image/webp', data, height: info.height, width: info.width }
}

export const feedImageUrl = (apiBaseUrl: string, user: string, id: string): string =>
  `${apiBaseUrl}/public/${encodeURIComponent(user)}/images/${id}.webp`

export const serializeFeedImage = (apiBaseUrl: string, user: string, record: FeedImageRecord): FeedImage => ({
  byte_size: record.byte_size,
  created_at: record.created_at.toISOString(),
  height: record.height,
  id: record.id,
  url: feedImageUrl(apiBaseUrl, user, record.id),
  width: record.width,
})

export interface AddFeedImageDeps {
  countFeedImages: (user: string) => Promise<number>
  insertFeedImage: (user: string, image: NewFeedImage) => Promise<FeedImageRecord>
  processFeedImage: (buffer: Buffer) => Promise<NewFeedImage>
}

export const defaultAddFeedImageDeps: AddFeedImageDeps = {
  countFeedImages: (user) => countFeedImages(user),
  insertFeedImage: (user, image) => insertFeedImage(user, image),
  processFeedImage,
}

export type AddFeedImageResult =
  | { ok: true; image: FeedImageRecord }
  | { ok: false; reason: 'limit' | 'unsupported' }

export const addFeedImage = async (
  user: string,
  buffer: Buffer,
  deps: AddFeedImageDeps,
): Promise<AddFeedImageResult> => {
  if ((await deps.countFeedImages(user)) >= MAX_FEED_IMAGES_PER_ACCOUNT) return { ok: false, reason: 'limit' }
  let processed: NewFeedImage
  try {
    processed = await deps.processFeedImage(buffer)
  } catch {
    return { ok: false, reason: 'unsupported' }
  }
  return { image: await deps.insertFeedImage(user, processed), ok: true }
}

export const addFeedImageFailureMessage = (reason: 'limit' | 'unsupported'): string =>
  reason === 'limit' ? PICTURE_LIMIT_MESSAGE : UNSUPPORTED_PICTURE_MESSAGE
