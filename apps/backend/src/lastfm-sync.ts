/**
 * Last.fm data sync module.
 *
 * Handles fetching scrobbles from Last.fm API and storing them in the database.
 * Also applies auto-tagging rules to create tags from scrobbles.
 */

import { subDays } from 'date-fns'
import {
  findMergeableTag,
  getLastFmTagRules,
  getSyncState,
  insertRawRecord,
  insertTag,
  type LastFmTagRule,
  updateTagEndTime,
  upsertSyncState,
} from './db'
import { lastfmClient, type Scrobble } from './lastfm'
import { groupIntoSessions, type TimestampedEvent } from './session-grouping'

/** Default start date for historical sync (30 days back) */
const DEFAULT_SYNC_HISTORY_DAYS = 30

/** Result of a sync operation */
export interface LastFmSyncResult {
  scrobbles_processed: number
  tags_created: number
  status: 'success' | 'skipped' | 'error'
  error?: string
}

/**
 * Check if a scrobble's artist matches one of the given names using the specified mode.
 */
const matchesAnyArtist = (scrobbleArtist: string, names: string[], mode: 'exact' | 'contains'): boolean => {
  const normalized = scrobbleArtist.toLowerCase().trim()
  return names.some((name) => {
    const normalizedName = name.toLowerCase().trim()
    return mode === 'exact' ? normalized === normalizedName : normalized.includes(normalizedName)
  })
}

/**
 * Get the effective artist names for a rule, preferring artistNames over artistName.
 */
const getEffectiveArtistNames = (rule: LastFmTagRule): string[] | undefined => {
  if (rule.artist_names && rule.artist_names.length > 0) return rule.artist_names
  if (rule.artist_name) return [rule.artist_name]
  return undefined
}

/**
 * Check if a scrobble matches a tag rule.
 */
export const matchesRule = (scrobble: Scrobble, rule: LastFmTagRule): boolean => {
  switch (rule.match_type) {
    case 'track': {
      if (!rule.track_name) return false
      const normalize = (s: string) => s.toLowerCase().trim()
      if (rule.match_mode === 'exact') {
        return normalize(scrobble.track) === normalize(rule.track_name)
      }
      return normalize(scrobble.track).includes(normalize(rule.track_name))
    }

    case 'artist': {
      const names = getEffectiveArtistNames(rule)
      if (!names) return false
      return matchesAnyArtist(scrobble.artist, names, rule.match_mode)
    }

    case 'track_artist': {
      if (!rule.track_name) return false
      const names = getEffectiveArtistNames(rule)
      if (!names) return false

      const normalize = (s: string) => s.toLowerCase().trim()
      const trackMatch =
        rule.match_mode === 'exact' ?
          normalize(scrobble.track) === normalize(rule.track_name)
        : normalize(scrobble.track).includes(normalize(rule.track_name))
      const artistMatch = matchesAnyArtist(scrobble.artist, names, rule.match_mode)
      return trackMatch && artistMatch
    }

    default:
      return false
  }
}

/**
 * Apply point-in-time rules (rules without mergeGapSeconds) to scrobbles.
 */
const applyPointInTimeRules = async (
  user: string,
  scrobbles: Scrobble[],
  rules: LastFmTagRule[],
): Promise<number> => {
  let tagsCreated = 0
  const createdTags = new Set<string>()

  for (const scrobble of scrobbles) {
    for (const rule of rules) {
      if (matchesRule(scrobble, rule)) {
        const tagKey = `${rule.tag_name}|${scrobble.timestamp.toISOString()}`
        if (createdTags.has(tagKey)) continue
        createdTags.add(tagKey)

        const externalId = `lastfm-auto-${rule.id}-${scrobble.timestamp.getTime()}`
        await insertTag(user, {
          external_id: externalId,
          source: 'lastfm-auto',
          start_time: scrobble.timestamp,
          tag: rule.tag_name,
        })
        tagsCreated++
      }
    }
  }

  return tagsCreated
}

interface ScrobbleEvent extends TimestampedEvent {
  readonly scrobble: Scrobble
}

/**
 * Apply session rules (rules with mergeGapSeconds) to scrobbles.
 * Groups matching scrobbles into sessions and creates span tags.
 */
const applySessionRules = async (
  user: string,
  scrobbles: Scrobble[],
  rules: LastFmTagRule[],
): Promise<number> => {
  let tagsCreated = 0

  for (const rule of rules) {
    const gapMs = rule.merge_gap_seconds! * 1000
    const matching: ScrobbleEvent[] = scrobbles
      .filter((s) => matchesRule(s, rule))
      .map((s) => ({ scrobble: s, timestamp: s.timestamp }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    if (matching.length === 0) continue

    const sessions = groupIntoSessions(matching, gapMs)

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i]

      // For the first session, try cross-sync merging
      if (i === 0) {
        const existingTag = await findMergeableTag(
          user,
          rule.tag_name,
          session.startTime,
          rule.merge_gap_seconds!,
          'lastfm-auto',
        )

        if (existingTag) {
          await updateTagEndTime(user, existingTag.external_id!, session.endTime)
          tagsCreated++
          continue
        }
      }

      const externalId = `lastfm-session-${rule.id}-${session.startTime.getTime()}`
      await insertTag(user, {
        end_time: session.endTime,
        external_id: externalId,
        source: 'lastfm-auto',
        start_time: session.startTime,
        tag: rule.tag_name,
      })
      tagsCreated++
    }
  }

  return tagsCreated
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

  const pointInTimeRules = rules.filter((r) => !r.merge_gap_seconds)
  const sessionRules = rules.filter((r) => r.merge_gap_seconds)

  const pointTags = await applyPointInTimeRules(user, scrobbles, pointInTimeRules)
  const sessionTags = await applySessionRules(user, scrobbles, sessionRules)

  return pointTags + sessionTags
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

  if (options.fullResync || !syncState?.last_sync_time) {
    start = options.startDate || subDays(end, DEFAULT_SYNC_HISTORY_DAYS)
  } else {
    start = syncState.last_sync_time
  }

  // Mark as syncing
  await upsertSyncState(user, {
    data_type: dataType,
    provider: 'lastfm',
    status: 'syncing',
    sync_start_date: start,
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
        external_id: externalId,
        record_type: 'scrobble',
        recorded_at: scrobble.timestamp,
        source: 'lastfm',
      })
    }

    // Apply tag rules
    const rules = await getLastFmTagRules(user)
    const tagsCreated = await applyTagRules(user, scrobbles, rules)

    // Update sync state on success
    await upsertSyncState(user, {
      data_type: dataType,
      last_sync_time: end,
      provider: 'lastfm',
      status: 'idle',
    })

    return {
      scrobbles_processed: scrobbles.length,
      status: 'success',
      tags_created: tagsCreated,
    }
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number; data?: unknown } }

    // Handle specific API errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const statusCode = axiosError.response?.status

    await upsertSyncState(user, {
      data_type: dataType,
      error_message: `${errorMessage}${statusCode ? ` (HTTP ${statusCode})` : ''}`,
      provider: 'lastfm',
      status: 'error',
    })

    return {
      error: errorMessage,
      scrobbles_processed: 0,
      status: 'error',
      tags_created: 0,
    }
  }
}
