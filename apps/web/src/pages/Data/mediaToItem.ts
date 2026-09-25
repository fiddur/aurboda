import type { MediaPlay } from '../../state/api'

import { formatTime } from './formatTime'

export const MEDIA_COLOR = '#ec4899'

export interface MediaItem {
  color: string
  detail: string
  end?: Date
  href?: string
  label: string
  start: Date
  type: 'media'
}

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

const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)

export const mediaToItem = (play: MediaPlay, multiDay: boolean): MediaItem => ({
  color: MEDIA_COLOR,
  detail: [formatTime(play.started_at, multiDay), play.artist, playedDetail(play), play.player]
    .filter(Boolean)
    .join(' · '),
  end: play.ended_at,
  href: isWebUrl(play.url) ? play.url : undefined,
  label: play.title || play.url || 'Untitled',
  start: play.started_at,
  type: 'media',
})
