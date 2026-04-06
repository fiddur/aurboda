/**
 * Last.fm data sync module.
 *
 * Handles fetching scrobbles from Last.fm API and storing them in the database.
 * Also applies auto-tagging rules to create tags from scrobbles.
 */

import { subDays } from 'date-fns'

import {
  findMergeableTag,
  getAllScrobbles,
  getLastFmTagRules,
  getSyncState,
  hardDeleteTagsByExternalIdPrefix,
  hardDeleteTagsBySource,
  insertRawRecord,
  insertTag,
  type LastFmTagRule,
  type ScrobbleRecord,
  updateTagEndTime,
  upsertSyncState,
} from './db/index.ts'
import { lastfmClient, type Scrobble } from './lastfm.ts'
import { groupIntoSessions, type TimestampedEvent } from './session-grouping.ts'

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
        rule.match_mode === 'exact'
          ? normalize(scrobble.track) === normalize(rule.track_name)
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
 *
 * The session end time is extended by merge_gap_seconds to account for the
 * last track's duration, so that a single-scrobble session (e.g. a 30-minute
 * meditation track with merge_gap_seconds=1860) gets a meaningful span rather
 * than start_time === end_time.
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

      // Extend session end by merge_gap_seconds to account for last track duration.
      // The merge gap is configured per-rule and represents the expected track/session
      // length, so it serves as a reasonable duration estimate.
      const sessionEnd = new Date(session.endTime.getTime() + gapMs)

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
          await updateTagEndTime(user, existingTag.external_id!, sessionEnd)
          tagsCreated++
          continue
        }
      }

      const externalId = `lastfm-session-${rule.id}-${session.startTime.getTime()}`
      await insertTag(user, {
        end_time: sessionEnd,
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

/** Result of a re-tag operation */
export interface LastFmRetagResult {
  tags_deleted: number
  tags_created: number
}

/**
 * Convert a ScrobbleRecord (from raw_records DB) to a Scrobble (for rule matching).
 */
export const scrobbleRecordToScrobble = (record: ScrobbleRecord): Scrobble => ({
  album: record.album || undefined,
  artist: record.artist,
  timestamp: record.recorded_at,
  track: record.track,
})

/**
 * Apply a single rule retroactively to all existing scrobbles in raw_records.
 * Called after a new rule is created.
 */
export const applyRuleRetroactively = async (user: string, rule: LastFmTagRule): Promise<number> => {
  const records = await getAllScrobbles(user)
  if (records.length === 0) return 0

  const scrobbles = records.map(scrobbleRecordToScrobble)
  return applyTagRules(user, scrobbles, [rule])
}

/**
 * Hard-delete all tags generated by a specific rule.
 * Called before a rule is deleted.
 */
export const cleanupRuleTags = async (user: string, ruleId: string): Promise<number> => {
  const pointDeleted = await hardDeleteTagsByExternalIdPrefix(user, `lastfm-auto-${ruleId}-`)
  const sessionDeleted = await hardDeleteTagsByExternalIdPrefix(user, `lastfm-session-${ruleId}-`)
  return pointDeleted + sessionDeleted
}

/**
 * Delete all auto-generated Last.fm tags and reapply all rules from scratch.
 * Use when rules have changed and tags need a full refresh.
 */
export const retagAllScrobbles = async (user: string): Promise<LastFmRetagResult> => {
  const tagsDeleted = await hardDeleteTagsBySource(user, 'lastfm-auto')

  const [records, rules] = await Promise.all([getAllScrobbles(user), getLastFmTagRules(user)])

  if (records.length === 0 || rules.length === 0) {
    return { tags_created: 0, tags_deleted: tagsDeleted }
  }

  const scrobbles = records.map(scrobbleRecordToScrobble)
  const tagsCreated = await applyTagRules(user, scrobbles, rules)

  return { tags_created: tagsCreated, tags_deleted: tagsDeleted }
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
