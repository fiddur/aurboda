/**
 * Labels for the impact chart (an activity's effect on HRV, heart rate and stress
 * around its sessions). Shared by the web Analyze page and article block and the
 * backend's server-side impact image, so the two read the same.
 */
import type { ImpactBucket, WindowEffect } from './correlations.ts'

export const IMPACT_WINDOW_OPTIONS = [30, 60, 120, 240, 480, 720, 1440] as const
export const DEFAULT_IMPACT_WINDOW_MINUTES = 30

export const formatImpactWindow = (minutes: number): string =>
  minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`

const formatOffset = (minutes: number): string =>
  `${minutes > 0 ? '+' : minutes < 0 ? '-' : ''}${formatImpactWindow(Math.abs(minutes))}`

/** A before bucket is labelled by its start, an after bucket by its end. */
export const impactBucketLabel = (
  bucket: Pick<ImpactBucket, 'end_offset_minutes' | 'phase' | 'start_offset_minutes'>,
): string => {
  if (bucket.phase === 'during') return 'During'
  return formatOffset(bucket.phase === 'before' ? bucket.start_offset_minutes : bucket.end_offset_minutes)
}

const formatSignedChange = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}`

const formatMean = (value: number | null): string => (value === null ? '--' : value.toFixed(1))

/** `HRV 45.0 → 50.0 (+5.0) · 41 of 48 occurrences`, or null without paired occurrences. */
export const impactEffectSummary = (
  label: string,
  effect: WindowEffect,
  occurrences: number,
): string | null => {
  if (effect.paired_occurrences === 0 || effect.change === null) return null
  return `${label} ${formatMean(effect.before_mean)} → ${formatMean(effect.after_mean)} (${formatSignedChange(
    effect.change,
  )}) · ${effect.paired_occurrences} of ${occurrences} occurrences`
}

export const articleImpactLabel = (block: { activity: string }): string => `Impact of ${block.activity}`
