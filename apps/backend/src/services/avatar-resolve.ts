/**
 * Resolve a user's avatar image: their uploaded avatar if present, otherwise a
 * deterministic identicon. Missing-database (unknown user) degrades to the
 * identicon rather than throwing, so an avatar always renders.
 */
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

/** The avatar as a `data:` URI, for embedding in a rendered OG card. */
export const loadAvatarDataUri = async (username: string): Promise<string> => {
  const image = await loadAvatarImage(username)
  return `data:${image.content_type};base64,${image.data.toString('base64')}`
}
