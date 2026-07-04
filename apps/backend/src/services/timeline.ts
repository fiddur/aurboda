/**
 * Shared home-timeline read logic, used by the REST `/feed/timeline` route and
 * the MCP `list_timeline` tool (parity).
 *
 * A page is keyset-paginated on `(published_at, id)`; the opaque `next_cursor`
 * encodes that pair. To decide whether a next page exists we fetch one extra row
 * and drop it. `serializeTimelineEntry` maps the stored record (whose `content`
 * is already sanitised at ingest) to the api-spec DTO.
 */
import type { TimelineEntry } from '@aurboda/api-spec'

import type { TimelineCursor, TimelineEntryRecord } from '../db/index.ts'

import { listTimelineEntries } from '../db/index.ts'

/** Encode a `(published_at, id)` keyset position as an opaque base64 cursor. */
const encodeCursor = (record: TimelineEntryRecord): string =>
  Buffer.from(`${record.published_at.getTime()}:${record.id}`).toString('base64url')

/** A canonical UUID, to validate a decoded cursor's id before it hits the `$::uuid` cast. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Decode an opaque cursor, or undefined if it's missing/malformed (→ first page). */
const decodeCursor = (cursor: string | undefined): TimelineCursor | undefined => {
  if (cursor == null || cursor === '') return undefined
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
  const sep = decoded.indexOf(':')
  if (sep <= 0) return undefined
  const ms = Number(decoded.slice(0, sep))
  const id = decoded.slice(sep + 1)
  // Validate the id is a UUID: it's cast to `uuid` in listTimelineEntries, so a
  // crafted `12345:not-a-uuid` cursor would otherwise 500 instead of paging.
  if (!Number.isSafeInteger(ms) || !UUID_RE.test(id)) return undefined
  return { id, published_at: new Date(ms) }
}

export const serializeTimelineEntry = (record: TimelineEntryRecord): TimelineEntry => ({
  actor_uri: record.actor_uri,
  avatar_url: record.avatar_url,
  content: record.content,
  display_name: record.display_name,
  handle: record.handle,
  id: record.id,
  object_uri: record.object_uri,
  published_at: record.published_at.toISOString(),
  ...(record.structured == null ? {} : { structured: record.structured }),
  url: record.url,
})

/** Fetch a keyset page of raw timeline rows — the one DB dependency of `getTimelinePage`. */
export type TimelineFetcher = (
  user: string,
  limit: number,
  cursor?: TimelineCursor,
) => Promise<TimelineEntryRecord[]>

/**
 * One page of the home timeline (newest first) plus the cursor for the next page
 * (null when there are no more). Fetches `limit + 1` rows to detect a next page
 * without a second query. The row fetcher is injected (defaulting to the real DB
 * query) so the pagination + cursor logic is unit-testable without a database.
 */
export const getTimelinePage = async (
  user: string,
  limit: number,
  cursor?: string,
  fetchEntries: TimelineFetcher = listTimelineEntries,
): Promise<{ entries: TimelineEntry[]; next_cursor: string | null }> => {
  const rows = await fetchEntries(user, limit + 1, decodeCursor(cursor))
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  return {
    entries: page.map(serializeTimelineEntry),
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  }
}
