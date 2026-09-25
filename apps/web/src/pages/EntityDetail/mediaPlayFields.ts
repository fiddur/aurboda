import type { Activity, MediaPlay } from '../../state/api'

import { formatDateTime } from './format-utils'

const POINT_PLAY_MS = 60_000

const ACTIVITY_LOOKBACK_MS = 24 * 60 * 60 * 1000

const EXCLUDED_ACTIVITY_TYPES = new Set(['music_scrobble', 'screentime'])

export const OVERLAP_EXCLUDED_TYPES = [...EXCLUDED_ACTIVITY_TYPES]

export interface MediaPlayField {
  label: string
  value: string
}

export const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)

export const formatSecs = (secs: number): string => {
  const total = Math.round(secs)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

const SOURCE_LABELS: Record<MediaPlay['source'], string> = { lastfm: 'Last.fm', mpris: 'MPRIS' }

export const mediaPlayHeading = (play: MediaPlay): { title: string; subtitle?: string } => {
  const subtitle = [play.artist, play.album].filter(Boolean).join(' · ')
  return { subtitle: subtitle || undefined, title: play.title || play.url || 'Untitled' }
}

export const mediaPlayRange = (play: MediaPlay): { start: Date; end: Date } => ({
  end: play.ended_at ?? new Date(play.started_at.getTime() + POINT_PLAY_MS),
  start: play.started_at,
})

/** GET /activities selects by start time, so reach back far enough to catch activities already running when the play began. */
export const activitiesFetchWindow = (play: MediaPlay): { start: Date; end: Date } => {
  const { start, end } = mediaPlayRange(play)
  return { end, start: new Date(start.getTime() - ACTIVITY_LOOKBACK_MS) }
}

/** The play's fields worth showing, in display order, skipping unknown and empty ones. */
export const buildMediaPlayFields = (play: MediaPlay): MediaPlayField[] => {
  const fields: Array<[string, string | null | undefined]> = [
    ['Source', SOURCE_LABELS[play.source]],
    ['Kind', play.kind],
    ['Player', play.player],
    ['Device', play.device],
    ['Started', formatDateTime(play.started_at)],
    ['Ended', play.ended_at && formatDateTime(play.ended_at)],
    ['Played', play.played_secs == null ? null : formatSecs(play.played_secs)],
    ['Track length', play.track_secs == null ? null : formatSecs(play.track_secs)],
    ['Played ratio', play.played_ratio == null ? null : `${Math.round(play.played_ratio * 100)}%`],
    ['Max position', play.max_position_secs == null ? null : formatSecs(play.max_position_secs)],
    ['Seeks', play.seek_count == null ? null : String(play.seek_count)],
  ]
  return fields
    .filter((f): f is [string, string] => Boolean(f[1]))
    .map(([label, value]) => ({ label, value }))
}

/** Activities overlapping the play, other than music scrobbles and screen time, by start time. */
export const activitiesDuringPlay = (activities: Activity[], play: MediaPlay): Activity[] => {
  const { start, end } = mediaPlayRange(play)
  return activities
    .filter((a) => !EXCLUDED_ACTIVITY_TYPES.has(a.activity_type))
    .filter((a) => {
      const aEnd = a.end_time ?? a.start_time
      return a.start_time < end && aEnd > start
    })
    .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
}
