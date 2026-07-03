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
 * The human-readable status a plain fediverse client (Mastodon) renders: a bold
 * title headline with the shared scalars on their own line below, so it reads as
 * a workout post rather than one run-on sentence. `name` carries the same
 * headline. Shared by the AS2 object model and the Fedify delivery Note so both
 * read identically.
 */
export const feedPostContent = (
  title: string | undefined,
  activityType: string,
  scalars: ScalarMetric[],
): { name: string; content: string } => {
  const heading = title ?? `${prettifyKey(activityType)} activity`
  const stats = scalars.map(formatScalar).join(' · ')
  const headingHtml = `<p><strong>${escapeHtml(heading)}</strong></p>`
  return {
    content: stats ? `${headingHtml}<p>${escapeHtml(stats)}</p>` : headingHtml,
    name: heading,
  }
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

  const { content, name } = feedPostContent(input.title, input.activityType, input.scalars)
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
