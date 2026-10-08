import type {
  ActivityTrackInput,
  GarminBackfillCandidate,
  StravaBackfillCandidate,
  TrackBackfillPage,
} from '../db/tracks.ts'

import {
  getGarminTrackBackfillCandidates,
  getStravaTrackBackfillCandidates,
  upsertActivityTrack,
} from '../db/tracks.ts'
import { extractTrackPoints } from '../integrations/garmin/process.ts'
import { auditError } from './audit-log.ts'
import { buildTrack, decodePolyline, polylineToTrackPoints, type TrackPoint } from './tracks.ts'

export interface TrackBackfillDeps {
  getGarminCandidates: (user: string, page: TrackBackfillPage) => Promise<GarminBackfillCandidate[]>
  getStravaCandidates: (user: string, page: TrackBackfillPage) => Promise<StravaBackfillCandidate[]>
  upsertActivityTrack: (user: string, input: ActivityTrackInput) => Promise<void>
}

export const defaultTrackBackfillDeps: TrackBackfillDeps = {
  getGarminCandidates: getGarminTrackBackfillCandidates,
  getStravaCandidates: getStravaTrackBackfillCandidates,
  upsertActivityTrack,
}

export interface TrackBackfillResult {
  garmin: number
  strava: number
  skipped: number
}

/**
 * Pages through candidates oldest first. The cursor is what keeps a candidate
 * that yields no track (and so stays a candidate) from being fetched forever.
 */
const backfillSource = async <C extends { activity_id: string; start_time: Date }>(
  user: string,
  source: 'garmin' | 'strava',
  fetchPage: (page: TrackBackfillPage) => Promise<C[]>,
  toPoints: (candidate: C) => TrackPoint[],
  fullResolution: boolean,
  upsert: TrackBackfillDeps['upsertActivityTrack'],
  batch: number,
): Promise<{ written: number; skipped: number }> => {
  let written = 0
  let skipped = 0
  let after: Date | undefined
  for (;;) {
    const page = await fetchPage({ after, limit: batch })
    for (const candidate of page) {
      try {
        const track = buildTrack(toPoints(candidate), candidate.start_time)
        if (!track) {
          skipped++
          continue
        }
        await upsert(user, {
          activity_id: candidate.activity_id,
          ewkt: track.ewkt,
          full_resolution: fullResolution,
          source,
        })
        written++
      } catch (error) {
        skipped++
        auditError(user, 'data', `Track backfill failed for ${source} activity ${candidate.activity_id}`, {
          error: String(error),
        })
      }
    }
    const last = page.at(-1)
    if (!last || page.length < batch) break
    after = last.start_time
  }
  return { skipped, written }
}

export const backfillUserTracks = async (
  user: string,
  deps: TrackBackfillDeps,
  batch = 50,
): Promise<TrackBackfillResult> => {
  const garmin = await backfillSource(
    user,
    'garmin',
    (page) => deps.getGarminCandidates(user, page),
    (c) => extractTrackPoints(c.detail),
    true,
    deps.upsertActivityTrack,
    batch,
  )
  const strava = await backfillSource(
    user,
    'strava',
    (page) => deps.getStravaCandidates(user, page),
    (c) => polylineToTrackPoints(decodePolyline(c.polyline), c.start_time, c.elapsed_seconds),
    false,
    deps.upsertActivityTrack,
    batch,
  )
  return { garmin: garmin.written, skipped: garmin.skipped + strava.skipped, strava: strava.written }
}
