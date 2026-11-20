/**
 * The comment thread of a challenge whose host and members live on different servers.
 *
 * Host half: the signed thread document (`buildThreadDocument`), which also verifies a remote
 * member's actor. Member half: a local copy of the host's thread, pulled with a signed GET at join
 * and when stale (`syncRemoteThread`), read and written through the ordinary thread API
 * (`createRemoteThreadBranch`), and kept current by the comments the host and the attendees push
 * (`admitPushedThreadNote`).
 */
import type { Federation } from '@fedify/fedify'
import type { Note } from '@fedify/fedify/vocab'

import {
  canonicalChallengeUrl,
  type ChallengeCommentBody,
  type ChallengeThreadAudience,
  type ChallengeThreadEntry,
  type ChallengeThreadReply,
  parseChallengeUrl,
  type QuantChallengeDocument,
  type QuantChallengeThread,
  type QuantChallengeThreadItem,
  quantChallengeThreadSchema,
  type TimelineImage,
} from '@aurboda/api-spec'
import { signRequest } from '@fedify/fedify/sig'

import type {
  ChallengeMemberRecord,
  ChallengeParticipationRecord,
  ChallengeRecord,
  ChallengeThreadEntryRecord,
  FeedPostRecord,
  ParticipationThreadState,
  ReplyPostInput,
  ThreadCopyEntryInput,
  ThreadCopyEntryRecord,
} from '../db/index.ts'
import type { RaiseNotificationInput } from './notifications.ts'

import {
  deleteParticipationThreadCopyEntry,
  deleteThreadCopyEntry,
  getParticipationByObjectUri,
  getParticipationByUrl,
  getThreadCopyEntryById,
  getThreadCopyEntryByObjectUri,
  listChallengeMembers,
  listChallengeThreadDocumentEntries,
  listThreadCopy,
  markChallengeMemberActorVerified,
  replaceThreadCopy,
  updateParticipationThreadState,
  upsertThreadCopyEntry,
} from '../db/index.ts'
import { identityToActorUri } from './activitypub/challenge-object.ts'
import { renderNoteProse } from './activitypub/note-prose.ts'
import { AS_PUBLIC } from './activitypub/object.ts'
import { temporalInstantToDate } from './activitypub/temporal-interop.ts'
import { extractNoteImages, noteLinkUrl, sanitizeRemoteHtml } from './activitypub/timeline-ingest.ts'
import { discoverInstance, fetchChallengeDocument, threadStateFromDocument } from './challenge-federation.ts'
import { clampToNow, type InboundThreadNote, isSendersNote } from './challenge-thread-inbound.ts'
import {
  allowedAudiences,
  type ChallengeThreadDeps,
  type ChallengeThreadDepsOptions,
  type ChallengeThreadView,
  createChallengeThreadDeps,
  failure,
  MAX_REPLIES_PER_ENTRY,
  type OwnEntry,
  ownPostIdOf,
  readableAudiences,
  type RemoteThreadBranch,
  THREAD_PAGE_SIZE,
  type ThreadFailure,
  type ThreadPush,
  type ThreadSignal,
  type ThreadSignalKind,
  verifiedRemoteActors,
} from './challenge-thread.ts'
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor.ts'
import { notifier } from './notifications.ts'
import { safeFetchGet } from './safe-fetch.ts'
import { buildActorUrl, buildChallengeObjectUrl, buildPostUrl } from './share-urls.ts'
import { actorLabel, htmlSnippet } from './social-notifications.ts'
import { ownObjectPrefix } from './timeline.ts'

export const THREAD_DOCUMENT_LIMIT = 500
export const THREAD_COPY_MAX_AGE_MS = 5 * 60 * 1000
export const FORCED_PULL_MIN_INTERVAL_MS = 60_000
export const OWN_PENDING_KEEP_MS = 10 * 60 * 1000
const MAX_ITEM_IMAGES = 4
const MAX_ATTENDEES = 1000

export const NOT_JOINED_MESSAGE = 'Join this challenge to follow its comments from here'
export const NO_REMOTE_THREAD_MESSAGE = "This challenge's host does not offer comments to other servers yet"
export const HOST_UNREACHABLE_MESSAGE = "Could not reach the challenge's host"

const unique = (values: readonly (string | null | undefined)[]): string[] => [
  ...new Set(values.filter((value): value is string => value != null && value !== '')),
]

export interface ThreadDocumentDeps {
  webHost: string
  listMembers: (host: string, challengeId: string) => Promise<ChallengeMemberRecord[]>
  markVerified: (host: string, memberId: string, actorUri: string) => Promise<unknown>
  listDocumentEntries: (
    host: string,
    challengeId: string,
    audiences: readonly ChallengeThreadAudience[],
    limit: number,
  ) => Promise<ChallengeThreadEntryRecord[]>
}

export const createThreadDocumentDeps = (webHost: string): ThreadDocumentDeps => ({
  listDocumentEntries: listChallengeThreadDocumentEntries,
  listMembers: listChallengeMembers,
  markVerified: markChallengeMemberActorVerified,
  webHost,
})

