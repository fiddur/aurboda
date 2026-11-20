/**
 * The comment thread of a challenge hosted on this instance, shared by the REST `/challenges/thread`
 * routes and the MCP challenge tools. Entries are snapshots in the host's database keyed by the
 * Note id of the post behind them (the post lives in its author's database): a comment, a share's
 * personal note, or the host's result post. `admitThreadEntry` is the one way in.
 */
import type {
  ChallengeCommentBody,
  ChallengeThreadAudience,
  ChallengeThreadEntry,
  ChallengeThreadEntryKind,
  ChallengeThreadReply,
  ChallengeThreadRole,
  ChallengeThreadViewer,
  FeedPost,
  TimelineImage,
} from '@aurboda/api-spec'

import { canonicalChallengeUrl, parseChallengeUrl } from '@aurboda/api-spec'

import type {
  ChallengeMemberRecord,
  ChallengeParticipationRecord,
  ChallengeRecord,
  ChallengeThreadCursor,
  ChallengeThreadEntryInput,
  ChallengeThreadEntryPageRow,
  ChallengeThreadEntryRecord,
  FeedPostRecord,
  ReplyPostInput,
  ThreadVisibility,
} from '../db/index.ts'
import type { FeedDeliver } from '../routes/feed-router.ts'
import type { RaiseNotificationInput } from './notifications.ts'

import {
  countChallengeThreadEntries,
  countVisibleChallengeThreadEntries,
  createReplyPost,
  deleteChallengeThreadEntry,
  deleteFeedPostWithQuotes,
  getChallengeBySlug,
  getChallengeThreadEntryById,
  getChallengeThreadEntryByObjectUri,
  getFeedPostById,
  getParticipationByObjectUri,
  getProfileAvatarVersion,
  getUserSettings,
  isMissingDatabase,
  listChallengeMembers,
  listChallengeThreadReplies,
  listChallengeThreadTopLevel,
  setChallengeThreadEntryHidden as setEntryHiddenInDb,
  upsertChallengeThreadEntry,
} from '../db/index.ts'
import { isValidUsername } from './account-signup.ts'
import { identityToActorUri, renderChallengeShareHtml } from './activitypub/challenge-object.ts'
import { renderNoteProse } from './activitypub/note-prose.ts'
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor.ts'
import { notifier } from './notifications.ts'
import { resolvePostTags } from './post-tags.ts'
import {
  buildActorUrl,
  buildChallengeObjectUrl,
  buildPostUrl,
  buildProfileUrl,
  buildShareUrl,
} from './share-urls.ts'
import { actorLabel, htmlSnippet } from './social-notifications.ts'
import { ownObjectPrefix } from './timeline.ts'

export const MAX_THREAD_ENTRIES = 2000
export const THREAD_PAGE_SIZE = 20
export const MAX_REPLIES_PER_ENTRY = 200

export const OTHER_SERVER_MESSAGE = 'Comments on challenges hosted on another server are not available yet'

export interface ThreadFailure {
  ok: false
  status: 400 | 403 | 404 | 409 | 502 | 503
  error: string
}

export const failure = (status: ThreadFailure['status'], error: string): ThreadFailure => ({
  error,
  ok: false,
  status,
})

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

/** A challenge page URL (`<webHost>/u/<user>/<slug>`) on this instance → its host and slug. */
export const parseChallengePageUrl = (
  webHost: string,
  challengeUrl: string,
): { username: string; slug: string } | null => {
  const canonical = canonicalChallengeUrl(challengeUrl)
  const parsed = canonical == null ? null : parseChallengeUrl(canonical)
  if (canonical == null || parsed == null) return null
  const base = canonicalChallengeUrl(webHost)
  if (base == null || parsed.base !== trimSlashes(base)) return null
  if (canonical.slice(base.length + '/u/'.length).split('/').length !== 2) return null
  try {
    return { slug: decodeURIComponent(parsed.slug), username: decodeURIComponent(parsed.username) }
  } catch {
    return null
  }
}

/** A hosted challenge's object id (`<webHost>/users/<user>/challenges/<slug>`) → its host and slug. */
export const parseChallengeObjectUrl = (
  webHost: string,
  objectUri: string,
): { username: string; slug: string } | null => {
  const prefix = `${trimSlashes(webHost)}/users/`
  if (!objectUri.startsWith(prefix)) return null
  const segments = objectUri.slice(prefix.length).split('/')
  if (segments.length !== 3 || segments[1] !== 'challenges' || !segments[0] || !segments[2]) return null
  try {
    return { slug: decodeURIComponent(segments[2]), username: decodeURIComponent(segments[0]) }
  } catch {
    return null
  }
}

export type LoadChallenge = (host: string, slug: string) => Promise<ChallengeRecord | null>

