import type { MediaPlay, MediaPlayInput, MediaPlaySource, MediaSyncResult } from '@aurboda/api-spec'

import {
  dedupeAgainstLastfm,
  mprisRecordToPlay,
  playInputToRecordData,
  playRange,
  scrobbleRecordToPlay,
} from '../services/media-plays.ts'
import { query } from './connection.ts'
import { insertRawRecords } from './raw-records.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const DEDUP_MARGIN_MS = 10 * 60 * 1000

export const storeMediaPlays = async (
  user: string,
  plays: MediaPlayInput[],
  deviceName: string | undefined,
): Promise<MediaSyncResult> => {
  await insertRawRecords(
    user,
    plays.map((play) => ({
      data: playInputToRecordData(play, deviceName),
      external_id: play.id,
      record_type: 'media_play',
      recorded_at: new Date(play.started_at),
      source: 'mpris',
    })),
  )
  return { plays_received: plays.length, plays_stored: new Set(plays.map((p) => p.id)).size }
}

const queryMprisPlays = async (user: string, window: { start: Date; end: Date }): Promise<MediaPlay[]> => {
  const result = await query(
    user,
    `SELECT external_id, data FROM raw_records
     WHERE source = 'mpris' AND record_type = 'media_play'
       AND recorded_at >= $1 AND recorded_at < $2
     ORDER BY recorded_at`,
    [new Date(window.start.getTime() - DAY_MS), new Date(window.end.getTime() + DEDUP_MARGIN_MS)],
  )
  return result.rows.map((r) => mprisRecordToPlay(r.external_id as string, r.data ?? {}))
}

const queryScrobbles = async (user: string, window: { start: Date; end: Date }): Promise<MediaPlay[]> => {
  const result = await query(
    user,
    `SELECT external_id, recorded_at, data FROM raw_records
     WHERE source = 'lastfm' AND record_type = 'scrobble'
       AND recorded_at >= $1 AND recorded_at < $2
     ORDER BY recorded_at`,
    [new Date(window.start.getTime() - DEDUP_MARGIN_MS), new Date(window.end.getTime() + DEDUP_MARGIN_MS)],
  )
  return result.rows.map((r) =>
    scrobbleRecordToPlay(r.external_id as string, r.recorded_at as Date, r.data ?? {}),
  )
}

/**
 * Plays in [start, end): MPRIS plays overlapping it plus the Last.fm scrobbles starting in it.
 * Without a source an MPRIS play hides its duplicate scrobble; with one, only that source is read and
 * nothing is deduplicated, so `lastfm` keeps every scrobble.
 */
export const getMediaPlays = async (
  user: string,
  window: { start: Date; end: Date },
  options: { source?: MediaPlaySource } = {},
): Promise<MediaPlay[]> => {
  const mpris = options.source === 'lastfm' ? [] : await queryMprisPlays(user, window)
  const lastfm = options.source === 'mpris' ? [] : await queryScrobbles(user, window)

  return dedupeAgainstLastfm(mpris, lastfm).filter((play) => {
    const range = playRange(play)
    if (play.source === 'lastfm') return range.start >= window.start && range.start < window.end
    return range.start < window.end && range.end > window.start
  })
}

export const getMediaPlayById = async (user: string, id: string): Promise<MediaPlay | null> => {
  const mprisResult = await query(
    user,
    `SELECT external_id, data FROM raw_records
     WHERE source = 'mpris' AND record_type = 'media_play' AND external_id = $1
     LIMIT 1`,
    [id],
  )
  const mpris = mprisResult.rows[0]
  if (mpris) return mprisRecordToPlay(mpris.external_id as string, mpris.data ?? {})

  const scrobbleResult = await query(
    user,
    `SELECT external_id, recorded_at, data FROM raw_records
     WHERE source = 'lastfm' AND record_type = 'scrobble' AND external_id = $1
     LIMIT 1`,
    [id],
  )
  const scrobble = scrobbleResult.rows[0]
  return scrobble
    ? scrobbleRecordToPlay(scrobble.external_id as string, scrobble.recorded_at as Date, scrobble.data ?? {})
    : null
}
