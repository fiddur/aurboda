/**
 * Pure helpers behind the native activity stat grid (#997): turn a post's typed
 * scalar metrics (`FeedStructuredMetric[]` — the same shape the structured
 * enrichment payload and the owner-facing `FeedPost.metrics` carry) into
 * display-ready cells, plus the browser-local activity-date line (#998).
 */
import type { FeedStructuredMetric } from '@aurboda/api-spec'

import { summaryLabel } from '../../components/feed-metrics'

/** One big-value/small-label cell of the stat grid. */
export interface StatCell {
  key: string
  label: string
  value: string
}

/** One HR-zone entry of the compact zones row. */
export interface ZoneStat {
  zone: string
  minutes: number
}

/** Render a seconds count as a compact human duration: 642 → `10m 42s`, 3720 → `1h 2m`. */
const formatDuration = (totalSeconds: number): string => {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts: string[] = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (sec || parts.length === 0) parts.push(`${sec}s`)
  return parts.join(' ')
}

/** Trim a numeric value for display: at most 2 decimals, no trailing zeros. */
const formatNumber = (value: number): string => {
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

/** `z0` → `Rest`, `z3` → `Z3` — the compact zone naming of the detail view. */
const zoneName = (key: string): string => (key === 'z0' ? 'Rest' : key.toUpperCase())

/**
 * Split the typed metrics into stat-grid cells and the HR-zones row. A record
 * value (HR-zone minutes) becomes the zones row; a scalar becomes a cell with a
 * humanized duration for `seconds` units and the unit appended otherwise.
 */
export const splitStats = (
  metrics: readonly FeedStructuredMetric[],
): { cells: StatCell[]; zones: ZoneStat[] } => {
  const cells: StatCell[] = []
  const zones: ZoneStat[] = []
  for (const metric of metrics) {
    if (typeof metric.value === 'number') {
      const value =
        metric.unit === 'seconds'
          ? formatDuration(metric.value)
          : `${formatNumber(metric.value)}${metric.unit ? ` ${metric.unit}` : ''}`
      cells.push({ key: metric.key, label: summaryLabel(metric.key), value })
      continue
    }
    // The only record-valued scalar today is hr_zone_minutes; render any future
    // record the same way (key/value pairs) rather than dropping it.
    for (const [zone, minutes] of Object.entries(metric.value)) {
      zones.push({ minutes, zone: zoneName(zone) })
    }
  }
  return { cells, zones }
}

/**
 * Browser-local activity-date line: `Sun, 2 Aug 2026, 15:44–18:12` for a
 * same-day window, both ends spelled out across days, start only when open-ended.
 * The viewer-local counterpart of the backend's `formatActivityWindow` (which
 * renders the federated text in the author's timezone).
 */
export const formatEntryWindow = (startIso: string, endIso?: string): string => {
  const dateOptions: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
    year: 'numeric',
  }
  const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', hour12: false, minute: '2-digit' }
  const full = (d: Date) =>
    `${new Intl.DateTimeFormat('en-GB', dateOptions).format(d)}, ${new Intl.DateTimeFormat('en-GB', timeOptions).format(d)}`

  const start = new Date(startIso)
  if (endIso === undefined) return full(start)
  const end = new Date(endIso)
  const sameDay =
    new Intl.DateTimeFormat('en-GB', dateOptions).format(start) ===
    new Intl.DateTimeFormat('en-GB', dateOptions).format(end)
  if (!sameDay) return `${full(start)} – ${full(end)}`
  return `${full(start)}–${new Intl.DateTimeFormat('en-GB', timeOptions).format(end)}`
}