/** A hosted challenge by host and slug; null for an unknown user or slug. */
export const loadHostedChallenge: LoadChallenge = async (host, slug) => {
  if (!isValidUsername(host)) return null
  try {
    return await getChallengeBySlug(host, slug)
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
}

export interface HostedChallenge {
  host: string
  challenge: ChallengeRecord
}

export const resolveHostedChallenge = async (
  webHost: string,
  challengeUrl: string,
  loadChallenge: LoadChallenge = loadHostedChallenge,
): Promise<({ ok: true } & HostedChallenge) | ThreadFailure> => {
  const canonical = canonicalChallengeUrl(challengeUrl)
  const parsed = canonical == null ? null : parseChallengeUrl(canonical)
  if (parsed == null) return failure(400, 'Not a challenge page URL')
  const local = parseChallengePageUrl(webHost, challengeUrl)
  if (local == null) return failure(400, OTHER_SERVER_MESSAGE)
  const challenge = await loadChallenge(local.username, local.slug)
  if (challenge == null) return failure(404, 'Challenge not found')
  return { challenge, host: local.username, ok: true }
}

/** A challenge page URL that names another server. */
export const isOtherServerChallengeUrl = (webHost: string, challengeUrl: string): boolean => {
  const canonical = canonicalChallengeUrl(challengeUrl)
  const parsed = canonical == null ? null : parseChallengeUrl(canonical)
  return parsed != null && parseChallengePageUrl(webHost, challengeUrl) == null
}

/**
 * The challenge's current name and page, for a post in its thread: a challenge hosted here, or one
 * the post's owner joined on another server. Undefined when it is gone.
 */
export const resolveInChallenge = async (
  webHost: string,
  challengeUri: string,
  owner: string | null = null,
  loadChallenge: LoadChallenge = loadHostedChallenge,
  loadParticipation: (
    user: string,
    objectUri: string,
  ) => Promise<Pick<
    ChallengeParticipationRecord,
    'challenge_url' | 'name'
  > | null> = getParticipationByObjectUri,
): Promise<FeedPost['in_challenge']> => {
  const parsed = parseChallengeObjectUrl(webHost, challengeUri)
  if (parsed == null) {
    if (owner == null) return undefined
    const participation = await loadParticipation(owner, challengeUri).catch(() => null)
    return participation == null ? undefined : { name: participation.name, url: participation.challenge_url }
  }
  const challenge = await loadChallenge(parsed.username, parsed.slug).catch(() => null)
  return challenge == null
    ? undefined
    : { name: challenge.name, url: buildShareUrl(webHost, parsed.username, challenge.slug) }
}

const isActiveLocalMember = (member: ChallengeMemberRecord, user: string): boolean =>
  member.kind === 'local' && member.status === 'active' && member.local_user === user

export const challengeThreadRole = (
  host: string,
  members: readonly ChallengeMemberRecord[],
  viewer: string | null,
): ChallengeThreadRole => {
  if (viewer == null) return 'visitor'
  if (viewer === host) return 'host'
  return members.some((member) => isActiveLocalMember(member, viewer)) ? 'member' : 'visitor'
}

/** The audiences a viewer may post with; a signed-out visitor posts with none. */
export const allowedAudiences = (
  role: ChallengeThreadRole,
  challenge: Pick<ChallengeRecord, 'is_public'>,
  signedIn = true,
): ChallengeThreadAudience[] => {
  if (role === 'visitor') return challenge.is_public && signedIn ? ['public'] : []
  return challenge.is_public ? ['public', 'participants'] : ['participants']
}

/** The audiences a viewer may read. */
export const readableAudiences = (
  role: ChallengeThreadRole,
  challenge: Pick<ChallengeRecord, 'is_public'>,
): ChallengeThreadAudience[] => {
  if (role !== 'visitor') return ['public', 'participants']
  return challenge.is_public ? ['public'] : []
}

/** Whether `actorUri` is the host or an active member of the challenge. */
export const isThreadParticipant = (
  webHost: string,
  host: string,
  members: readonly ChallengeMemberRecord[],
  actorUri: string,
): boolean =>
  actorUri === buildActorUrl(webHost, host) ||
  members.some((member) => {
    if (member.status !== 'active') return false
    if (member.kind === 'local') {
      return member.local_user != null && buildActorUrl(webHost, member.local_user) === actorUri
    }
    return member.actor === actorUri || identityToActorUri(member.identity_base_url) === actorUri
  })

export interface ThreadAuthor {
  actor_uri: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
}

export interface ThreadCandidate {
  object_uri: string
  /** The challenge object id, an entry's `object_uri`, or null (a share or the result). */
  in_reply_to_uri: string | null
  kind: ChallengeThreadEntryKind
  audience: ChallengeThreadAudience
  author: ThreadAuthor
  content: string
  images: TimelineImage[]
  url: string | null
  published_at: Date
  edited_at: Date | null
}

export type AdmissionRefusal =
  | 'not_participant'
  | 'unknown_parent'
  | 'wider_than_parent'
  | 'thread_full'
  | 'not_author'

export interface AdmissionFacts {
  challenge: Pick<ChallengeRecord, 'id' | 'is_public'>
  challenge_object_uri: string
  is_participant: boolean
  /** The entry `in_reply_to_uri` names, when it names one. */
  parent: Pick<ChallengeThreadEntryRecord, 'id' | 'challenge_id' | 'audience' | 'root_entry_id'> | null
  /** The entry already stored under the candidate's `object_uri`. */
  existing: Pick<
    ChallengeThreadEntryRecord,
    'actor_uri' | 'audience' | 'challenge_id' | 'kind' | 'root_entry_id'
  > | null
  entry_count: number
}

export type AdmissionDecision =
  | { admitted: true; audience: ChallengeThreadAudience; root_entry_id: string | null }
  | { admitted: false; reason: AdmissionRefusal }

/** An edit keeps its place: its author may have left, or the entry it answered may be gone. */
const decideEdit = (
  candidate: ThreadCandidate,
  existing: NonNullable<AdmissionFacts['existing']>,
  challengeId: string,
  audience: ChallengeThreadAudience,
): AdmissionDecision | null => {
  if (existing.actor_uri !== candidate.author.actor_uri || existing.challenge_id !== challengeId) {
    return { admitted: false, reason: 'not_author' }
  }
  return existing.kind === 'comment' && candidate.kind === 'comment' && existing.audience === audience
    ? { admitted: true, audience, root_entry_id: existing.root_entry_id }
    : null
}

/** Who may write what where. Pure. */
export const decideAdmission = (candidate: ThreadCandidate, facts: AdmissionFacts): AdmissionDecision => {
  const audience: ChallengeThreadAudience = facts.challenge.is_public ? candidate.audience : 'participants'
  if (facts.existing != null) {
    const edit = decideEdit(candidate, facts.existing, facts.challenge.id, audience)
    if (edit != null) return edit
  } else if (facts.entry_count >= MAX_THREAD_ENTRIES) {
    return { admitted: false, reason: 'thread_full' }
  }
  if (audience === 'participants' && !facts.is_participant) {
    return { admitted: false, reason: 'not_participant' }
  }
  if (candidate.kind !== 'comment' || candidate.in_reply_to_uri === facts.challenge_object_uri) {
    return { admitted: true, audience, root_entry_id: null }
  }
  if (facts.parent == null || facts.parent.challenge_id !== facts.challenge.id) {
    return { admitted: false, reason: 'unknown_parent' }
  }
  if (facts.parent.audience === 'participants' && audience === 'public') {
    return { admitted: false, reason: 'wider_than_parent' }
  }
  return { admitted: true, audience, root_entry_id: facts.parent.root_entry_id ?? facts.parent.id }
}

export const ADMISSION_FAILURES: Record<AdmissionRefusal, ThreadFailure> = {
  not_author: failure(409, 'That entry belongs to someone else'),
  not_participant: failure(403, 'Only the host and members can comment for participants'),
  thread_full: failure(409, `This thread is full (${MAX_THREAD_ENTRIES} entries)`),
  unknown_parent: failure(404, 'Thread entry not found'),
  wider_than_parent: failure(400, 'A reply to a participants-only entry must be participants-only'),
}

export interface ThreadNotification {
  user: string
  input: RaiseNotificationInput
}

/** `challenge_comment` for the host and every local active member but the author. Pure. */
export const challengeCommentNotifications = (
  webHost: string,
  host: string,
  challenge: Pick<ChallengeRecord, 'name' | 'slug'>,
  members: readonly ChallengeMemberRecord[],
  entry: Pick<
    ChallengeThreadEntryRecord,
    'actor_uri' | 'content' | 'display_name' | 'handle' | 'object_uri' | 'root_entry_id'
  >,
): ThreadNotification[] => {
  const recipients = new Set([host])
  for (const member of members) {
    if (member.kind === 'local' && member.status === 'active' && member.local_user != null) {
      recipients.add(member.local_user)
    }
  }
  const author = actorLabel(entry)
  const body = htmlSnippet(entry.content)
  return [...recipients]
    .filter((user) => buildActorUrl(webHost, user) !== entry.actor_uri)
    .map((user) => ({
      input: {
        ...(body === '' ? {} : { body }),
        data: { actor_uri: entry.actor_uri, challenge_url: buildShareUrl(webHost, host, challenge.slug) },
        dedupe_key: `challenge_comment:${entry.object_uri}`,
        link: `/u/${encodeURIComponent(host)}/${encodeURIComponent(challenge.slug)}#comments`,
        title: `${author} ${entry.root_entry_id == null ? 'commented in' : 'replied in'} ${challenge.name}`,
        type: 'challenge_comment',
      },
      user,
    }))
}

export interface AdmitDeps {
  webHost: string
  listMembers: (host: string, challengeId: string) => Promise<ChallengeMemberRecord[]>
  getEntryByObjectUri: (host: string, objectUri: string) => Promise<ChallengeThreadEntryRecord | null>
  countEntries: (host: string, challengeId: string) => Promise<number>
  upsert: (
    host: string,
    input: ChallengeThreadEntryInput,
  ) => Promise<{ entry: ChallengeThreadEntryRecord; inserted: boolean } | null>
  notify?: (user: string, input: RaiseNotificationInput) => Promise<void>
  signal?: ThreadSignal
}

export type AdmitResult =
  | { admitted: true; entry: ChallengeThreadEntryRecord; created: boolean }
  | { admitted: false; reason: AdmissionRefusal }

/**
 * THE way into a thread: applies `decideAdmission`, resolves the root, upserts on `object_uri`,
 * and on a newly created, visible comment raises `challenge_comment` for the other side.
 */
export const admitThreadEntry = async (
  deps: AdmitDeps,
  host: string,
  challenge: ChallengeRecord,
  candidate: ThreadCandidate,
): Promise<AdmitResult> => {
  const challengeObjectUri = buildChallengeObjectUrl(deps.webHost, host, challenge.slug)
  const needsParent =
    candidate.kind === 'comment' &&
    candidate.in_reply_to_uri != null &&
    candidate.in_reply_to_uri !== challengeObjectUri
  const [members, existing, parent, count] = await Promise.all([
    deps.listMembers(host, challenge.id),
    deps.getEntryByObjectUri(host, candidate.object_uri),
    needsParent && candidate.in_reply_to_uri != null
      ? deps.getEntryByObjectUri(host, candidate.in_reply_to_uri)
      : Promise.resolve(null),
    deps.countEntries(host, challenge.id),
  ])
  const decision = decideAdmission(candidate, {
    challenge,
    challenge_object_uri: challengeObjectUri,
    entry_count: count,
    existing,
    is_participant: isThreadParticipant(deps.webHost, host, members, candidate.author.actor_uri),
    parent,
  })
  if (!decision.admitted) return decision
  const stored = await deps.upsert(host, {
    actor_uri: candidate.author.actor_uri,
    audience: decision.audience,
    avatar_url: candidate.author.avatar_url,
    challenge_id: challenge.id,
    content: candidate.content,
    display_name: candidate.author.display_name,
    edited_at: candidate.edited_at,
    handle: candidate.author.handle,
    images: candidate.images,
    in_reply_to_uri: candidate.in_reply_to_uri,
    kind: candidate.kind,
    object_uri: candidate.object_uri,
    published_at: candidate.published_at,
    root_entry_id: decision.root_entry_id,
    url: candidate.url,
  })
  if (stored == null) return { admitted: false, reason: 'not_author' }
  if (stored.inserted && stored.entry.kind === 'comment' && stored.entry.hidden_at == null && deps.notify) {
    const notify = deps.notify
    await Promise.all(
      challengeCommentNotifications(deps.webHost, host, challenge, members, stored.entry).map((n) =>
        notify(n.user, n.input),
      ),
    )
  }
  return { admitted: true, created: stored.inserted, entry: stored.entry }
}

export interface OwnEntry {
  post_id: string
  message: string | null
}

export const serializeThreadReply = (
  record: ChallengeThreadEntryRecord,
  inReplyToId: string | null,
  own: OwnEntry | null,
): ChallengeThreadReply => ({
  audience: record.audience,
  author: {
    actor_uri: record.actor_uri,
    avatar_url: record.avatar_url,
    display_name: record.display_name,
    handle: record.handle,
  },
  content: record.content,
  edited_at: record.edited_at?.toISOString() ?? null,
  hidden: record.hidden_at != null,
  id: record.id,
  images: record.images,
  in_reply_to_id: inReplyToId,
  kind: record.kind,
  ...(own == null
    ? {}
    : { own_post_id: own.post_id, ...(own.message == null ? {} : { message: own.message }) }),
  published_at: record.published_at.toISOString(),
  url: record.url,
})

/** The viewer's own feed post id behind an entry, or null when the viewer did not write it. */
export const ownPostIdOf = (
  webHost: string,
  viewer: string | null,
  record: Pick<ChallengeThreadEntryRecord, 'actor_uri' | 'object_uri'>,
): string | null => {
  if (viewer == null || record.actor_uri !== buildActorUrl(webHost, viewer)) return null
  const prefix = ownObjectPrefix(webHost, viewer)
  if (!record.object_uri.startsWith(prefix)) return null
  const postId = record.object_uri.slice(prefix.length)
  return /^[0-9a-f-]{36}$/i.test(postId) ? postId : null
}

/** A top-level entry's replies as a viewer sees them: without hidden ones and what answers them, unless `includeHidden`. */
const visibleReplies = (
  group: readonly ChallengeThreadEntryRecord[],
  includeHidden: boolean,
): ChallengeThreadEntryRecord[] => {
  if (includeHidden) return [...group]
  const dropped = new Set<string>()
  return group.filter((reply) => {
    const gone =
      reply.hidden_at != null || (reply.in_reply_to_uri != null && dropped.has(reply.in_reply_to_uri))
    if (gone) dropped.add(reply.object_uri)
    return !gone
  })
}

/**
 * Nest each page's replies (oldest first) under their top-level entry, at most
 * `MAX_REPLIES_PER_ENTRY` of those the viewer sees; `in_reply_to_id` resolved within the group. Pure.
 */
export const assembleThread = (
  tops: readonly ChallengeThreadEntryRecord[],
  replies: readonly ChallengeThreadEntryRecord[],
  ownOf: (record: ChallengeThreadEntryRecord) => OwnEntry | null,
  includeHidden = true,
): ChallengeThreadEntry[] =>
  tops.map((top) => {
    const group = visibleReplies(
      replies.filter((reply) => reply.root_entry_id === top.id),
      includeHidden,
    ).slice(0, MAX_REPLIES_PER_ENTRY)
    const idByUri = new Map([top, ...group].map((record) => [record.object_uri, record.id]))
    return {
      ...serializeThreadReply(top, null, ownOf(top)),
      replies: group.map((reply) =>
        serializeThreadReply(
          reply,
          (reply.in_reply_to_uri == null ? null : idByUri.get(reply.in_reply_to_uri)) ?? top.id,
          ownOf(reply),
        ),
      ),
    }
  })

export interface ThreadReadDeps {
  webHost: string
  listMembers: (host: string, challengeId: string) => Promise<ChallengeMemberRecord[]>
  listTopLevel: (
    host: string,
    challengeId: string,
    visibility: ThreadVisibility,
    limit: number,
    before?: ChallengeThreadCursor,
  ) => Promise<ChallengeThreadEntryPageRow[]>
  listReplies: (
    host: string,
    rootIds: readonly string[],
    visibility: ThreadVisibility,
    perRoot: number,
  ) => Promise<ChallengeThreadEntryRecord[]>
  countVisible: (host: string, challengeId: string, visibility: ThreadVisibility) => Promise<number>
  getOwnPost: (user: string, postId: string) => Promise<FeedPostRecord | null>
}

export interface ChallengeThreadView {
  entries: ChallengeThreadEntry[]
  next_cursor: string | null
  total: number
  viewer: ChallengeThreadViewer
}

const viewerOf = (
  role: ChallengeThreadRole,
  challenge: ChallengeRecord,
  signedIn: boolean,
): ChallengeThreadViewer => {
  const audiences = allowedAudiences(role, challenge, signedIn)
  return { audiences, can_comment: audiences.length > 0, role }
}

const loadOwn = async (
  deps: Pick<ThreadReadDeps, 'getOwnPost' | 'webHost'>,
  viewer: string | null,
  records: readonly ChallengeThreadEntryRecord[],
): Promise<Map<string, OwnEntry>> => {
  const own = new Map<string, OwnEntry>()
  if (viewer == null) return own
  await Promise.all(
    records.map(async (record) => {
      const postId = ownPostIdOf(deps.webHost, viewer, record)
      if (postId == null) return
      const post = await deps.getOwnPost(viewer, postId).catch(() => null)
      own.set(record.id, { message: post?.message ?? null, post_id: postId })
    }),
  )
  return own
}

/** One page of a thread as `viewer` (null: signed out) may see it; an admin sees hidden entries as the host does. */
export const getChallengeThread = async (
  deps: ThreadReadDeps,
  hosted: HostedChallenge,
  viewer: string | null,
  cursor?: string,
  isAdmin = false,
): Promise<ChallengeThreadView> => {
  const { challenge, host } = hosted
  const members = await deps.listMembers(host, challenge.id)
  const role = challengeThreadRole(host, members, viewer)
  const audiences = readableAudiences(role, challenge)
  const viewerInfo = viewerOf(role, challenge, viewer != null)
  if (audiences.length === 0) return { entries: [], next_cursor: null, total: 0, viewer: viewerInfo }
  const seesHidden = role === 'host' || (isAdmin && viewer != null)
  const visibility: ThreadVisibility = { audiences, include_hidden: seesHidden }
  const decoded = decodeKeysetCursor(cursor)
  const [rows, total] = await Promise.all([
    deps.listTopLevel(
      host,
      challenge.id,
      visibility,
      THREAD_PAGE_SIZE + 1,
      decoded == null ? undefined : { id: decoded.id, published_at: decoded.ts },
    ),
    deps.countVisible(host, challenge.id, visibility),
  ])
  const hasMore = rows.length > THREAD_PAGE_SIZE
  const page = hasMore ? rows.slice(0, THREAD_PAGE_SIZE) : rows
  const last = page[page.length - 1]
  const replies = await deps.listReplies(
    host,
    page.map((row) => row.id),
    { audiences, include_hidden: true },
    seesHidden ? MAX_REPLIES_PER_ENTRY : MAX_THREAD_ENTRIES,
  )
  const own = await loadOwn(deps, viewer, [...page, ...replies])
  return {
    entries: assembleThread(page, replies, (record) => own.get(record.id) ?? null, seesHidden),
    next_cursor: hasMore && last ? encodeKeysetCursor(last.cursor_ts, last.id) : null,
    total,
    viewer: viewerInfo,
  }
}

export type ThreadPushChange = 'create' | 'update' | 'delete'

/**
 * A challenge comment pushed with ordinary ActivityPub to the members on other servers (or, from a
 * member's server, to the host and the attendees); fire and forget.
 */
export type ThreadPush = (
  user: string,
  post: FeedPostRecord,
  change: ThreadPushChange,
  recipients: string[],
) => void

export type ThreadSignalKind = 'add' | 'remove'

/**
 * The host telling the members on other servers about an entry no push carried: `remove` when it
 * was hidden, `add` when it was unhidden or taken in from elsewhere; fire and forget.
 */
export type ThreadSignal = (
  host: string,
  kind: ThreadSignalKind,
  entryObjectUri: string,
  challengeObjectUri: string,
  recipients: string[],
) => void

/** The thread of a challenge hosted on another server, as a member reads and writes it from here. */
export interface RemoteThreadBranch {
  read: (
    user: string,
    challengeUrl: string,
    cursor?: string,
  ) => Promise<({ ok: true } & ChallengeThreadView) | ThreadFailure>
  comment: (
    user: string,
    body: ChallengeCommentBody,
  ) => Promise<{ ok: true; entry: ChallengeThreadEntry } | ThreadFailure>
  followEdit: (user: string, post: FeedPostRecord) => Promise<unknown>
  followDelete: (user: string, post: FeedPostRecord) => Promise<unknown>
  /** Pull the thread right after a join; never fails. */
  afterJoin: (user: string, participation: ChallengeParticipationRecord) => Promise<void>
}

/**
 * `getChallengeThread` by page URL: a challenge hosted here, or (through the remote branch) one
 * hosted on another server that `viewer` joined.
 */
export const readChallengeThread = async (
  deps: ThreadReadDeps & Pick<ThreadPostDeps, 'loadChallenge' | 'remote'>,
  viewer: string,
  challengeUrl: string,
  cursor?: string,
  isAdmin = false,
): Promise<({ ok: true } & ChallengeThreadView) | ThreadFailure> => {
  if (deps.remote != null && isOtherServerChallengeUrl(deps.webHost, challengeUrl)) {
    return deps.remote.read(viewer, challengeUrl, cursor)
  }
  const resolved = await resolveHostedChallenge(deps.webHost, challengeUrl, deps.loadChallenge)
  if (!resolved.ok) return resolved
  return { ok: true, ...(await getChallengeThread(deps, resolved, viewer, cursor, isAdmin)) }
}

export interface ThreadPostDeps {
  createReplyPost: (user: string, input: ReplyPostInput) => Promise<FeedPostRecord>
  deletePost: (user: string, postId: string) => Promise<unknown>
  getEntryById: (host: string, id: string) => Promise<ChallengeThreadEntryRecord | null>
  /** The local user's handle, display name and avatar, as their actor document gives them. */
  presentation: (user: string) => Promise<Omit<ThreadAuthor, 'actor_uri'>>
  resolveTags: (user: string, message: string) => Promise<string[]>
  loadChallenge: LoadChallenge
  deleteEntry: (host: string, objectUri: string, actorUri: string) => Promise<unknown>
  setHidden: (
    host: string,
    challengeId: string,
    entryId: string,
    hidden: boolean,
  ) => Promise<ChallengeThreadEntryRecord | null>
  deliver?: Pick<FeedDeliver, 'createdReply'>
  push?: ThreadPush
  remote?: RemoteThreadBranch
}

export type ChallengeThreadDeps = AdmitDeps & ThreadReadDeps & ThreadPostDeps

/** The local user's presentation the way `buildActorPerson` serves it. */
export const localAuthorPresentation = async (
  webHost: string,
  user: string,
): Promise<Omit<ThreadAuthor, 'actor_uri'>> => {
  const [settings, avatarVersion] = await Promise.all([
    getUserSettings(user).catch(() => null),
    getProfileAvatarVersion(user).catch(() => undefined),
  ])
  const avatar = new URL(`${buildProfileUrl(webHost, user)}/avatar.png`)
  if (avatarVersion) avatar.searchParams.set('v', String(avatarVersion.getTime()))
  return {
    avatar_url: avatar.href,
    display_name: settings?.display_name || null,
    handle: `@${user}@${new URL(webHost).host}`,
  }
}

export interface ChallengeThreadDepsOptions {
  webHost: string
  deliver?: Pick<FeedDeliver, 'createdReply'>
  notify?: (user: string, input: RaiseNotificationInput) => Promise<void>
  push?: ThreadPush
  signal?: ThreadSignal
}

export const createChallengeThreadDeps = (opts: ChallengeThreadDepsOptions): ChallengeThreadDeps => ({
  countEntries: countChallengeThreadEntries,
  countVisible: countVisibleChallengeThreadEntries,
  createReplyPost,
  deleteEntry: deleteChallengeThreadEntry,
  deletePost: deleteFeedPostWithQuotes,
  deliver: opts.deliver,
  getEntryById: getChallengeThreadEntryById,
  getEntryByObjectUri: getChallengeThreadEntryByObjectUri,
  getOwnPost: getFeedPostById,
  listMembers: listChallengeMembers,
  listReplies: listChallengeThreadReplies,
  listTopLevel: listChallengeThreadTopLevel,
  loadChallenge: loadHostedChallenge,
  notify: opts.notify ?? notifier.raiseBestEffort,
  presentation: (user) => localAuthorPresentation(opts.webHost, user),
  push: opts.push,
  resolveTags: (user, message) => resolvePostTags(user, { reply: true, texts: [message] }),
  setHidden: setEntryHiddenInDb,
  signal: opts.signal,
  upsert: upsertChallengeThreadEntry,
  webHost: opts.webHost,
})

/** The actors of the active members on other servers that proved themselves with a signed request. */
export const verifiedRemoteActors = (members: readonly ChallengeMemberRecord[]): string[] => {
  const actors = new Set<string>()
  for (const member of members) {
    if (member.kind !== 'remote' || member.status !== 'active' || member.actor_verified_at == null) continue
    const actor = member.actor ?? identityToActorUri(member.identity_base_url)
    if (actor != null) actors.add(actor)
  }
  return [...actors]
}

const pushToVerifiedMembers = async (
  deps: Pick<ChallengeThreadDeps, 'listMembers' | 'push'>,
  hosted: HostedChallenge,
  user: string,
  post: FeedPostRecord,
  change: ThreadPushChange,
): Promise<void> => {
  if (deps.push == null) return
  const recipients = verifiedRemoteActors(await deps.listMembers(hosted.host, hosted.challenge.id))
  if (recipients.length > 0) deps.push(user, post, change, recipients)
}

/** Send `signal` to the verified members on other servers; a failure is logged, never the caller's. */
export const signalVerifiedMembers = (
  deps: Pick<AdmitDeps, 'signal' | 'webHost'>,
  hosted: { host: string; challenge: Pick<ChallengeRecord, 'slug'> },
  members: readonly ChallengeMemberRecord[],
  kind: ThreadSignalKind,
  entryObjectUri: string,
): void => {
  if (deps.signal == null) return
  const recipients = verifiedRemoteActors(members)
  if (recipients.length === 0) return
  try {
    deps.signal(
      hosted.host,
      kind,
      entryObjectUri,
      buildChallengeObjectUrl(deps.webHost, hosted.host, hosted.challenge.slug),
      recipients,
    )
  } catch (error) {
    console.warn(`⚠️ challenge thread ${kind} signal failed for ${entryObjectUri}:`, error)
  }
}

const signalAfterLoadingMembers = async (
  deps: Pick<AdmitDeps, 'listMembers' | 'signal' | 'webHost'>,
  hosted: HostedChallenge,
  kind: ThreadSignalKind,
  entryObjectUri: string,
): Promise<void> => {
  if (deps.signal == null) return
  const members = await deps.listMembers(hosted.host, hosted.challenge.id).catch((error: unknown) => {
    console.warn(`⚠️ challenge thread ${kind} signal failed for ${entryObjectUri}:`, error)
    return []
  })
  signalVerifiedMembers(deps, hosted, members, kind, entryObjectUri)
}

const entryVisibleTo = async (
  deps: Pick<ThreadPostDeps, 'getEntryById'>,
  host: string,
  entry: ChallengeThreadEntryRecord,
  role: ChallengeThreadRole,
  audiences: readonly ChallengeThreadAudience[],
): Promise<boolean> => {
  if (!audiences.includes(entry.audience)) return false
  if (role === 'host') return true
  if (entry.hidden_at != null) return false
  if (entry.root_entry_id == null) return true
  const root = await deps.getEntryById(host, entry.root_entry_id)
  return root != null && root.hidden_at == null
}

const loadThreadEntry = async (
  deps: ChallengeThreadDeps,
  hosted: HostedChallenge,
  entryId: string,
): Promise<ChallengeThreadEntryRecord | null> => {
  const entry = await deps.getEntryById(hosted.host, entryId)
  return entry != null && entry.challenge_id === hosted.challenge.id ? entry : null
}

const asEntry = (reply: ChallengeThreadReply): ChallengeThreadEntry => ({ ...reply, replies: [] })

/** What a comment's post answers: the entry it replies to, else the challenge and its host. */
const replyTarget = (
  webHost: string,
  host: string,
  challengeObjectUri: string,
  parent: ChallengeThreadEntryRecord | null,
): Pick<ReplyPostInput, 'in_reply_to_actor_uri' | 'in_reply_to_handle' | 'in_reply_to_uri'> =>
  parent == null
    ? {
        in_reply_to_actor_uri: buildActorUrl(webHost, host),
        in_reply_to_handle: `@${host}@${new URL(webHost).host}`,
        in_reply_to_uri: challengeObjectUri,
      }
    : {
        in_reply_to_actor_uri: parent.actor_uri,
        in_reply_to_handle: parent.handle,
        in_reply_to_uri: parent.object_uri,
      }

/** What a comment would answer, once the commenter may post with its audience there. */
const commentTarget = async (
  deps: ChallengeThreadDeps,
  hosted: HostedChallenge,
  user: string,
  body: Pick<ChallengeCommentBody, 'audience' | 'in_reply_to_id'>,
): Promise<{ ok: true; parent: ChallengeThreadEntryRecord | null } | ThreadFailure> => {
  const { challenge, host } = hosted
  const role = challengeThreadRole(host, await deps.listMembers(host, challenge.id), user)
  if (!allowedAudiences(role, challenge).includes(body.audience)) {
    return failure(
      403,
      body.audience === 'public'
        ? 'This challenge takes participants-only comments'
        : 'Only the host and members can comment for participants',
    )
  }
  if (body.in_reply_to_id == null) {
    return (await deps.countEntries(host, challenge.id)) >= MAX_THREAD_ENTRIES
      ? ADMISSION_FAILURES.thread_full
      : { ok: true, parent: null }
  }
  const parent = await loadThreadEntry(deps, hosted, body.in_reply_to_id)
  if (
    parent == null ||
    !(await entryVisibleTo(deps, host, parent, role, readableAudiences(role, challenge)))
  ) {
    return failure(404, 'Thread entry not found')
  }
  if (parent.audience === 'participants' && body.audience === 'public') {
    return ADMISSION_FAILURES.wider_than_parent
  }
  return { ok: true, parent }
}

/**
 * Comment in a hosted challenge's thread, or reply to one of its entries: a `reply` feed post of
 * the commenter (visibility `unlisted` for `public`, `participants` otherwise) admitted into the
 * thread at once. A refused admission takes the post back. A public comment federates like any
 * unlisted reply.
 */
export const addChallengeComment = async (
  deps: ChallengeThreadDeps,
  user: string,
  body: ChallengeCommentBody,
): Promise<{ ok: true; entry: ChallengeThreadEntry } | ThreadFailure> => {
  if (deps.remote != null && isOtherServerChallengeUrl(deps.webHost, body.challenge_url)) {
    return deps.remote.comment(user, body)
  }
  const resolved = await resolveHostedChallenge(deps.webHost, body.challenge_url, deps.loadChallenge)
  if (!resolved.ok) return resolved
  const { challenge, host } = resolved
  const message = body.message.trim()
  if (message === '') return failure(400, 'A comment needs some text.')
  const target = await commentTarget(deps, resolved, user, body)
  if (!target.ok) return target
  const { parent } = target
  const challengeObjectUri = buildChallengeObjectUrl(deps.webHost, host, challenge.slug)
  const post = await deps.createReplyPost(user, {
    challenge_uri: challengeObjectUri,
    ...replyTarget(deps.webHost, host, challengeObjectUri, parent),
    message,
    tags: await deps.resolveTags(user, message),
    visibility: body.audience === 'public' ? 'unlisted' : 'participants',
  })
  const admitted = await admitThreadEntry(deps, host, challenge, {
    audience: body.audience,
    author: { actor_uri: buildActorUrl(deps.webHost, user), ...(await deps.presentation(user)) },
    content: renderNoteProse(message),
    edited_at: null,
    images: [],
    in_reply_to_uri: post.in_reply_to_uri,
    kind: 'comment',
    object_uri: `${ownObjectPrefix(deps.webHost, user)}${post.id}`,
    published_at: post.created_at,
    url: body.audience === 'public' ? buildPostUrl(deps.webHost, user, post.id) : null,
  })
  if (!admitted.admitted) {
    await deps.deletePost(user, post.id)
    return ADMISSION_FAILURES[admitted.reason]
  }
  if (body.audience === 'public') deps.deliver?.createdReply(user, post)
  await pushToVerifiedMembers(deps, resolved, user, post, 'create').catch((error: unknown) => {
    console.warn(`⚠️ challenge comment push failed for post ${post.id}:`, error)
  })
  return {
    entry: asEntry(
      serializeThreadReply(admitted.entry, parent?.id ?? null, { message: post.message, post_id: post.id }),
    ),
    ok: true,
  }
}

/** Hide or unhide an entry: the host of the challenge or an admin only. */
export const setChallengeThreadEntryHidden = async (
  deps: ChallengeThreadDeps,
  user: string,
  isAdmin: boolean,
  challengeUrl: string,
  entryId: string,
  hidden: boolean,
): Promise<{ ok: true; entry: ChallengeThreadEntry } | ThreadFailure> => {
  if (isOtherServerChallengeUrl(deps.webHost, challengeUrl)) {
    return failure(403, "Only on the host's own server")
  }
  const resolved = await resolveHostedChallenge(deps.webHost, challengeUrl, deps.loadChallenge)
  if (!resolved.ok) return resolved
  if (resolved.host !== user && !isAdmin) {
    return failure(403, 'Only the host of the challenge can hide comments')
  }
  const entry = await deps.setHidden(resolved.host, resolved.challenge.id, entryId, hidden)
  if (entry == null) return failure(404, 'Thread entry not found')
  await signalAfterLoadingMembers(deps, resolved, hidden ? 'remove' : 'add', entry.object_uri)
  const parentId =
    entry.root_entry_id == null || entry.in_reply_to_uri == null
      ? null
      : ((await deps.getEntryByObjectUri(resolved.host, entry.in_reply_to_uri))?.id ?? entry.root_entry_id)
  const ownId = ownPostIdOf(deps.webHost, user, entry)
  return {
    entry: asEntry(
      serializeThreadReply(entry, parentId, ownId == null ? null : { message: null, post_id: ownId }),
    ),
    ok: true,
  }
}

const isShareEligible = (post: FeedPostRecord): boolean =>
  post.message != null &&
  post.message.trim() !== '' &&
  (post.visibility === 'public' || post.visibility === 'unlisted')

const threadKindOf = (post: FeedPostRecord): ChallengeThreadEntryKind | null => {
  if (post.kind === 'reply') return 'comment'
  if (post.kind === 'challenge') return post.challenge?.result == null ? 'share' : 'result'
  return null
}

const postCandidate = async (
  deps: Pick<ChallengeThreadDeps, 'presentation' | 'webHost'>,
  user: string,
  post: FeedPostRecord,
  kind: ChallengeThreadEntryKind,
  audience: ChallengeThreadAudience,
): Promise<ThreadCandidate> => {
  const publiclyListed = post.visibility === 'public' || post.visibility === 'unlisted'
  const content =
    kind === 'result' && post.challenge != null
      ? renderChallengeShareHtml(post.challenge, post.message)
      : renderNoteProse(post.message ?? '')
  return {
    audience,
    author: { actor_uri: buildActorUrl(deps.webHost, user), ...(await deps.presentation(user)) },
    content,
    edited_at: post.updated_at.getTime() > post.created_at.getTime() ? post.updated_at : null,
    images: [],
    in_reply_to_uri: kind === 'comment' ? post.in_reply_to_uri : null,
    kind,
    object_uri: `${ownObjectPrefix(deps.webHost, user)}${post.id}`,
    published_at: post.created_at,
    url: publiclyListed ? buildPostUrl(deps.webHost, user, post.id) : null,
  }
}

const hostedChallengeOf = async (
  deps: Pick<ChallengeThreadDeps, 'loadChallenge' | 'webHost'>,
  post: Pick<FeedPostRecord, 'challenge_uri'>,
): Promise<HostedChallenge | null> => {
  if (post.challenge_uri == null) return null
  const parsed = parseChallengeObjectUrl(deps.webHost, post.challenge_uri)
  if (parsed == null) return null
  const challenge = await deps.loadChallenge(parsed.username, parsed.slug)
  return challenge == null ? null : { challenge, host: parsed.username }
}

/**
 * Bring a post's thread entry in step with the post, after it was created or edited: a comment is
 * re-rendered (its audience kept), a share enters only with a note while public or unlisted and
 * leaves otherwise, the result enters as is. A post in no hosted thread is left alone. A share or
 * the result taken in is signalled (`add`) to the members on other servers, which no push tells.
 */
export const syncThreadEntryForPost = async (
  deps: ChallengeThreadDeps,
  user: string,
  post: FeedPostRecord,
): Promise<AdmitResult | null> => {
  const kind = threadKindOf(post)
  if (kind == null) return null
  const hosted = await hostedChallengeOf(deps, post)
  if (hosted == null) return null
  const objectUri = `${ownObjectPrefix(deps.webHost, user)}${post.id}`
  if (kind === 'share' && !isShareEligible(post)) {
    await deps.deleteEntry(hosted.host, objectUri, buildActorUrl(deps.webHost, user))
    return null
  }
  let audience: ChallengeThreadAudience = post.visibility === 'participants' ? 'participants' : 'public'
  if (kind === 'comment') {
    const existing = await deps.getEntryByObjectUri(hosted.host, objectUri)
    if (existing == null) return null
    audience = existing.audience
  }
  const result = await admitThreadEntry(
    deps,
    hosted.host,
    hosted.challenge,
    await postCandidate(deps, user, post, kind, audience),
  )
  if (result.admitted && kind !== 'comment') {
    await signalAfterLoadingMembers(deps, hosted, 'add', result.entry.object_uri)
  }
  return result
}

/** Take a deleted post's entry (and, for a top-level one, its replies) out of its thread. */
export const removeThreadEntryForPost = async (
  deps: Pick<ChallengeThreadDeps, 'deleteEntry' | 'loadChallenge' | 'webHost'>,
  user: string,
  post: Pick<FeedPostRecord, 'challenge_uri' | 'id'>,
): Promise<void> => {
  const hosted = await hostedChallengeOf(deps, post)
  if (hosted == null) return
  await deps.deleteEntry(
    hosted.host,
    `${ownObjectPrefix(deps.webHost, user)}${post.id}`,
    buildActorUrl(deps.webHost, user),
  )
}

/** Run a thread sync after a post changed; a failure is logged, never the edit's failure. */
export const followPostInThread = async (work: () => Promise<unknown>, postId: string): Promise<void> => {
  try {
    await work()
  } catch (error) {
    console.warn(`⚠️ challenge thread sync failed for post ${postId}:`, error)
  }
}

/**
 * `syncThreadEntryForPost` after an edit, for a post in a hosted thread, pushing an edited comment
 * to the verified members on other servers; a post in a thread hosted elsewhere goes to the remote
 * branch. Never fails the edit.
 */
export const followPostEditInThread = async (
  deps: ChallengeThreadDeps | undefined,
  user: string,
  post: FeedPostRecord,
): Promise<void> => {
  if (deps == null || post.challenge_uri == null) return
  await followPostInThread(async () => {
    const hosted = await hostedChallengeOf(deps, post)
    if (hosted == null) return deps.remote?.followEdit(user, post)
    const result = await syncThreadEntryForPost(deps, user, post)
    if (result?.admitted === true && post.kind === 'reply') {
      await pushToVerifiedMembers(deps, hosted, user, post, 'update')
    }
  }, post.id)
}

/** `removeThreadEntryForPost` after a delete, the same way round as an edit; never fails the delete. */
export const followPostDeleteInThread = async (
  deps: ChallengeThreadDeps | undefined,
  user: string,
  post: FeedPostRecord,
): Promise<void> => {
  if (deps == null || post.challenge_uri == null) return
  await followPostInThread(async () => {
    const hosted = await hostedChallengeOf(deps, post)
    if (hosted == null) return deps.remote?.followDelete(user, post)
    await removeThreadEntryForPost(deps, user, post)
    if (post.kind === 'reply') await pushToVerifiedMembers(deps, hosted, user, post, 'delete')
  }, post.id)
}

/** A comment's visibility is fixed; only its message can change. */
export const threadVisibilityLocked = (
  post: Pick<FeedPostRecord, 'challenge_uri' | 'kind' | 'visibility'> | null,
  requested: string | undefined,
): boolean =>
  post != null &&
  post.kind === 'reply' &&
  post.challenge_uri != null &&
  requested !== undefined &&
  requested !== post.visibility

export const THREAD_VISIBILITY_LOCKED_MESSAGE =
  'The audience of a challenge comment cannot be changed; delete it and comment again'

/** The challenge object id a share of this challenge enters, when it is hosted here. */
export const hostedChallengeObjectUri = async (
  webHost: string,
  challengeUrl: string,
  loadChallenge: LoadChallenge = loadHostedChallenge,
): Promise<string | null> => {
  const parsed = parseChallengePageUrl(webHost, challengeUrl)
  if (parsed == null) return null
  const challenge = await loadChallenge(parsed.username, parsed.slug).catch(() => null)
  return challenge == null ? null : buildChallengeObjectUrl(webHost, parsed.username, challenge.slug)
}
