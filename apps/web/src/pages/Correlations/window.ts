import type { ImpactBucket } from '../../state/api'

export const WINDOW_OPTIONS = [30, 60, 120, 240, 480, 720, 1440] as const
export const DEFAULT_WINDOW_MINUTES = 30
export const LONG_WINDOW_MINUTES = 120

export const formatWindow = (minutes: number): string =>
  minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`

const formatOffset = (minutes: number): string =>
  `${minutes > 0 ? '+' : minutes < 0 ? '-' : ''}${formatWindow(Math.abs(minutes))}`

export const bucketLabel = (
  bucket: Pick<ImpactBucket, 'end_offset_minutes' | 'phase' | 'start_offset_minutes'>,
) => {
  if (bucket.phase === 'during') return 'During'
  return formatOffset(bucket.phase === 'before' ? bucket.start_offset_minutes : bucket.end_offset_minutes)
}

export const isLongWindow = (minutes: number): boolean => minutes >= LONG_WINDOW_MINUTES
