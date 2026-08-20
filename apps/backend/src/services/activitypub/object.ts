/**
 * Pure AS2 building blocks shared by the delivery layer (`deliver.ts`) and the
 * public feed surfaces: visibility→addressing, the human-readable Note content
 * (`feedPostContent`), and the activity-date line. All pure functions of their
 * inputs, so fully unit-testable with no Fedify dependency.
 *
 * The structured extension a QuantPub peer reads (`["Note", "quant:Exercise"]`
 * dual-typing, `quant:metrics`, `quant:series`) lives in `quant-extension.ts`
 * and is spliced into the delivered/served JSON-LD there (#896).
 */

import type { FeedVisibility } from '@aurboda/api-spec'

/** The AS2 magic collection every public object is addressed to. */
export const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'

/** A resolved scalar summary for one shared metric. */
export interface ScalarMetric {
  /** Machine key, e.g. `heart_rate_avg`, `distance`, `hr_zone_minutes`. */
  key: string
  /** Scalar value, or a small keyed record (e.g. HR-zone minutes `{ z2: 22 }`). */
  value: number | Record<string, number>
  /** Optional unit for the scalar form (e.g. `bpm`, `km`). */
  unit?: string
  /** Optional human label for the fallback text; defaults to a prettified key. */
  label?: string
}

const escapeHtml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Prettify a snake_case metric key into a label (`hr_zone_minutes` → `Hr zone minutes`). */
const prettifyKey = (key: string): string => {
  const spaced = key.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
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

/** Render one scalar for the human-readable stats line. */
const formatScalar = ({ key, value, unit, label }: ScalarMetric): string => {
  const name = label ?? prettifyKey(key)
  let rendered: string
  if (typeof value === 'number') {
    // A seconds value reads as a duration ("10m 42s"), not "642 seconds".
    rendered = unit === 'seconds' ? formatDuration(value) : `${value}${unit ? ` ${unit}` : ''}`
  } else {
    rendered = Object.entries(value)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')
  }
  return `${name} ${rendered}`
}

/**
 * Format one date-time for the activity-date line, in the author's timezone
 * (fallback UTC when unset/invalid): `Sun 2 Aug 2026, 15:44`.
 */
const formatWindowInstant = (iso: string | Date, timeZone: string | undefined, dateOnly = false) => {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { day: 'numeric', month: 'short', weekday: 'short', year: 'numeric' }
    : {
        day: 'numeric',
        hour: '2-digit',
        hour12: false,
        minute: '2-digit',
        month: 'short',
        weekday: 'short',
        year: 'numeric',
      }
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timeZone ?? 'UTC' }).format(date)
  } catch {
    // An invalid stored timezone must never break content building.
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date)
  }
}

/**
 * Human-readable line saying WHEN the activity happened (#998) — the post's AS2
 * `published` stays the share time (timeline ordering), so the activity's own
 * date must be visible in the content. Same-day windows collapse the end to its
 * time (`Sun 2 Aug 2026, 15:44–18:12`); cross-day windows spell out both ends.
 */
export const formatActivityWindow = (
  start: string | Date,
  end?: string | Date,
  timeZone?: string,
): string => {
  const startLabel = formatWindowInstant(start, timeZone)
  if (end === undefined) return startLabel
  const sameDay = formatWindowInstant(start, timeZone, true) === formatWindowInstant(end, timeZone, true)
  if (!sameDay) return `${startLabel} – ${formatWindowInstant(end, timeZone)}`
  const endTime = formatWindowInstant(end, timeZone).split(', ').pop() ?? ''
  return `${startLabel}–${endTime}`
}

/** Extra content parts beyond the title + scalars (all optional). */
export interface FeedPostContentExtras {
  /** The author's personal message (plain text; linebreaks become `<br>`). */
  message?: string
  /** Pre-formatted activity-date line (see `formatActivityWindow`). */
  windowLabel?: string
}

/**
 * The human-readable status a plain fediverse client (Mastodon) renders: a bold
 * title headline, the author's personal message (if any), the activity-date
 * line, and the shared scalars one per line — structured paragraphs rather than
 * one run-on `·`-joined sentence (#997). `name` carries the headline. Shared by
 * the AS2 object model and the Fedify delivery Note so both read identically.
 */
export const feedPostContent = (
  title: string | undefined,
  activityType: string,
  scalars: ScalarMetric[],
  extras: FeedPostContentExtras = {},
): { name: string; content: string } => {
  const heading = title ?? `${prettifyKey(activityType)} activity`
  const parts = [`<p><strong>${escapeHtml(heading)}</strong></p>`]
  const message = extras.message?.trim()
  if (message) parts.push(`<p>${escapeHtml(message).replaceAll('\n', '<br>')}</p>`)
  if (extras.windowLabel) parts.push(`<p>${escapeHtml(extras.windowLabel)}</p>`)
  if (scalars.length > 0) parts.push(`<p>${scalars.map((s) => escapeHtml(formatScalar(s))).join('<br>')}</p>`)
  return { content: parts.join(''), name: heading }
}

/**
 * Whether a post is visible on the unauthenticated AP surfaces — the outbox and
 * its dereferenceable object. `public` and `unlisted` are both addressed to the
 * AS2 Public collection; `followers`-only never is (and is delivered with its
 * object inline, so its id never needs fetching). An allowlist, so any future
 * non-public visibility is excluded by default; mirrors the SQL filter in
 * `listPublicFeedPosts`.
 */
export const isPubliclyVisible = (visibility: FeedVisibility): boolean =>
  visibility === 'public' || visibility === 'unlisted'

/**
 * Map a post's visibility to AS2 `to`/`cc` addressing. `followers` is the
 * actor's followers collection; public objects are addressed to the AS2 Public
 * magic collection.
 */
export const addressingFor = (
  visibility: FeedVisibility,
  followersUrl: string,
): { to: string[]; cc: string[] } => {
  switch (visibility) {
    case 'public':
      return { cc: [followersUrl], to: [AS_PUBLIC] }
    case 'unlisted':
      return { cc: [AS_PUBLIC], to: [followersUrl] }
    case 'followers':
      return { cc: [], to: [followersUrl] }
  }
}
