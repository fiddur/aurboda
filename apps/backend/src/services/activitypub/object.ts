/**
 * AS2 object model for a shared activity.
 *
 * Serializes a feed post into a `Create` activity whose `object` is a dual-typed
 * `["Note", "aurboda:Exercise"]`: `Note` first so plain fediverse clients
 * (Mastodon) render `name`/`content`/`url` as a status, plus structured
 * `aurboda:` extension fields that an Aurboda↔Aurboda consumer reads
 * ("progressive enhancement").
 *
 * This module is a pure function of its inputs — the caller resolves the shared
 * scalar values and passes in the absolute URLs — so it is fully unit-testable
 * and carries no dependency on the (upcoming) Fedify actor/delivery layer. Only
 * the metrics the user actually shared are ever emitted: unshared scalars are
 * absent from `content` and `aurboda:metrics`, and only `seriesMetrics` on a
 * `public`/`unlisted` post produce `aurboda:series` links (matching what the
 * public `/series` endpoint will actually resolve).
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

export interface BuildCreateInput {
  /** Canonical absolute URL of the post (the `Create` activity `id`). */
  postId: string
  /** Absolute actor URL (e.g. `https://host/u/fredrik`). */
  actorUrl: string
  /** The `aurboda:` term prefix IRI, ending in `#` (e.g. `https://host/ns/activitystreams#`). */
  aurbodaNs: string
  /** Base URL of the public series endpoint (e.g. `https://host/api/public/fredrik/series`). */
  seriesEndpointBase: string
  visibility: FeedVisibility
  activityType: string
  /** Activity start (ISO 8601); the workout time, kept in `aurboda:startTime`. */
  startTime: string
  /** Activity end (ISO 8601); required for duration and series links. */
  endTime?: string
  /**
   * When the post was created (ISO 8601), used for the AS2 `published` of the
   * Create and its object so remote timelines order it by share time, not the
   * (possibly much earlier) workout time. Defaults to `startTime`.
   */
  publishedAt?: string
  title?: string
  /** The author's personal message for the post (plain text), if any. */
  message?: string
  /** IANA timezone for the human-readable activity-date line (defaults to UTC). */
  timeZone?: string
  /** Resolved scalar summaries for the shared `included_metrics`. */
  scalars: ScalarMetric[]
  /** Metric keys whose series were explicitly shared (drive `aurboda:series`). */
  seriesMetrics: string[]
  /** Bucket granularity for the series links (defaults to `5s`). */
  seriesBucket?: string
}

export interface AS2Create {
  '@context': [string, Record<string, string>]
  id: string
  type: 'Create'
  actor: string
  published: string
  to: string[]
  cc: string[]
  object: Record<string, unknown>
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

/**
 * Build the `aurboda:series` link objects for the shared series metrics.
 *
 * Emitted only for `public`/`unlisted` posts: the public `/series` endpoint
 * refuses `followers`-only posts, so advertising links there would just 404.
 * Series also need a bounded activity window.
 */
const seriesLinks = (input: BuildCreateInput): Record<string, string>[] => {
  const { endTime, seriesMetrics, visibility } = input
  if (visibility === 'followers' || !endTime || seriesMetrics.length === 0) return []
  const bucket = input.seriesBucket ?? '5s'
  return seriesMetrics.map((metric) => {
    const params = new URLSearchParams({
      bucket,
      end: endTime,
      metric,
      start: input.startTime,
    })
    return {
      href: `${input.seriesEndpointBase}?${params.toString()}`,
      mediaType: 'application/json',
      metric,
    }
  })
}

/**
 * Build a `Create{Exercise}` AS2 activity for a shared post. Pure and
 * deterministic given its inputs.
 */
export const buildCreateExercise = (input: BuildCreateInput): AS2Create => {
  const followersUrl = `${input.actorUrl}/followers`
  const { to, cc } = addressingFor(input.visibility, followersUrl)
  const objectId = `${input.postId}/object`

  const { content, name } = feedPostContent(input.title, input.activityType, input.scalars, {
    message: input.message,
    windowLabel: formatActivityWindow(input.startTime, input.endTime, input.timeZone),
  })
  // `published` is the share time (timeline ordering); the workout time lives in
  // `aurboda:startTime`.
  const published = input.publishedAt ?? input.startTime

  const object: Record<string, unknown> = {
    'aurboda:activityType': input.activityType,
    'aurboda:metrics': input.scalars.map(({ key, unit, value }) => ({
      key,
      ...(unit === undefined ? {} : { unit }),
      value,
    })),
    'aurboda:startTime': input.startTime,
    attributedTo: input.actorUrl,
    content,
    id: objectId,
    name,
    published,
    // Note first → Mastodon uses content/name/url; Aurboda recognises aurboda:Exercise.
    type: ['Note', 'aurboda:Exercise'],
    url: input.postId,
  }

  if (input.message !== undefined && input.message.trim() !== '') {
    object['aurboda:message'] = input.message
  }
  if (input.endTime) {
    object['aurboda:endTime'] = input.endTime
    object['aurboda:durationSeconds'] = Math.round(
      (new Date(input.endTime).getTime() - new Date(input.startTime).getTime()) / 1000,
    )
  }
  const series = seriesLinks(input)
  if (series.length > 0) object['aurboda:series'] = series

  return {
    '@context': ['https://www.w3.org/ns/activitystreams', { aurboda: input.aurbodaNs }],
    actor: input.actorUrl,
    cc,
    id: input.postId,
    object,
    published,
    to,
    type: 'Create',
  }
}
