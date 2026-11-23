import { upsertProfileAvatar } from '../db/index.ts'
import { processAvatar, type StoredImage } from './avatar.ts'
import { buildProfileUrl } from './share-urls.ts'

/** Uploads of up to this size are accepted as a profile picture. */
export const PROFILE_AVATAR_MAX_BYTES = 10 * 1024 * 1024

export interface ProfileAvatarDeps {
  process: (buffer: Buffer) => Promise<StoredImage>
  upsert: (user: string, contentType: string, data: Buffer) => Promise<void>
}

export const defaultProfileAvatarDeps: ProfileAvatarDeps = {
  process: processAvatar,
  upsert: (user, contentType, data) => upsertProfileAvatar(user, contentType, data),
}

export type SetProfileAvatarResult = { ok: true; url: string } | { ok: false; reason: 'unsupported' }

export const profileAvatarUrl = (webHost: string, user: string): string =>
  `${buildProfileUrl(webHost, user)}/avatar.png`

/**
 * Stores the bytes as the profile picture once they decode as a PNG, JPEG, WebP or GIF, whatever
 * type the client claimed. The caller tells federation the profile changed.
 */
export const setProfileAvatar = async (
  user: string,
  buffer: Buffer,
  webHost: string,
  deps: ProfileAvatarDeps = defaultProfileAvatarDeps,
): Promise<SetProfileAvatarResult> => {
  let processed: StoredImage
  try {
    processed = await deps.process(buffer)
  } catch {
    return { ok: false, reason: 'unsupported' }
  }
  await deps.upsert(user, processed.content_type, processed.data)
  return { ok: true, url: profileAvatarUrl(webHost, user) }
}
