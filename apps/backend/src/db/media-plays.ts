import type { MediaPlay, MediaPlayInput, MediaSyncResult } from '@aurboda/api-spec'

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

/** Plays overlapping [start, end): MPRIS plays plus the Last.fm scrobbles they do not duplicate. */
export const getMediaPlays = async (
  user: string,
  window: { start: Date; end: Date },
): Promise<MediaPlay[]> => {
  const mprisResult = await query(
    user,
    `SELECT external_id, data FROM raw_records
     WHERE source = 'mpris' AND record_type = 'media_play'
       AND recorded_at >= $1 AND recorded_at < $2
     ORDER BY recorded_at`,
    [new Date(window.start.getTime() - DAY_MS), new Date(window.end.getTime() + DEDUP_MARGIN_MS)],
  )
  const scrobbleResult = await query(
    user,
    `SELECT external_id, recorded_at, data FROM raw_records
     WHERE source = 'lastfm' AND record_type = 'scrobble'
       AND recorded_at >= $1 AND recorded_at < $2
     ORDER BY recorded_at`,
    [new Date(window.start.getTime() - DEDUP_MARGIN_MS), new Date(window.end.getTime() + DEDUP_MARGIN_MS)],
  )

  const mpris = mprisResult.rows.map((r) => mprisRecordToPlay(r.external_id as string, r.data ?? {}))
  const lastfm = scrobbleResult.rows.map((r) =>
    scrobbleRecordToPlay(r.external_id as string, r.recorded_at as Date, r.data ?? {}),
  )

  return dedupeAgainstLastfm(mpris, lastfm).filter((play) => {
    const range = playRange(play)
    if (play.source === 'lastfm') return range.start >= window.start && range.start < window.end
    return range.start < window.end && range.end > window.start
  })
}
