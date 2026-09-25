import type { LatestSleep, SleepStageMinutes } from '@aurboda/api-spec'

import { format } from 'date-fns'

import { STAGE_COLORS, STAGE_LABELS } from '../charts/sleep-utils'

export const formatClock = (iso: string): string => format(new Date(iso), 'HH:mm')

export const formatSleepRange = (sleep: Pick<LatestSleep, 'end_time' | 'start_time'>): string =>
  `${formatClock(sleep.start_time)} – ${formatClock(sleep.end_time)}`

export interface StripSegment {
  color: string
  /** Percent of the strip width from the left edge. */
  left: number
  title: string
  width: number
}

/** Stage segments positioned along the night, as percentages of its span. */
export const stageStripSegments = (
  sleep: Pick<LatestSleep, 'end_time' | 'stages' | 'start_time'>,
): StripSegment[] => {
  if (sleep.stages.length === 0) return []
  const ms = (iso: string) => new Date(iso).getTime()
  const from = Math.min(ms(sleep.start_time), ...sleep.stages.map((s) => ms(s.start_time)))
  const to = Math.max(ms(sleep.end_time), ...sleep.stages.map((s) => ms(s.end_time)))
  const span = to - from
  if (span <= 0) return []
  return sleep.stages.map((s) => ({
    color: STAGE_COLORS[s.stage] ?? STAGE_COLORS[2],
    left: ((ms(s.start_time) - from) / span) * 100,
    title: `${STAGE_LABELS[s.stage] ?? 'Unknown'} ${formatClock(s.start_time)}–${formatClock(s.end_time)}`,
    width: ((ms(s.end_time) - ms(s.start_time)) / span) * 100,
  }))
}

export interface StageBreakdownItem {
  color: string
  label: string
  minutes: number
}

export const stageBreakdown = (minutes: SleepStageMinutes | undefined): StageBreakdownItem[] =>
  minutes
    ? [
        { color: STAGE_COLORS[5], label: 'Deep', minutes: minutes.deep },
        { color: STAGE_COLORS[4], label: 'Light', minutes: minutes.light },
        { color: STAGE_COLORS[6], label: 'REM', minutes: minutes.rem },
        { color: STAGE_COLORS[1], label: 'Awake', minutes: minutes.awake },
      ]
    : []

export interface Delta {
  arrow: '↑' | '↓' | '→'
  /** Rounded absolute difference. */
  amount: number
}

/** Difference from a reference, rounded to whole units; → when it rounds to zero. */
export const delta = (value: number | undefined, reference: number | undefined): Delta | undefined => {
  if (value === undefined || reference === undefined) return undefined
  const diff = Math.round(value - reference)
  return { amount: Math.abs(diff), arrow: diff > 0 ? '↑' : diff < 0 ? '↓' : '→' }
}

export const formatDelta = (d: Delta): string => (d.amount === 0 ? '→' : `${d.arrow}${d.amount}`)
