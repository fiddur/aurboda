import {
  DEFAULT_IMPACT_WINDOW_MINUTES,
  formatImpactWindow,
  IMPACT_WINDOW_OPTIONS,
  impactBucketLabel,
} from '@aurboda/api-spec'

export const WINDOW_OPTIONS = IMPACT_WINDOW_OPTIONS
export const DEFAULT_WINDOW_MINUTES = DEFAULT_IMPACT_WINDOW_MINUTES
export const LONG_WINDOW_MINUTES = 120

export const formatWindow = formatImpactWindow

export const bucketLabel = impactBucketLabel

export const isLongWindow = (minutes: number): boolean => minutes >= LONG_WINDOW_MINUTES
