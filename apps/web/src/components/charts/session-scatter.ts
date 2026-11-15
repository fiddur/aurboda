import type { ActivitySession, ActivitySessionGroup } from '@aurboda/api-spec'

import * as d3 from 'd3'
import { format } from 'date-fns'

import { formatMinutes, hardMinutes } from '../sessions/sessionView'
import { SERIES_COLORS } from './breakdown'

export type ScatterY = 'z3_minutes' | 'avg_hr'

export const SCATTER_Y_DEFAULT: ScatterY = 'z3_minutes'

export const scatterYOptions: { label: string; value: ScatterY }[] = [
  { label: 'Z3+ minutes', value: 'z3_minutes' },
  { label: 'Average HR', value: 'avg_hr' },
]

export const scatterYAxisLabel: Record<ScatterY, string> = {
  avg_hr: 'Average heart rate (bpm)',
  z3_minutes: 'Minutes in zone 3+',
}

export const parseScatterY = (raw: string | undefined): ScatterY =>
  raw === 'avg_hr' ? 'avg_hr' : 'z3_minutes'

export const OTHER_KEY = '\u0000other'
export const OTHER_COLOR = '#9ca3af'
export const LEGEND_MAX = SERIES_COLORS.length

export interface ScatterPoint {
  /** The session id, or the group key of a collapsed dot. */
  id: string
  x: number
  y: number
  /** The group key: a value's string form, or `NONE_KEY` for sessions without one; undefined uncoloured. */
  group?: string
  count: number
  start_time?: string
  title?: string
}

export const NONE_KEY = '\u0000none'

export const sessionY = (session: ActivitySession, y: ScatterY): number | undefined =>
  y === 'avg_hr' ? session.avg_hr : hardMinutes(session.hr_zone_secs)

export const groupKey = (value: ActivitySessionGroup['value']): string =>
  value === null ? NONE_KEY : String(value)

/** Each session's group key, from the groups the sessions endpoint returns with `group_by`. */
export const sessionGroupKeys = (groups: ActivitySessionGroup[] | undefined): Map<string, string> =>
  new Map((groups ?? []).flatMap((g) => g.session_ids.map((id) => [id, groupKey(g.value)] as const)))

export interface SessionPoints {
  points: ScatterPoint[]
  missing_duration: number
  missing_y: number
}

/** One point per session with a duration and the chosen y; the rest only counted. */
export const buildSessionPoints = (
  sessions: ActivitySession[],
  y: ScatterY,
  groupOf?: Map<string, string>,
): SessionPoints =>
  sessions.reduce<SessionPoints>(
    (acc, s) => {
      const yValue = sessionY(s, y)
      if (yValue === undefined) return { ...acc, missing_y: acc.missing_y + 1 }
      if (s.duration === undefined) return { ...acc, missing_duration: acc.missing_duration + 1 }
      const group = groupOf ? (groupOf.get(s.id) ?? NONE_KEY) : undefined
      acc.points.push({
        count: 1,
        id: s.id,
        start_time: s.start_time,
        x: s.duration,
        y: yValue,
        ...(group === undefined ? {} : { group }),
        ...(s.title ? { title: s.title } : {}),
      })
      return acc
    },
    { missing_duration: 0, missing_y: 0, points: [] },
  )