/** The active member on another server whose actor signed the request. */
const signingMember = (
  members: readonly ChallengeMemberRecord[],
  signer: string,
): ChallengeMemberRecord | null =>
  members.find(
    (member) =>
      member.kind === 'remote' &&
      member.status === 'active' &&
      (member.actor === signer || identityToActorUri(member.identity_base_url) === signer),
  ) ?? null

/** Whom a comment is delivered to: the host, the local members and the verified remote ones. */
export const threadAttendees = (
  webHost: string,
  host: string,
  members: readonly ChallengeMemberRecord[],
  alsoVerified: readonly string[] = [],
): string[] =>
  unique([
    buildActorUrl(webHost, host),
    ...members
      .filter((member) => member.kind === 'local' && member.status === 'active' && member.local_user != null)
      .map((member) => buildActorUrl(webHost, member.local_user ?? '')),
    ...verifiedRemoteActors(members),
    ...alsoVerified,
  ])

export const toThreadItem = (entry: ChallengeThreadEntryRecord): QuantChallengeThreadItem => ({
  ...(entry.images.length === 0
    ? {}
    : {
        attachment: entry.images.map((image) => ({
          ...(image.height == null ? {} : { height: image.height }),
          ...(image.media_type == null ? {} : { mediaType: image.media_type }),
          ...(image.name == null ? {} : { name: image.name }),
          url: image.url,
          ...(image.width == null ? {} : { width: image.width }),
        })),
      }),
  attributedTo: {
    handle: entry.handle,
    icon: entry.avatar_url,
    id: entry.actor_uri,
    name: entry.display_name,
  },
  audience: entry.audience,
  content: entry.content,
  id: entry.object_uri,
  inReplyTo: entry.in_reply_to_uri,
  published: entry.published_at.toISOString(),
  type: entry.kind,
  updated: entry.edited_at?.toISOString() ?? null,
  url: entry.url,
})

/**
 * The thread document a signed request may read. An active member on another server (whose actor
 * signed) is stamped verified and gets every visible entry, the audiences a member posts with and
 * the attendees; anyone else the public entries of a public challenge and nothing more.
 */
export const buildThreadDocument = async (
  deps: ThreadDocumentDeps,
  host: string,
  challenge: ChallengeRecord,
  signer: string | null,
): Promise<QuantChallengeThread> => {
  const members = await deps.listMembers(host, challenge.id)
  const member = signer == null ? null : signingMember(members, signer)
  if (member != null && signer != null) await deps.markVerified(host, member.id, signer)
  const role = member == null ? 'visitor' : 'member'
  const entries = await deps.listDocumentEntries(
    host,
    challenge.id,
    readableAudiences(role, challenge),
    THREAD_DOCUMENT_LIMIT,
  )
  return {
    audiences: allowedAudiences(role, challenge),
    ...(member == null || signer == null
      ? {}
      : { attendees: threadAttendees(deps.webHost, host, members, [signer]) }),
    challenge: buildChallengeObjectUrl(deps.webHost, host, challenge.slug),
    host: buildActorUrl(deps.webHost, host),
    items: entries.map(toThreadItem),
    kind: 'challengeThread',
  }
}

export interface RemoteThreadDeps {
  webHost: string
  now: () => number
  getParticipationByUrl: (user: string, url: string) => Promise<ChallengeParticipationRecord | null>
  getParticipationByObjectUri: (
    user: string,
    objectUri: string,
  ) => Promise<ChallengeParticipationRecord | null>
  updateThreadState: (
    user: string,
    participationId: string,
    state: ParticipationThreadState,
  ) => Promise<ChallengeParticipationRecord | null>
  replaceCopy: (user: string, participationId: string, rows: readonly ThreadCopyEntryInput[]) => Promise<void>
  listCopy: (user: string, participationId: string) => Promise<ThreadCopyEntryRecord[]>
  getCopyById: (user: string, id: string) => Promise<ThreadCopyEntryRecord | null>
  getCopyByObjectUri: (
    user: string,
    participationId: string,
    objectUri: string,
  ) => Promise<ThreadCopyEntryRecord | null>
  upsertCopy: (
    user: string,
    participationId: string,
    input: ThreadCopyEntryInput,
  ) => Promise<{ entry: ThreadCopyEntryRecord; inserted: boolean }>
  deleteCopy: (user: string, objectUri: string, actorUri: string) => Promise<unknown>
  /** The host's challenge document, for a participation from before its thread was remembered. */
  fetchDocument: (challengeUrl: string) => Promise<QuantChallengeDocument | null>
  /** A GET of the thread URL signed as `user`'s actor; absent where this server cannot sign. */
  fetchThread?: (user: string, url: string) => Promise<unknown>
  createReplyPost: (user: string, input: ReplyPostInput) => Promise<FeedPostRecord>
  getOwnPost: (user: string, postId: string) => Promise<FeedPostRecord | null>
  presentation: ChallengeThreadDeps['presentation']
  resolveTags: (user: string, message: string) => Promise<string[]>
  deliver?: ChallengeThreadDeps['deliver']
  push?: ThreadPush
}

