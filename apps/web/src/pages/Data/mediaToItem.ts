import type { MediaPlay } from '../../state/api'
import type { DataItem } from './dataItem'

import { formatTime } from './formatTime'

export const MEDIA_COLOR = '#ec4899'

const formatPlayedSecs = (secs: number): string => {
  if (secs < 60) return `${Math.round(secs)}s`
  const totalMin = Math.round(secs / 60)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const playedDetail = (play: MediaPlay): string | undefined => {
  if (play.played_secs == null) return undefined
  const ratio = play.played_ratio == null ? '' : ` (${Math.round(play.played_ratio * 100)}%)`
  return `${formatPlayedSecs(play.played_secs)} played${ratio}`
}

export const mediaToItem = (play: MediaPlay, multiDay: boolean): DataItem => ({
  color: MEDIA_COLOR,
  detail: [formatTime(play.started_at, multiDay), play.artist, playedDetail(play), play.player]
    .filter(Boolean)
    .join(' · '),
  end: play.ended_at,
  href: `/detail/media/${encodeURIComponent(play.id)}`,
  label: play.title || play.url || 'Untitled',
  start: play.started_at,
  type: 'media',
})
