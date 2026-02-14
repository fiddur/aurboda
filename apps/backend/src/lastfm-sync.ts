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
  scrobblesProcessed: number
  tagsCreated: number
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
  if (rule.artistNames && rule.artistNames.length > 0) return rule.artistNames
  if (rule.artistName) return [rule.artistName]
  return undefined
}

/**
 * Check if a scrobble matches a tag rule.
 */
export const matchesRule = (scrobble: Scrobble, rule: LastFmTagRule): boolean => {
  switch (rule.matchType) {
    case 'track': {
      if (!rule.trackName) return false
      const normalize = (s: string) => s.toLowerCase().trim()
      if (rule.matchMode === 'exact') {
        return normalize(scrobble.track) === normalize(rule.trackName)
      }
      return normalize(scrobble.track).includes(normalize(rule.trackName))
    }

    case 'artist': {
      const names = getEffectiveArtistNames(rule)
      if (!names) return false
      return matchesAnyArtist(scrobble.artist, names, rule.matchMode)
    }

    case 'track_artist': {
      if (!rule.trackName) return false
      const names = getEffectiveArtistNames(rule)
      if (!names) return false

      const normalize = (s: string) => s.toLowerCase().trim()
      const trackMatch =
        rule.matchMode === 'exact' ?
          normalize(scrobble.track) === normalize(rule.trackName)
        : normalize(scrobble.track).includes(normalize(rule.trackName))
      const artistMatch = matchesAnyArtist(scrobble.artist, names, rule.matchMode)
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
        const tagKey = `${rule.tagName}|${scrobble.timestamp.toISOString()}`
        if (createdTags.has(tagKey)) continue
        createdTags.add(tagKey)

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
    const gapMs = rule.mergeGapSeconds! * 1000
    const matching: ScrobbleEvent[] = scrobbles
      .filter((s) => matchesRule(s, rule))
      .map((s) => ({ scrobble: s, timestamp: s.timestamp }))

    if (matching.length === 0) continue

    const sessions = groupIntoSessions(matching, gapMs)

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i]

      // For the first session, try cross-sync merging
      if (i === 0) {
        const existingTag = await findMergeableTag(
          user,
          rule.tagName,
          session.startTime,
          rule.mergeGapSeconds!,
          'lastfm-auto',
        )

        if (existingTag) {
          await updateTagEndTime(user, existingTag.externalId!, session.endTime)
          tagsCreated++
          continue
        }
      }

      const externalId = `lastfm-session-${rule.id}-${session.startTime.getTime()}`
      await insertTag(user, {
        endTime: session.endTime,
        externalId,
        source: 'lastfm-auto',
        startTime: session.startTime,
        tag: rule.tagName,
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

  const pointInTimeRules = rules.filter((r) => !r.mergeGapSeconds)
  const sessionRules = rules.filter((r) => r.mergeGapSeconds)

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
