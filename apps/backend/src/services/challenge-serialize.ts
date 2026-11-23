import type { Challenge } from '@aurboda/api-spec'

import type { ChallengeRecord } from '../db/index.ts'

import { bannerUrlFor } from './challenge-banner.ts'
import { announcementPending } from './challenge-results.ts'
import { specToApi } from './challenge-spec.ts'
import { buildShareUrl } from './share-urls.ts'
import { isPublicToVisibility } from './visibility.ts'

/** A hosted challenge as the REST API answers it. */
export const serializeChallenge = (
  record: ChallengeRecord,
  webHost: string,
  username: string,
): Challenge => ({
  announce_winner: record.announce_winner,
  announcement_pending: announcementPending(record, new Date()),
  banner_url: bannerUrlFor(record, webHost, username),
  created_at: record.created_at.toISOString(),
  end_ts: record.end_ts.toISOString(),
  id: record.id,
  name: record.name,
  result_published_at: record.result_published_at?.toISOString() ?? null,
  share_url: buildShareUrl(webHost, username, record.slug),
  slug: record.slug,
  spec: specToApi(record.spec),
  start_ts: record.start_ts.toISOString(),
  timezone: record.timezone,
  updated_at: record.updated_at.toISOString(),
  visibility: isPublicToVisibility(record.is_public),
})