export const median = (values: number[]): number => {
  const s = values.toSorted((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** One point per group at the median duration and median y of its sessions. */
export const collapsePoints = (points: ScatterPoint[]): ScatterPoint[] => {
  const byGroup = Map.groupBy(points, (p) => p.group ?? NONE_KEY)
  return [...byGroup].map(([group, ps]) => ({
    count: ps.length,
    group,
    id: group,
    x: median(ps.map((p) => p.x)),
    y: median(ps.map((p) => p.y)),
  }))
}

export interface LegendEntry {
  key: string
  label: string
  color: string
  count: number
}

/**
 * The most frequent values get the series colours, the rest share one "Other" entry. Values with
 * the same count keep their first-seen order, so the colours stay put as the data grows.
 */
export const buildLegend = (
  points: ScatterPoint[],
  labelOf: (key: string) => string,
  max = LEGEND_MAX,
): { entries: LegendEntry[]; colorOf: (key: string | undefined) => string } => {
  const counts = new Map<string, number>()
  for (const p of points) {
    if (p.group !== undefined) counts.set(p.group, (counts.get(p.group) ?? 0) + p.count)
  }
  const ranked = [...counts].toSorted((a, b) => b[1] - a[1])
  const kept = ranked.length > max ? ranked.slice(0, max - 1) : ranked
  const rest = ranked.slice(kept.length)
  const colors = new Map(kept.map(([key], i) => [key, SERIES_COLORS[i % SERIES_COLORS.length]]))
  const entries: LegendEntry[] = kept.map(([key, count]) => ({
    color: colors.get(key) ?? OTHER_COLOR,
    count,
    key,
    label: labelOf(key),
  }))
  if (rest.length > 0) {
    entries.push({
      color: OTHER_COLOR,
      count: rest.reduce((sum, [, c]) => sum + c, 0),
      key: OTHER_KEY,
      label: `Other (${rest.length})`,
    })
  }
  return { colorOf: (key) => (key === undefined ? '' : (colors.get(key) ?? OTHER_COLOR)), entries }
}

/** Whether a point belongs to the highlighted legend entry; "Other" covers every value without a colour. */
export const isHighlighted = (
  point: ScatterPoint,
  highlight: string | undefined,
  entries: LegendEntry[],
): boolean => {
  if (highlight === undefined) return true
  if (highlight !== OTHER_KEY) return point.group === highlight
  return !entries.some((e) => e.key !== OTHER_KEY && e.key === point.group)
}

/** From 0 to a nice value a little above the largest, so the outermost dots are not cut by the edge. */
export const scatterDomain = (values: number[]): [number, number] => {
  const max = Math.max(0, ...values) * 1.05
  const [, top] = d3
    .scaleLinear()
    .domain([0, max > 0 ? max : 1])
    .nice()
    .domain()
  return [0, top]
}

export const DOT_RADIUS = 5
const MIN_RADIUS = 5
const MAX_RADIUS = 20

/** A collapsed dot's area grows with its session count, clamped so one big group cannot swamp the plot. */
export const collapsedRadius = (count: number, maxCount: number): number => {
  if (maxCount <= 1) return MIN_RADIUS
  const r = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt((count - 1) / (maxCount - 1))
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r))
}

export const missingCaption = (
  points: Pick<SessionPoints, 'missing_duration' | 'missing_y'>,
  y: ScatterY,
): string[] => {
  const plural = (n: number) => (n === 1 ? '1 session' : `${n} sessions`)
  const what = y === 'avg_hr' ? 'an average heart rate' : 'heart rate zone data'
  return [
    ...(points.missing_y > 0
      ? [`${plural(points.missing_y)} without ${what} ${points.missing_y === 1 ? 'is' : 'are'} not shown.`]
      : []),
    ...(points.missing_duration > 0
      ? [
          `${plural(points.missing_duration)} without a duration ${points.missing_duration === 1 ? 'is' : 'are'} not shown.`,
        ]
      : []),
  ]
}

const formatY = (value: number, y: ScatterY): string =>
  y === 'avg_hr' ? `Avg HR ${Math.round(value)} bpm` : `Z3+ ${formatMinutes(value)}`

/** The tooltip of a dot: a session's title (or value), date, length and y; a collapsed dot's medians. */
export const tooltipLines = (
  point: ScatterPoint,
  { collapsed, labelOf, y }: { collapsed: boolean; labelOf: (key: string) => string; y: ScatterY },
): string[] => {
  const groupLabel = point.group === undefined ? undefined : labelOf(point.group)
  if (collapsed) {
    return [
      groupLabel ?? '',
      point.count === 1 ? '1 session' : `${point.count} sessions`,
      `Median ${formatMinutes(point.x)}`,
      `Median ${formatY(point.y, y)}`,
    ]
  }
  const heading = point.title ?? groupLabel ?? 'Session'
  return [
    heading,
    ...(point.start_time ? [format(new Date(point.start_time), 'yyyy-MM-dd HH:mm')] : []),
    formatMinutes(point.x),
    formatY(point.y, y),
    ...(groupLabel !== undefined && groupLabel !== heading ? [groupLabel] : []),
  ]
}
