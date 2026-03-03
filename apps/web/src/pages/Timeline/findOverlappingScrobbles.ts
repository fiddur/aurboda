import type { Scrobble } from '../../state/api'

const TRACK_DURATION_MS = 3.5 * 60 * 1000 // ~3.5 minutes

/** Find scrobbles that overlap a given time range, returning "artist – track" strings. */
export const findOverlappingScrobbles = (scrobbles: Scrobble[], start: Date, end: Date): string[] => {
  const result: string[] = []
  for (const s of scrobbles) {
    const trackEnd = new Date(s.recorded_at.getTime() + TRACK_DURATION_MS)
    if (s.recorded_at < end && trackEnd > start) {
      result.push(`${s.artist} – ${s.track}`)
    }
  }
  return result
}
