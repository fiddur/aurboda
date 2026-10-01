/**
 * FitPub (https://codeberg.org/fitpub/fitpub) serves a count-only outbox
 * (`{"type":"OrderedCollection","totalItems":N}`, no `first`/`orderedItems`),
 * so the outbox backfill finds nothing there. FitPub does list a user's posts
 * through its anonymous web API and serves each one as an ActivityPub Note at
 * `/activities/<uuid>`. The API is used only to discover post ids; every post
 * is still fetched as a Note through the federation context, so ingest applies
 * the same authority checks as any other Note.
 */
import type { Note } from '@fedify/fedify/vocab'

import { PUBLIC_COLLECTION } from '@fedify/fedify/vocab'

export interface FitpubBackfillDeps {
  /** SSRF-guarded GET + JSON decode. */
  fetchJson: (url: string) => Promise<unknown>
  /** Resolve an AP object URL to a Note (signed fetch via the federation context), or null. */
  lookupNote: (url: string) => Promise<Note | null>
}

const NODEINFO_REL_PREFIX = 'http://nodeinfo.diaspora.software/ns/schema/2.'
const USERNAME_RE = /^[A-Za-z0-9_.-]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sameOrigin = (href: string, origin: string): boolean => {
  try {
    return new URL(href).origin === origin
  } catch {
    return false
  }
}

const nodeinfoMinor = (rel: string): number => Number.parseInt(rel.slice(NODEINFO_REL_PREFIX.length), 10)

/** The same-origin href of the highest NodeInfo 2.x schema the discovery document links. */
const pickNodeinfoHref = (discovery: unknown, origin: string): string | null => {
  if (!isRecord(discovery) || !Array.isArray(discovery.links)) return null
  const candidates = discovery.links
    .filter(isRecord)
    .flatMap(({ href, rel }) =>
      typeof rel === 'string' &&
      typeof href === 'string' &&
      rel.startsWith(NODEINFO_REL_PREFIX) &&
      Number.isFinite(nodeinfoMinor(rel)) &&
      sameOrigin(href, origin)
        ? [{ href, minor: nodeinfoMinor(rel) }]
        : [],
    )
    .sort((a, b) => b.minor - a.minor)
  return candidates[0]?.href ?? null
}

export const isFitpubInstance = async (
  deps: Pick<FitpubBackfillDeps, 'fetchJson'>,
  origin: string,
): Promise<boolean> => {
  try {
    const href = pickNodeinfoHref(await deps.fetchJson(`${origin}/.well-known/nodeinfo`), origin)
    if (href == null) return false
    const nodeinfo = await deps.fetchJson(href)
    if (!isRecord(nodeinfo) || !isRecord(nodeinfo.software)) return false
    const { name } = nodeinfo.software
    return typeof name === 'string' && name.toLowerCase() === 'fitpub'
  } catch {
    return false
  }
}

const postIds = (page: unknown, limit: number): string[] => {
  if (!isRecord(page) || !Array.isArray(page.content)) return []
  return page.content
    .filter(isRecord)
    .map(({ id }) => id)
    .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    .slice(0, limit)
}

const isPubliclyAddressed = (note: Note): boolean =>
  [...note.toIds, ...note.ccIds].some((id) => id.href === PUBLIC_COLLECTION.href)

const fitpubOrigin = (actorUri: string, username: string | null): string | null => {
  if (username == null || !USERNAME_RE.test(username)) return null
  try {
    const { origin } = new URL(actorUri)
    return actorUri === `${origin}/users/${username}` ? origin : null
  } catch {
    return null
  }
}

/**
 * Up to `limit` of a FitPub actor's most recent public Notes, newest-first.
 * Yields `[]` for anything that isn't a FitPub actor, and never throws.
 */
export const fetchFitpubRecentNotes = async (
  deps: FitpubBackfillDeps,
  actorUri: string,
  username: string | null,
  limit: number,
): Promise<Note[]> => {
  const origin = fitpubOrigin(actorUri, username)
  if (origin == null || username == null || limit <= 0) return []
  if (!(await isFitpubInstance(deps, origin))) return []

  let ids: string[]
  try {
    const page = await deps.fetchJson(
      `${origin}/api/web/activities/user/${encodeURIComponent(username)}?page=0&size=${limit}`,
    )
    ids = postIds(page, limit)
  } catch {
    return []
  }

  const notes: Note[] = []
  for (const id of ids) {
    try {
      const note = await deps.lookupNote(`${origin}/activities/${id}`)
      if (note != null && isPubliclyAddressed(note)) notes.push(note)
    } catch {
      // One unreachable post shouldn't drop the rest.
    }
  }
  return notes
}
