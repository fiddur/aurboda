/**
 * Resolve a user's avatar image: their uploaded avatar if present, otherwise a
 * deterministic identicon. Missing-database (unknown user) degrades to the
 * identicon rather than throwing, so an avatar always renders.
 */
import sharp from 'sharp'

import { getProfileAvatar, isMissingDatabase } from '../db/index.ts'
import { generateIdenticon, type StoredImage } from './avatar.ts'

export const loadAvatarImage = async (username: string): Promise<StoredImage> => {
  try {
    const stored = await getProfileAvatar(username)
    if (stored) return { content_type: stored.content_type, data: stored.data }
  } catch (error) {
    if (!isMissingDatabase(error)) throw error
  }
  return generateIdenticon(username)
}

/**
 * The avatar as a `data:` URI, for embedding in a rendered OG card. Always PNG:
 * Satori can't decode a WebP `<img>` data URI (stored avatars are WebP), so it
 * must be re-encoded to match the identicon path that renders reliably.
 */
export const loadAvatarDataUri = async (username: string): Promise<string> => {
  const image = await loadAvatarImage(username)
  const png = image.content_type === 'image/png' ? image.data : await sharp(image.data).png().toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}
