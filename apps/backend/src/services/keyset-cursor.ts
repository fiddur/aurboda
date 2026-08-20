/**
 * Opaque keyset-pagination cursor shared by the paginated feed surfaces (the
 * home timeline on `(published_at, id)`, the owner's feed on `(created_at,
 * id)`): a `(timestamp, uuid)` position encoded as one base64url token, so
 * clients treat it as opaque and a crafted value can't reach the SQL layer.
 */

export interface KeysetCursor {
  ts: Date
  id: string
}

/** Encode a `(timestamp, id)` keyset position as an opaque base64url cursor. */
export const encodeKeysetCursor = (ts: Date, id: string): string =>
  Buffer.from(`${ts.getTime()}:${id}`).toString('base64url')

/** A canonical UUID, to validate a decoded cursor's id before it hits a `$::uuid` cast. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Decode an opaque cursor, or undefined if it's missing/malformed (→ first page). */
export const decodeKeysetCursor = (cursor: string | undefined): KeysetCursor | undefined => {
  if (cursor == null || cursor === '') return undefined
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
  const sep = decoded.indexOf(':')
  if (sep <= 0) return undefined
  const ms = Number(decoded.slice(0, sep))
  const id = decoded.slice(sep + 1)
  // Validate the id is a UUID: it's cast to `uuid` in the page queries, so a
  // crafted `12345:not-a-uuid` cursor would otherwise 500 instead of paging.
  if (!Number.isSafeInteger(ms) || !UUID_RE.test(id)) return undefined
  return { id, ts: new Date(ms) }
}
