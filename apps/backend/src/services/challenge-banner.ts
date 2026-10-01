import type { ChallengeRecord } from '../db/index.ts'

import { buildBannerUrl } from './share-urls.ts'

export const bannerUrlFor = (
  record: Pick<ChallengeRecord, 'banner_updated_at' | 'slug'>,
  webHost: string,
  username: string,
): string | null =>
  record.banner_updated_at ? buildBannerUrl(webHost, username, record.slug, record.banner_updated_at) : null
