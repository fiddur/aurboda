/**
 * Live fetch of a remote post's `replies` collection (#1060) — the "expand
 * replies" feature on a timeline card. Nothing is stored: the origin owns the
 * thread, we render a bounded snapshot of it on demand.
 *
 * Strictly best-effort and budgeted: at most {@link MAX_REPLIES} replies from at
 * most {@link MAX_FETCHES} SSRF-guarded requests (collection pages, reply
 * objects referenced by URI, and author actors — one lookup per unique author,
 * memoised). Anything malformed is skipped, never thrown; the response's
 * `partial` flag tells the client the budget ran out before the collection did.
 *
 * All reply HTML goes through `sanitizeRemoteHtml` before it leaves this module
 * — the payload is as untrusted as inbox content.
 */
import type { TimelineReply } from '@aurboda/api-spec'

import { safeFetchGet } from '../safe-fetch.ts'
import { sanitizeRemoteHtml } from './timeline-ingest.ts'

const MAX_REPLIES = 20
const MAX_FETCHES = 15
const AP_ACCEPT = 'application/activity+json, application/ld+json; q=0.9'

export interface RemoteRepliesDeps {
  /** Fetch + JSON-decode an ActivityPub URL (SSRF-guarded). */
  fetchJson: (url: string) => Promise<unknown>
}

export const realRemoteRepliesDeps: RemoteRepliesDeps = {
  fetchJson: async (url) =>
    (await safeFetchGet(url, { headers: { Accept: AP_ACCEPT } })).data,
}

type JsonRecord = Record<string, unknown>

const isRecord = (v: unknown): v is JsonRecord => typeof v === 'object' && v != null && !Array.isArray(v)

/** An AS2 value that may be an id string or an embedded object with an `id`. */
const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v : isRecord(v) && typeof v.id === 'string' ? v.id : null

/** Budgeted fetch bookkeeping shared across one `fetchRemoteReplies` call. */
interface Budget {
  fetches: number
  exhausted: boolean
}

const budgetedFetch = async (
  deps: RemoteRepliesDeps,
  budget: Budget,
  url: string,
): Promise<unknown | null> => {
  if (budget.fetches >= MAX_FETCHES) {
    budget.exhausted = true
    return null
  }
  budget.fetches++
  try {
    return await deps.fetchJson(url)
  } catch {
    return null
  }
}

/** Resolve a value that is either an inline AS2 object or a URI to fetch. */
const resolveObject = async (
  deps: RemoteRepliesDeps,
  budget: Budget,
  v: unknown,
): Promise<JsonRecord | null> => {
  if (isRecord(v)) return v
  if (typeof v === 'string') {
    const fetched = await budgetedFetch(deps, budget, v)
    return isRecord(fetched) ? fetched : null
  }
  return null
}

interface ReplyAuthor {
  display_name: string | null
  handle: string | null
}

/** Resolve a reply author's presentation, memoised per call across replies. */
const resolveAuthor = async (
  deps: RemoteRepliesDeps,
  budget: Budget,
  actorUri: string,
  authors: Map<string, ReplyAuthor>,
): Promise<ReplyAuthor> => {
  const cached = authors.get(actorUri)
  if (cached != null) return cached
  const actor = await resolveObject(deps, budget, actorUri)
  const username =
    actor != null && typeof actor.preferredUsername === 'string' ? actor.preferredUsername : null
  const author: ReplyAuthor = {
    display_name: actor != null && typeof actor.name === 'string' ? actor.name : null,
    handle: username == null ? null : `@${username}@${new URL(actorUri).host}`,
  }
  authors.set(actorUri, author)
  return author
}

/** Map one reply object to the DTO, resolving its author (memoised) within budget. */
const toReply = async (
  deps: RemoteRepliesDeps,
  budget: Budget,
  obj: JsonRecord,
  authors: Map<string, ReplyAuthor>,
): Promise<TimelineReply | null> => {
  const content = typeof obj.content === 'string' ? obj.content : null
  if (content == null) return null
  const actorUri = idOf(obj.attributedTo)
  const author = actorUri == null ? null : await resolveAuthor(deps, budget, actorUri, authors)
  return {
    actor_uri: actorUri,
    content: sanitizeRemoteHtml(content),
    display_name: author?.display_name ?? null,
    handle: author?.handle ?? null,
    published_at: typeof obj.published === 'string' ? obj.published : null,
    url: typeof obj.url === 'string' ? obj.url : (idOf(obj.id) ?? null),
  }
}

/**
 * Fetch up to {@link MAX_REPLIES} replies to the post at `objectUri`, oldest
 * first as the origin orders them. `partial` is true when a budget (reply
 * count, fetch count) ended the walk before the collection did.
 */
export const fetchRemoteReplies = async (
  objectUri: string,
  deps: RemoteRepliesDeps = realRemoteRepliesDeps,
): Promise<{ partial: boolean; replies: TimelineReply[] }> => {
  const budget: Budget = { exhausted: false, fetches: 0 }
  const authors = new Map<string, { display_name: string | null; handle: string | null }>()
  const replies: TimelineReply[] = []

  const post = await budgetedFetch(deps, budget, objectUri)
  if (!isRecord(post)) return { partial: budget.exhausted, replies }

  let page = await resolveFirstPage(deps, budget, post)
  while (page != null && replies.length < MAX_REPLIES) {
    await collectPageReplies(deps, budget, page, authors, replies)
    if (replies.length >= MAX_REPLIES || page.next == null) break
    page = await resolveObject(deps, budget, page.next)
  }
  const partial = budget.exhausted || replies.length >= MAX_REPLIES
  return { partial, replies }
}

/**
 * The collection's first item-bearing page: `replies` is an inline Collection
 * or a URI, whose items may sit directly on it or behind a `first` page.
 */
const resolveFirstPage = async (
  deps: RemoteRepliesDeps,
  budget: Budget,
  post: JsonRecord,
): Promise<JsonRecord | null> => {
  const collection = await resolveObject(deps, budget, post.replies)
  if (collection == null) return null
  const hasItems = collection.items != null || collection.orderedItems != null
  return hasItems || collection.first == null
    ? collection
    : await resolveObject(deps, budget, collection.first)
}

/** Append this page's resolvable replies (inline or URI-referenced) up to the cap. */
const collectPageReplies = async (
  deps: RemoteRepliesDeps,
  budget: Budget,
  page: JsonRecord,
  authors: Map<string, ReplyAuthor>,
  replies: TimelineReply[],
): Promise<void> => {
  const rawItems = page.orderedItems ?? page.items
  const items = Array.isArray(rawItems) ? rawItems : []
  for (const item of items) {
    if (replies.length >= MAX_REPLIES) return
    const obj = await resolveObject(deps, budget, item)
    if (obj == null) continue
    const reply = await toReply(deps, budget, obj, authors)
    if (reply != null) replies.push(reply)
  }
}
