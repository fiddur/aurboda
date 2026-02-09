/**
 * Last.fm data sync module.
 *
 * Handles fetching scrobbles from Last.fm API and storing them in the database.
 * Also applies auto-tagging rules to create tags from scrobbles.
 */

import { subDays } from 'date-fns'
import {
  getLastFmTagRules,
  getSyncState,
  insertRawRecord,
  insertTag,
  type LastFmTagRule,
  upsertSyncState,
} from './db'
import { lastfmClient, type Scrobble } from './lastfm'

/** Default start date for historical sync (30 days back) */
const DEFAULT_SYNC_HISTORY_DAYS = 30

/** Result of a sync operation */
export interface LastFmSyncResult {
  scrobblesProcessed: number
  tagsCreated: number
  status: 'success' | 'skipped' | 'error'
  error?: string
}

/**
 * Check if a scrobble matches a tag rule.
 */
export const matchesRule = (scrobble: Scrobble, rule: LastFmTagRule): boolean => {
  const normalize = (s: string) => s.toLowerCase().trim()

  switch (rule.matchType) {
    case 'track': {
      if (!rule.trackName) return false
      if (rule.matchMode === 'exact') {
        return normalize(scrobble.track) === normalize(rule.trackName)
      }
      return normalize(scrobble.track).includes(normalize(rule.trackName))
    }

    case 'artist': {
      if (!rule.artistName) return false
      if (rule.matchMode === 'exact') {
        return normalize(scrobble.artist) === normalize(rule.artistName)
      }
      return normalize(scrobble.artist).includes(normalize(rule.artistName))
    }

    case 'track_artist': {
      if (!rule.trackName || !rule.artistName) return false
      const trackMatch =
        rule.matchMode === 'exact' ?
          normalize(scrobble.track) === normalize(rule.trackName)
        : normalize(scrobble.track).includes(normalize(rule.trackName))
      const artistMatch =
        rule.matchMode === 'exact' ?
          normalize(scrobble.artist) === normalize(rule.artistName)
        : normalize(scrobble.artist).includes(normalize(rule.artistName))
      return trackMatch && artistMatch
    }

    default:
      return false
  }
}

/**
 * Apply tag rules to scrobbles and create tags.
 * Returns the number of tags created.
 */
export const applyTagRules = async (
  user: string,
  scrobbles: Scrobble[],
  rules: LastFmTagRule[],
): Promise<number> => {
  if (rules.length === 0) return 0

  let tagsCreated = 0

  // Track which tags we've created to avoid duplicates within the same sync
  const createdTags = new Set<string>()

  for (const scrobble of scrobbles) {
    for (const rule of rules) {
      if (matchesRule(scrobble, rule)) {
        // Create a unique key for deduplication: tagName + timestamp
        const tagKey = `${rule.tagName}|${scrobble.timestamp.toISOString()}`
        if (createdTags.has(tagKey)) continue
        createdTags.add(tagKey)

        // Create external_id from scrobble details for deduplication
        const externalId = `lastfm-auto-${rule.id}-${scrobble.timestamp.getTime()}`

        await insertTag(user, {
          externalId,
          source: 'lastfm-auto',
          startTime: scrobble.timestamp,
          tag: rule.tagName,
        })
        tagsCreated++
      }
    }
  }

  return tagsCreated
}

/**
 * Sync Last.fm scrobbles for a user.
 */
export const syncLastFmData = async (
  user: string,
  apiKey: string,
  username: string,
  options: { fullResync?: boolean; startDate?: Date } = {},
): Promise<LastFmSyncResult> => {
  const dataType = 'scrobbles'

  // Check current sync state
  const syncState = await getSyncState(user, 'lastfm', dataType)

  // Determine date range
  const end = new Date()
  let start: Date

  if (options.fullResync || !syncState?.lastSyncTime) {
    start = options.startDate || subDays(end, DEFAULT_SYNC_HISTORY_DAYS)
  } else {
    start = syncState.lastSyncTime
  }

  // Mark as syncing
  await upsertSyncState(user, {
    dataType,
    provider: 'lastfm',
    status: 'syncing',
    syncStartDate: start,
  })

  try {
    const client = lastfmClient(apiKey)
    const scrobbles = await client.getRecentTracks(username, start, end)

    // Store raw scrobbles
    for (const scrobble of scrobbles) {
      const externalId = `${scrobble.timestamp.getTime()}-${scrobble.track}-${scrobble.artist}`
      await insertRawRecord(user, {
        data: {
          album: scrobble.album,
          albumMbid: scrobble.albumMbid,
          artist: scrobble.artist,
          artistMbid: scrobble.artistMbid,
          mbid: scrobble.mbid,
          track: scrobble.track,
        },
        externalId,
        recordType: 'scrobble',
        recordedAt: scrobble.timestamp,
        source: 'lastfm',
      })
    }

    // Apply tag rules
    const rules = await getLastFmTagRules(user)
    const tagsCreated = await applyTagRules(user, scrobbles, rules)

    // Update sync state on success
    await upsertSyncState(user, {
      dataType,
      lastSyncTime: end,
      provider: 'lastfm',
      status: 'idle',
    })

    return {
      scrobblesProcessed: scrobbles.length,
      status: 'success',
      tagsCreated,
    }
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number; data?: unknown } }

    // Handle specific API errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const statusCode = axiosError.response?.status

    await upsertSyncState(user, {
      dataType,
      errorMessage: `${errorMessage}${statusCode ? ` (HTTP ${statusCode})` : ''}`,
      provider: 'lastfm',
      status: 'error',
    })

    return {
      error: errorMessage,
      scrobblesProcessed: 0,
      status: 'error',
      tagsCreated: 0,
    }
  }
}
