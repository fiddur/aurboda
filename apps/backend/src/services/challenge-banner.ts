import type { ChallengeRecord } from '../db/index.ts'

import { getChallengeById, upsertChallengeBanner } from '../db/index.ts'
import { processBanner, type StoredImage } from './avatar.ts'
import { buildBannerUrl } from './share-urls.ts'

export const bannerUrlFor = (
  record: Pick<ChallengeRecord, 'banner_updated_at' | 'slug'>,
  webHost: string,
  username: string,
): string | null =>
  record.banner_updated_at ? buildBannerUrl(webHost, username, record.slug, record.banner_updated_at) : null

/** Uploads of up to this size are accepted as a challenge banner. */
export const CHALLENGE_BANNER_MAX_BYTES = 10 * 1024 * 1024

export interface ChallengeBannerDeps {
  getChallenge: (user: string, id: string) => Promise<ChallengeRecord | null>
  process: (buffer: Buffer) => Promise<StoredImage>
  upsert: (user: string, challengeId: string, contentType: string, data: Buffer) => Promise<void>
}

export const defaultChallengeBannerDeps: ChallengeBannerDeps = {
  getChallenge: (user, id) => getChallengeById(user, id),
  process: processBanner,
  upsert: (user, challengeId, contentType, data) =>
    upsertChallengeBanner(user, challengeId, contentType, data),
}

export type SetChallengeBannerResult =
  | { ok: true; record: ChallengeRecord }
  | { ok: false; reason: 'not_found' | 'unsupported' }

/**
 * Stores the bytes as the banner of one of the user's hosted challenges once they decode as a PNG,
 * JPEG, WebP or GIF, whatever type the client claimed. Answers the challenge as it now is.
 */
export const setChallengeBanner = async (
  user: string,
  challengeId: string,
  buffer: Buffer,
  deps: ChallengeBannerDeps = defaultChallengeBannerDeps,
): Promise<SetChallengeBannerResult> => {
  if (!(await deps.getChallenge(user, challengeId))) return { ok: false, reason: 'not_found' }
  let processed: StoredImage
  try {
    processed = await deps.process(buffer)
  } catch {
    return { ok: false, reason: 'unsupported' }
  }
  await deps.upsert(user, challengeId, processed.content_type, processed.data)
  const record = await deps.getChallenge(user, challengeId)
  return record ? { ok: true, record } : { ok: false, reason: 'not_found' }
}
