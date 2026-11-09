import type { TopListCardData, TopListSource } from '@aurboda/api-spec'

const titles: Record<TopListSource, string> = {
  media_album: 'Top albums',
  media_artist: 'Top artists',
  media_track: 'Top tracks',
  place: 'Top places',
  screentime_app: 'Top apps',
}

const distinctNouns: Record<TopListSource, [string, string]> = {
  media_album: ['album', 'albums'],
  media_artist: ['artist', 'artists'],
  media_track: ['track', 'tracks'],
  place: ['place', 'places'],
  screentime_app: ['app', 'apps'],
}

export const topListTitle = ({ source, title }: { source: TopListSource; title?: string }): string =>
  title ?? titles[source]

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

export const formatNumber = (value: number): string => numberFormat.format(value)

/** The headline unit: `h` for hours, else the plural noun. */
export const totalUnit = (unit: TopListCardData['unit']): string => (unit === 'hours' ? 'h' : unit)

export const formatItemCount = (count: number, unit: TopListCardData['unit']): string =>
  unit === 'hours' ? `${formatNumber(count)} h` : formatNumber(count)

export const formatDistinct = (count: number, source: TopListSource): string => {
  const [one, many] = distinctNouns[source]
  return `${formatNumber(count)} ${count === 1 ? one : many}`
}