/** The host's challenge document, when the host speaks QuantPub. */
export const fetchHostDocument = async (challengeUrl: string): Promise<QuantChallengeDocument | null> => {
  const canonical = canonicalChallengeUrl(challengeUrl)
  const parsed = canonical == null ? null : parseChallengeUrl(canonical)
  if (parsed == null) return null
  const host = await discoverInstance(parsed.base)
  if (host.kind !== 'quantpub') return null
  return fetchChallengeDocument(
    host.apiBase,
    decodeURIComponent(parsed.username),
    decodeURIComponent(parsed.slug),
  )
}

const httpUrl = (raw: string | null | undefined, schemes: readonly string[]): string | null => {
  if (raw == null) return null
  try {
    const url = new URL(raw)
    return schemes.includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

const itemImages = (item: QuantChallengeThreadItem): TimelineImage[] => {
  const images: TimelineImage[] = []
  for (const attachment of item.attachment ?? []) {
    const url = httpUrl(attachment.url, ['https:'])
    if (url == null) continue
    images.push({
      url,
      ...(attachment.mediaType == null ? {} : { media_type: attachment.mediaType }),
      ...(attachment.name == null || attachment.name === '' ? {} : { name: attachment.name }),
      ...(Number.isInteger(attachment.width) ? { width: attachment.width } : {}),
      ...(Number.isInteger(attachment.height) ? { height: attachment.height } : {}),
    })
    if (images.length >= MAX_ITEM_IMAGES) break
  }
  return images
}

/** A thread document item as a copy row: sanitised, https images only, times clamped to now. */
export const copyRowFromItem = (item: QuantChallengeThreadItem, now: number): ThreadCopyEntryInput | null => {
  const published = Date.parse(item.published)
  if (Number.isNaN(published)) return null
  const publishedAt = new Date(Math.min(published, now))
  const updated = item.updated == null ? Number.NaN : Date.parse(item.updated)
  return {
    actor_uri: item.attributedTo.id,
    audience: item.audience,
    avatar_url: httpUrl(item.attributedTo.icon, ['https:', 'http:']),
    content: sanitizeRemoteHtml(item.content),
    display_name: item.attributedTo.name ?? null,
    edited_at: !Number.isNaN(updated) && updated > published ? new Date(Math.min(updated, now)) : null,
    handle: item.attributedTo.handle ?? null,
    images: itemImages(item),
    in_reply_to_uri: item.inReplyTo,
    kind: item.type,
    object_uri: item.id,
    published_at: publishedAt,
    url: httpUrl(item.url, ['https:', 'http:']),
  }
}

const copyInput = ({
  created_at: _created,
  id: _id,
  participation_id: _participation,
  ...input
}: ThreadCopyEntryRecord): ThreadCopyEntryInput => input

/**
 * Pull the host's thread with a request signed as `user` (which also verifies the member's actor
 * with the host), replace the copy with it and remember the audiences and attendees. The member's
 * own comments of the last `OWN_PENDING_KEEP_MS` that the host has not taken in yet stay.
 */
export const syncRemoteThread = async (
  deps: Pick<
    RemoteThreadDeps,
    'fetchThread' | 'listCopy' | 'now' | 'replaceCopy' | 'updateThreadState' | 'webHost'
  >,
  user: string,
  participation: ChallengeParticipationRecord,
): Promise<ChallengeParticipationRecord> => {
  const { challenge_object_uri: objectUri, thread_url: threadUrl } = participation
  if (deps.fetchThread == null || threadUrl == null || objectUri == null) {
    throw new Error('This participation has no thread to pull')
  }
  const document = quantChallengeThreadSchema.parse(await deps.fetchThread(user, threadUrl))
  if (document.challenge !== objectUri) throw new Error('The thread document is for another challenge')
  const now = deps.now()
  const rows = new Map<string, ThreadCopyEntryInput>()
  for (const item of document.items.slice(0, THREAD_DOCUMENT_LIMIT)) {
    const row = copyRowFromItem(item, now)
    if (row != null && !rows.has(row.object_uri)) rows.set(row.object_uri, row)
  }
  const ownActor = buildActorUrl(deps.webHost, user)
  for (const own of await deps.listCopy(user, participation.id)) {
    if (
      own.actor_uri === ownActor &&
      !rows.has(own.object_uri) &&
      now - own.published_at.getTime() <= OWN_PENDING_KEEP_MS
    ) {
      rows.set(own.object_uri, copyInput(own))
    }
  }
  await deps.replaceCopy(user, participation.id, [...rows.values()])
  const updated = await deps.updateThreadState(user, participation.id, {
    host_actor_uri: document.host,
    thread_attendees: unique(document.attendees ?? []).slice(0, MAX_ATTENDEES),
    thread_audiences: unique(document.audiences) as ChallengeThreadAudience[],
    thread_synced_at: new Date(now),
  })
  return updated ?? participation
}

const isStale = (participation: ChallengeParticipationRecord, now: number): boolean =>
  participation.thread_synced_at == null ||
  now - participation.thread_synced_at.getTime() > THREAD_COPY_MAX_AGE_MS

const hasThread = (participation: ChallengeParticipationRecord): boolean =>
  participation.thread_url != null && participation.challenge_object_uri != null

/** Fill in where the host serves the thread, for a participation from before it was remembered. */
const withThreadInfo = async (
  deps: Pick<RemoteThreadDeps, 'fetchDocument' | 'updateThreadState'>,
  user: string,
  participation: ChallengeParticipationRecord,
): Promise<ChallengeParticipationRecord> => {
  if (hasThread(participation) && participation.host_actor_uri != null) return participation
  const document = await deps.fetchDocument(participation.challenge_url).catch(() => null)
  if (document == null) return participation
  const state = threadStateFromDocument(participation.challenge_url, document)
  if (Object.keys(state).length === 0) return participation
  return (await deps.updateThreadState(user, participation.id, state)) ?? participation
}

/** The user's active participation in a challenge on another server, with its thread up to date. */
const joinedThread = async (
  deps: RemoteThreadDeps,
  user: string,
  challengeUrl: string,
): Promise<{ ok: true; participation: ChallengeParticipationRecord } | ThreadFailure> => {
  const canonical = canonicalChallengeUrl(challengeUrl) ?? challengeUrl
  const found = await deps.getParticipationByUrl(user, canonical)
  if (found == null || found.status !== 'active') return failure(403, NOT_JOINED_MESSAGE)
  const participation = await withThreadInfo(deps, user, found)
  if (!hasThread(participation)) return failure(400, NO_REMOTE_THREAD_MESSAGE)
  if (!isStale(participation, deps.now())) return { ok: true, participation }
  try {
    return { ok: true, participation: await syncRemoteThread(deps, user, participation) }
  } catch (error) {
    console.warn(`⚠️ challenge thread pull failed for ${participation.challenge_url}:`, error)
    if (participation.thread_synced_at == null) return failure(502, HOST_UNREACHABLE_MESSAGE)
    return { ok: true, participation }
  }
}

export const serializeCopyRow = (
  row: ThreadCopyEntryRecord,
  inReplyToId: string | null,
  own: OwnEntry | null,
): ChallengeThreadReply => ({
  audience: row.audience,
  author: {
    actor_uri: row.actor_uri,
    avatar_url: row.avatar_url,
    display_name: row.display_name,
    handle: row.handle,
  },
  content: row.content,
  edited_at: row.edited_at?.toISOString() ?? null,
  hidden: false,
  id: row.id,
  images: row.images,
  in_reply_to_id: inReplyToId,
  kind: row.kind,
  ...(own == null
    ? {}
    : { own_post_id: own.post_id, ...(own.message == null ? {} : { message: own.message }) }),
  published_at: row.published_at.toISOString(),
  url: row.url,
})

const newestFirst = (a: ThreadCopyEntryRecord, b: ThreadCopyEntryRecord): number =>
  b.published_at.getTime() - a.published_at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

export interface CopyPage {
  tops: ThreadCopyEntryRecord[]
  /** Each top-level entry's replies, oldest first. */
  replies: Map<string, ThreadCopyEntryRecord[]>
  /** The entry each reply answers, within its group. */
  parentOf: Map<string, string>
  next_cursor: string | null
}

/**
 * One page of the copy, nested two levels like the host's own read: a top-level entry answers
 * nothing, the challenge object or an entry not in the copy; every other entry hangs under the
 * top-level entry its chain leads to. Pure.
 */
export const pageThreadCopy = (
  rows: readonly ThreadCopyEntryRecord[],
  challengeObjectUri: string,
  cursor?: string,
): CopyPage => {
  const byUri = new Map(rows.map((row) => [row.object_uri, row]))
  const isTop = (row: ThreadCopyEntryRecord): boolean =>
    row.in_reply_to_uri == null ||
    row.in_reply_to_uri === challengeObjectUri ||
    !byUri.has(row.in_reply_to_uri)
  const rootOf = (row: ThreadCopyEntryRecord): ThreadCopyEntryRecord => {
    const seen = new Set<string>()
    let current = row
    while (!isTop(current)) {
      if (seen.has(current.object_uri)) return row
      seen.add(current.object_uri)
      current = byUri.get(current.in_reply_to_uri ?? '') ?? current
    }
    return current
  }
  const groups = new Map<string, ThreadCopyEntryRecord[]>()
  const tops: ThreadCopyEntryRecord[] = []
  for (const row of rows) {
    const root = rootOf(row)
    if (root === row) {
      tops.push(row)
      continue
    }
    groups.set(root.id, [...(groups.get(root.id) ?? []), row])
  }
  tops.sort(newestFirst)
  const decoded = decodeKeysetCursor(cursor)
  const boundary = decoded == null ? null : { id: decoded.id, ms: Date.parse(decoded.ts) }
  const after =
    boundary == null || Number.isNaN(boundary.ms)
      ? tops
      : tops.filter(
          (row) =>
            row.published_at.getTime() < boundary.ms ||
            (row.published_at.getTime() === boundary.ms && row.id < boundary.id),
        )
  const page = after.slice(0, THREAD_PAGE_SIZE)
  const last = page[page.length - 1]
  const replies = new Map<string, ThreadCopyEntryRecord[]>()
  const parentOf = new Map<string, string>()
  for (const top of page) {
    const group = [...(groups.get(top.id) ?? [])]
      .sort((a, b) => -newestFirst(a, b))
      .slice(0, MAX_REPLIES_PER_ENTRY)
    replies.set(top.id, group)
    const idByUri = new Map([top, ...group].map((row) => [row.object_uri, row.id]))
    for (const reply of group) {
      parentOf.set(
        reply.id,
        (reply.in_reply_to_uri == null ? null : idByUri.get(reply.in_reply_to_uri)) ?? top.id,
      )
    }
  }
  return {
    next_cursor:
      after.length > THREAD_PAGE_SIZE && last != null
        ? encodeKeysetCursor(last.published_at.toISOString(), last.id)
        : null,
    parentOf,
    replies,
    tops: page,
  }
}

const ownEntries = async (
  deps: Pick<RemoteThreadDeps, 'getOwnPost' | 'webHost'>,
  user: string,
  rows: readonly ThreadCopyEntryRecord[],
): Promise<Map<string, OwnEntry>> => {
  const own = new Map<string, OwnEntry>()
  await Promise.all(
    rows.map(async (row) => {
      const postId = ownPostIdOf(deps.webHost, user, row)
      if (postId == null) return
      const post = await deps.getOwnPost(user, postId).catch(() => null)
      own.set(row.id, { message: post?.message ?? null, post_id: postId })
    }),
  )
  return own
}

/** One page of the thread of a challenge on another server, from the member's copy. */
export const readRemoteThread = async (
  deps: RemoteThreadDeps,
  user: string,
  challengeUrl: string,
  cursor?: string,
): Promise<({ ok: true } & ChallengeThreadView) | ThreadFailure> => {
  const joined = await joinedThread(deps, user, challengeUrl)
  if (!joined.ok) return joined
  const { participation } = joined
  const rows = await deps.listCopy(user, participation.id)
  const page = pageThreadCopy(rows, participation.challenge_object_uri ?? '', cursor)
  const shown = page.tops.flatMap((top) => [top, ...(page.replies.get(top.id) ?? [])])
  const own = await ownEntries(deps, user, shown)
  const entries: ChallengeThreadEntry[] = page.tops.map((top) => ({
    ...serializeCopyRow(top, null, own.get(top.id) ?? null),
    replies: (page.replies.get(top.id) ?? []).map((reply) =>
      serializeCopyRow(reply, page.parentOf.get(reply.id) ?? top.id, own.get(reply.id) ?? null),
    ),
  }))
  const audiences = participation.thread_audiences
  return {
    entries,
    next_cursor: page.next_cursor,
    ok: true,
    total: rows.length,
    viewer: { audiences, can_comment: audiences.length > 0, role: 'member' },
  }
}

/** Where a member's comment is pushed: the host and the attendees, never the author. */
export const memberRecipients = (
  participation: Pick<ChallengeParticipationRecord, 'host_actor_uri' | 'thread_attendees'>,
  authorActor: string,
): string[] =>
  unique([participation.host_actor_uri, ...participation.thread_attendees]).filter(
    (actor) => actor !== authorActor,
  )

const hostHandle = (challengeUrl: string): string | null => {
  const canonical = canonicalChallengeUrl(challengeUrl)
  const parsed = canonical == null ? null : parseChallengeUrl(canonical)
  if (parsed == null) return null
  try {
    return `@${decodeURIComponent(parsed.username)}@${new URL(parsed.base).host}`
  } catch {
    return null
  }
}

const pushBestEffort = (
  deps: Pick<RemoteThreadDeps, 'push'>,
  user: string,
  post: FeedPostRecord,
  change: 'create' | 'update' | 'delete',
  recipients: string[],
): void => {
  if (deps.push == null || recipients.length === 0) return
  try {
    deps.push(user, post, change, recipients)
  } catch (error) {
    console.warn(`⚠️ challenge comment push failed for post ${post.id}:`, error)
  }
}

const audienceRefusal = (audience: ChallengeThreadAudience): ThreadFailure =>
  failure(
    403,
    audience === 'public'
      ? 'This challenge takes participants-only comments'
      : 'Only the host and members can comment for participants',
  )

/** The participation and the copy row a comment answers, once the member may post with its audience. */
const remoteCommentTarget = async (
  deps: RemoteThreadDeps,
  user: string,
  body: ChallengeCommentBody,
): Promise<
  | { ok: true; participation: ChallengeParticipationRecord; parent: ThreadCopyEntryRecord | null }
  | ThreadFailure
> => {
  const joined = await joinedThread(deps, user, body.challenge_url)
  if (!joined.ok) return joined
  const { participation } = joined
  if (!participation.thread_audiences.includes(body.audience)) return audienceRefusal(body.audience)
  if (body.in_reply_to_id == null) {
    return participation.host_actor_uri == null
      ? failure(502, HOST_UNREACHABLE_MESSAGE)
      : { ok: true, parent: null, participation }
  }
  const parent = await deps.getCopyById(user, body.in_reply_to_id)
  if (parent == null || parent.participation_id !== participation.id) {
    return failure(404, 'Thread entry not found')
  }
  if (parent.audience === 'participants' && body.audience === 'public') {
    return failure(400, 'A reply to a participants-only entry must be participants-only')
  }
  return { ok: true, parent, participation }
}

const remoteReplyTarget = (
  participation: ChallengeParticipationRecord,
  parent: ThreadCopyEntryRecord | null,
): Pick<ReplyPostInput, 'in_reply_to_actor_uri' | 'in_reply_to_handle' | 'in_reply_to_uri'> =>
  parent == null
    ? {
        in_reply_to_actor_uri: participation.host_actor_uri ?? '',
        in_reply_to_handle: hostHandle(participation.challenge_url),
        in_reply_to_uri: participation.challenge_object_uri ?? '',
      }
    : {
        in_reply_to_actor_uri: parent.actor_uri,
        in_reply_to_handle: parent.handle,
        in_reply_to_uri: parent.object_uri,
      }

/**
 * Comment in the thread of a challenge on another server: a `reply` feed post exactly as on the
 * host, a row in the local copy, then the ordinary federation of a public comment and, always, the
 * push to the host and the attendees. The host admits it through its inbox.
 */
export const addRemoteChallengeComment = async (
  deps: RemoteThreadDeps,
  user: string,
  body: ChallengeCommentBody,
): Promise<{ ok: true; entry: ChallengeThreadEntry } | ThreadFailure> => {
  const message = body.message.trim()
  if (message === '') return failure(400, 'A comment needs some text.')
  const target = await remoteCommentTarget(deps, user, body)
  if (!target.ok) return target
  const { parent, participation } = target
  const isPublic = body.audience === 'public'
  const post = await deps.createReplyPost(user, {
    challenge_uri: participation.challenge_object_uri,
    ...remoteReplyTarget(participation, parent),
    message,
    tags: await deps.resolveTags(user, message),
    visibility: isPublic ? 'unlisted' : 'participants',
  })
  const authorActor = buildActorUrl(deps.webHost, user)
  const { entry } = await deps.upsertCopy(user, participation.id, {
    actor_uri: authorActor,
    audience: body.audience,
    ...(await deps.presentation(user)),
    content: renderNoteProse(message),
    edited_at: null,
    images: [],
    in_reply_to_uri: post.in_reply_to_uri,
    kind: 'comment',
    object_uri: `${ownObjectPrefix(deps.webHost, user)}${post.id}`,
    published_at: post.created_at,
    url: isPublic ? buildPostUrl(deps.webHost, user, post.id) : null,
  })
  if (isPublic) deps.deliver?.createdReply(user, post)
  pushBestEffort(deps, user, post, 'create', memberRecipients(participation, authorActor))
  return {
    entry: {
      ...serializeCopyRow(entry, parent?.id ?? null, { message: post.message, post_id: post.id }),
      replies: [],
    },
    ok: true,
  }
}

const ownCommentIn = async (
  deps: Pick<RemoteThreadDeps, 'getParticipationByObjectUri'>,
  user: string,
  post: FeedPostRecord,
): Promise<ChallengeParticipationRecord | null> =>
  post.kind === 'reply' && post.challenge_uri != null
    ? deps.getParticipationByObjectUri(user, post.challenge_uri)
    : null

/** A member's comment was edited: re-render its copy row and push the `Update`. */
export const followRemoteCommentEdit = async (
  deps: RemoteThreadDeps,
  user: string,
  post: FeedPostRecord,
): Promise<void> => {
  const participation = await ownCommentIn(deps, user, post)
  if (participation == null) return
  const objectUri = `${ownObjectPrefix(deps.webHost, user)}${post.id}`
  const existing = await deps.getCopyByObjectUri(user, participation.id, objectUri)
  if (existing != null) {
    await deps.upsertCopy(user, participation.id, {
      actor_uri: existing.actor_uri,
      audience: existing.audience,
      avatar_url: existing.avatar_url,
      content: renderNoteProse(post.message ?? ''),
      display_name: existing.display_name,
      edited_at: post.updated_at.getTime() > post.created_at.getTime() ? post.updated_at : null,
      handle: existing.handle,
      images: existing.images,
      in_reply_to_uri: existing.in_reply_to_uri,
      kind: existing.kind,
      object_uri: existing.object_uri,
      published_at: existing.published_at,
      url: existing.url,
    })
  }
  pushBestEffort(
    deps,
    user,
    post,
    'update',
    memberRecipients(participation, buildActorUrl(deps.webHost, user)),
  )
}

/** A member's comment was deleted: drop its copy row and push the `Delete`. */
export const followRemoteCommentDelete = async (
  deps: RemoteThreadDeps,
  user: string,
  post: FeedPostRecord,
): Promise<void> => {
  const participation = await ownCommentIn(deps, user, post)
  if (participation == null) return
  const authorActor = buildActorUrl(deps.webHost, user)
  await deps.deleteCopy(user, `${ownObjectPrefix(deps.webHost, user)}${post.id}`, authorActor)
  pushBestEffort(deps, user, post, 'delete', memberRecipients(participation, authorActor))
}

/** Pull the thread right after a QuantPub join; never fails the join. */
export const syncAfterJoin = async (
  deps: RemoteThreadDeps,
  user: string,
  participation: ChallengeParticipationRecord,
): Promise<void> => {
  if (!hasThread(participation) || deps.fetchThread == null) return
  try {
    await syncRemoteThread(deps, user, participation)
  } catch (error) {
    console.warn(`⚠️ challenge thread pull after join failed for ${participation.challenge_url}:`, error)
  }
}

export const createRemoteThreadBranch = (deps: RemoteThreadDeps): RemoteThreadBranch => ({
  afterJoin: (user, participation) => syncAfterJoin(deps, user, participation),
  comment: (user, body) => addRemoteChallengeComment(deps, user, body),
  followDelete: (user, post) => followRemoteCommentDelete(deps, user, post),
  followEdit: (user, post) => followRemoteCommentEdit(deps, user, post),
  read: (user, challengeUrl, cursor) => readRemoteThread(deps, user, challengeUrl, cursor),
})

export const createRemoteThreadDeps = (
  base: Pick<
    ChallengeThreadDeps,
    'createReplyPost' | 'deliver' | 'getOwnPost' | 'presentation' | 'push' | 'resolveTags' | 'webHost'
  >,
  fetchThread?: (user: string, url: string) => Promise<unknown>,
): RemoteThreadDeps => ({
  createReplyPost: base.createReplyPost,
  deleteCopy: deleteThreadCopyEntry,
  deliver: base.deliver,
  fetchDocument: fetchHostDocument,
  fetchThread,
  getCopyById: getThreadCopyEntryById,
  getCopyByObjectUri: getThreadCopyEntryByObjectUri,
  getOwnPost: base.getOwnPost,
  getParticipationByObjectUri,
  getParticipationByUrl,
  listCopy: listThreadCopy,
  now: Date.now,
  presentation: base.presentation,
  push: base.push,
  replaceCopy: replaceThreadCopy,
  resolveTags: base.resolveTags,
  updateThreadState: updateParticipationThreadState,
  upsertCopy: upsertThreadCopyEntry,
  webHost: base.webHost,
})

/** How this server pushes comments and pulls threads; absent in tests and on a server without federation. */
export interface ThreadFederation {
  push?: ThreadPush
  signal?: ThreadSignal
  fetchThread?: (user: string, url: string) => Promise<unknown>
}

export interface ThreadDepsOptions extends ChallengeThreadDepsOptions {
  fetchThread?: (user: string, url: string) => Promise<unknown>
}

/** The thread deps with the branch for challenges hosted on another server. */
export const createThreadDeps = (opts: ThreadDepsOptions): ChallengeThreadDeps => {
  const base = createChallengeThreadDeps(opts)
  return { ...base, remote: createRemoteThreadBranch(createRemoteThreadDeps(base, opts.fetchThread)) }
}

/** A GET signed as `user`'s actor (its RSA key), through the SSRF-safe fetch. */
export const createSignedThreadFetch =
  (federation: Federation<void>, origin: string, get: typeof safeFetchGet = safeFetchGet) =>
  async (user: string, url: string): Promise<unknown> => {
    const ctx = federation.createContext(new URL(origin))
    const pairs = await ctx.getActorKeyPairs(user)
    const rsa = pairs.find((pair) => pair.privateKey.algorithm.name === 'RSASSA-PKCS1-v1_5')
    if (rsa == null) throw new Error(`No signing key for ${user}`)
    const signed = await signRequest(
      new Request(url, { headers: { Accept: 'application/json' }, method: 'GET' }),
      rsa.privateKey,
      rsa.keyId,
    )
    const headers: Record<string, string> = {}
    signed.headers.forEach((value, key) => {
      headers[key] = value
    })
    return (await get(url, { headers })).data
  }

export interface PushedThreadDeps {
  now: () => number
  getParticipationByObjectUri: (
    user: string,
    objectUri: string,
  ) => Promise<ChallengeParticipationRecord | null>
  getCopyByObjectUri: (
    user: string,
    participationId: string,
    objectUri: string,
  ) => Promise<ThreadCopyEntryRecord | null>
  upsertCopy: RemoteThreadDeps['upsertCopy']
  updateThreadState: RemoteThreadDeps['updateThreadState']
  deleteCopy: (user: string, objectUri: string, actorUri: string) => Promise<unknown>
  /** One participation's copy of an entry, whoever wrote it. */
  removeCopy: (user: string, participationId: string, objectUri: string) => Promise<unknown>
  notify?: (user: string, input: RaiseNotificationInput) => Promise<void>
}

export const createPushedThreadDeps = (): PushedThreadDeps => ({
  deleteCopy: deleteThreadCopyEntry,
  getCopyByObjectUri: getThreadCopyEntryByObjectUri,
  getParticipationByObjectUri,
  notify: notifier.raiseBestEffort,
  now: Date.now,
  removeCopy: deleteParticipationThreadCopyEntry,
  updateThreadState: updateParticipationThreadState,
  upsertCopy: upsertThreadCopyEntry,
})

const participationInContext = async (
  deps: Pick<PushedThreadDeps, 'getParticipationByObjectUri'>,
  me: string,
  note: Note,
): Promise<ChallengeParticipationRecord | null> => {
  for (const context of note.contextIds) {
    const participation = await deps.getParticipationByObjectUri(me, context.href)
    if (participation != null) return participation
  }
  return null
}

/**
 * The participation a pushed Note is for, when its sender may push there. An unknown sender marks
 * the copy stale, at most once every `FORCED_PULL_MIN_INTERVAL_MS`.
 */
const pushTarget = async (
  deps: PushedThreadDeps,
  input: InboundThreadNote,
): Promise<ChallengeParticipationRecord | null> => {
  const { actor_uri: actorUri, me, note, origin } = input
  if (note.id == null || note.published == null || actorUri === buildActorUrl(origin, me)) return null
  const participation = await participationInContext(deps, me, note)
  if (participation == null) return null
  if (actorUri !== participation.host_actor_uri && !participation.thread_attendees.includes(actorUri)) {
    const syncedAt = participation.thread_synced_at?.getTime()
    if (syncedAt == null || deps.now() - syncedAt > FORCED_PULL_MIN_INTERVAL_MS) {
      await deps.updateThreadState(me, participation.id, { thread_synced_at: null })
    }
    return null
  }
  if (!isSendersNote(note.id, note, actorUri)) return null
  const existing = await deps.getCopyByObjectUri(me, participation.id, note.id.href)
  return existing == null || existing.actor_uri === actorUri ? participation : null
}

const pushedCopyRow = async (
  note: Note,
  noteId: URL,
  published: Temporal.Instant,
  author: Pick<ThreadCopyEntryInput, 'actor_uri' | 'avatar_url' | 'display_name' | 'handle'>,
  now: number,
): Promise<ThreadCopyEntryInput> => {
  const publishedAt = temporalInstantToDate(published)
  const updatedAt = note.updated == null ? null : temporalInstantToDate(note.updated)
  const isPublic = [...note.toIds, ...note.ccIds].some((uri) => uri.href === AS_PUBLIC)
  return {
    ...author,
    audience: isPublic ? 'public' : 'participants',
    content: sanitizeRemoteHtml(note.content?.toString() ?? ''),
    edited_at:
      updatedAt != null && updatedAt.getTime() > publishedAt.getTime() ? clampToNow(updatedAt, now) : null,
    images: await extractNoteImages(note),
    in_reply_to_uri: note.replyTargetIds[0]?.href ?? null,
    kind: 'comment',
    object_uri: noteId.href,
    published_at: clampToNow(publishedAt, now),
    url: noteLinkUrl(note, noteId),
  }
}

export const pushedCommentNotification = (
  participation: Pick<ChallengeParticipationRecord, 'challenge_object_uri' | 'challenge_url' | 'id' | 'name'>,
  entry: Pick<
    ThreadCopyEntryRecord,
    'actor_uri' | 'content' | 'display_name' | 'handle' | 'in_reply_to_uri' | 'object_uri'
  >,
): RaiseNotificationInput => {
  const body = htmlSnippet(entry.content)
  const isReply =
    entry.in_reply_to_uri != null && entry.in_reply_to_uri !== participation.challenge_object_uri
  return {
    ...(body === '' ? {} : { body }),
    data: { actor_uri: entry.actor_uri, challenge_url: participation.challenge_url },
    dedupe_key: `challenge_comment:${entry.object_uri}`,
    link: `/challenges/joined/${participation.id}#comments`,
    title: `${actorLabel(entry)} ${isReply ? 'replied in' : 'commented in'} ${participation.name}`,
    type: 'challenge_comment',
  }
}

/**
 * A comment the host or an attendee pushed into the thread of a challenge `me` joined on another
 * server: stored in the copy, `challenge_comment` raised once. An unknown sender is not stored but
 * marks the copy stale, so the next read pulls the host's current attendees. Null when the Note is
 * for no such thread.
 */
export const admitPushedThreadNote = async (
  deps: PushedThreadDeps,
  input: InboundThreadNote,
): Promise<{ quiet: true } | null> => {
  const participation = await pushTarget(deps, input)
  const { note } = input
  if (participation == null || note.id == null || note.published == null) return null
  const presentation = await input.presentation()
  if (presentation == null) return null
  const row = await pushedCopyRow(
    note,
    note.id,
    note.published,
    { ...presentation, actor_uri: input.actor_uri },
    deps.now(),
  )
  const { entry, inserted } = await deps.upsertCopy(input.me, participation.id, row)
  if (inserted && deps.notify != null) {
    await deps.notify(input.me, pushedCommentNotification(participation, entry))
  }
  return { quiet: true }
}

export interface HostThreadSignal {
  /** The local user whose inbox the activity reached. */
  me: string
  /** The signature-verified sender. */
  actor_uri: string
  kind: ThreadSignalKind
  object_uri: string
  target_uri: string
}

/**
 * The host's `Remove` (an entry hidden) or `Add` (an entry unhidden or taken in without a push) for
 * a challenge `me` joined on another server: a `Remove` drops that copy row, whoever wrote it, and
 * both mark the copy stale so the next read pulls the host's document. Anything not from that
 * participation's host is ignored. Whether it applied.
 */
export const applyHostThreadSignal = async (
  deps: Pick<PushedThreadDeps, 'getParticipationByObjectUri' | 'removeCopy' | 'updateThreadState'>,
  signal: HostThreadSignal,
): Promise<boolean> => {
  const participation = await deps.getParticipationByObjectUri(signal.me, signal.target_uri)
  if (participation?.host_actor_uri == null || participation.host_actor_uri !== signal.actor_uri) return false
  if (signal.kind === 'remove') await deps.removeCopy(signal.me, participation.id, signal.object_uri)
  await deps.updateThreadState(signal.me, participation.id, { thread_synced_at: null })
  return true
}
