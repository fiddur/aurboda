import type { ChallengeThreadAudience } from '@aurboda/api-spec'
/**
 * Federated comments into the thread of a challenge hosted on this instance: a `Note` that reaches
 * a local inbox and answers the challenge object, a post of its thread, or one of its entries is
 * admitted through `admitThreadEntry`, and a `Delete` from its author takes it out again.
 */
import type { Note } from '@fedify/fedify/vocab'

import type {
  ChallengeMemberRecord,
  ChallengeRecord,
  ChallengeThreadEntryRecord,
  FeedPostRecord,
  TimelineEntryRecord,
} from '../db/index.ts'

import {
  countChallengeThreadEntriesByActorSince,
  deleteChallengeThreadEntriesByActor,
  getChallengeById,
  getFeedPostById,
  getTimelineEntryByObjectUri,
  isMissingDatabase,
} from '../db/index.ts'
import { UUID_RE } from '../utils.ts'
import { isValidUsername } from './account-signup.ts'
import { AS_PUBLIC } from './activitypub/object.ts'
import { temporalInstantToDate } from './activitypub/temporal-interop.ts'
import { extractNoteImages, noteLinkUrl, sanitizeRemoteHtml } from './activitypub/timeline-ingest.ts'
import {
  type AdmitDeps,
  admitThreadEntry,
  challengeThreadRole,
  createChallengeThreadDeps,
  isThreadParticipant,
  type LoadChallenge,
  parseChallengeObjectUrl,
  signalVerifiedMembers,
  type ThreadAuthor,
  type ThreadCandidate,
  type ThreadSignal,
  threadNotifies,
  verifiedRemoteActors,
} from './challenge-thread.ts'
import { buildActorUrl, buildChallengeObjectUrl } from './share-urls.ts'

export const INBOUND_NON_MEMBER_DAILY_LIMIT = 30

const DAY_MS = 24 * 60 * 60 * 1000

export interface InboundThreadDeps extends AdmitDeps {
  loadChallenge: LoadChallenge
  getFeedPost: (user: string, postId: string) => Promise<FeedPostRecord | null>
  getChallengeById: (user: string, id: string) => Promise<ChallengeRecord | null>
  countByActorSince: (host: string, challengeId: string, actorUri: string, since: Date) => Promise<number>
  getTimelineEntry: (user: string, objectUri: string) => Promise<TimelineEntryRecord | null>
  deleteEntry: (host: string, objectUri: string, actorUri: string) => Promise<unknown>
  deleteEntriesByActor: (host: string, actorUri: string) => Promise<unknown>
  now: () => number
}

export const createInboundThreadDeps = (origin: string, signal?: ThreadSignal): InboundThreadDeps => ({
  ...createChallengeThreadDeps({ signal, webHost: origin }),
  countByActorSince: countChallengeThreadEntriesByActorSince,
  deleteEntriesByActor: deleteChallengeThreadEntriesByActor,
  getChallengeById,
  getFeedPost: getFeedPostById,
  getTimelineEntry: getTimelineEntryByObjectUri,
  now: Date.now,
})

/** A lookup in a user's database, where a database that does not exist means nothing found. */
const tolerant = async <T>(work: () => Promise<T | null>): Promise<T | null> => {
  try {
    return await work()
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
}

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

/** A local post's object id (`<origin>/users/<user>/feed/<uuid>`) → its author and id. */
export const parseLocalPostUri = (origin: string, uri: string): { user: string; post_id: string } | null => {
  const prefix = `${trimSlashes(origin)}/users/`
  if (!uri.startsWith(prefix)) return null
  const segments = uri.slice(prefix.length).split('/')
  if (segments.length !== 3 || segments[1] !== 'feed') return null
  let user: string
  try {
    user = decodeURIComponent(segments[0])
  } catch {
    return null
  }
  const postId = segments[2]
  return isValidUsername(user) && UUID_RE.test(postId) ? { post_id: postId, user } : null
}

export interface InboundThread {
  host: string
  challenge: ChallengeRecord
  in_reply_to_uri: string
}

type ResolveDeps = Pick<
  InboundThreadDeps,
  'getChallengeById' | 'getEntryByObjectUri' | 'getFeedPost' | 'loadChallenge'
>

const byChallengeObject = async (
  deps: ResolveDeps,
  origin: string,
  target: string,
): Promise<InboundThread | null> => {
  const parsed = parseChallengeObjectUrl(origin, target)
  if (parsed == null) return null
  const challenge = await deps.loadChallenge(parsed.username, parsed.slug)
  return challenge == null ? null : { challenge, host: parsed.username, in_reply_to_uri: target }
}

const byThreadPost = async (
  deps: ResolveDeps,
  origin: string,
  target: string,
): Promise<InboundThread | null> => {
  const local = parseLocalPostUri(origin, target)
  if (local == null) return null
  const post = await tolerant(() => deps.getFeedPost(local.user, local.post_id))
  if (post?.challenge_uri == null) return null
  const hosted = await byChallengeObject(deps, origin, post.challenge_uri)
  if (hosted == null) return null
  const entry = await tolerant(() => deps.getEntryByObjectUri(hosted.host, target))
  return {
    ...hosted,
    in_reply_to_uri:
      entry != null && entry.challenge_id === hosted.challenge.id
        ? target
        : buildChallengeObjectUrl(origin, hosted.host, hosted.challenge.slug),
  }
}

const byHostedEntry = async (
  deps: ResolveDeps,
  me: string,
  target: string,
): Promise<InboundThread | null> => {
  const entry = await tolerant(() => deps.getEntryByObjectUri(me, target))
  if (entry == null) return null
  const challenge = await tolerant(() => deps.getChallengeById(me, entry.challenge_id))
  return challenge == null ? null : { challenge, host: me, in_reply_to_uri: target }
}

/**
 * The thread a Note answering `target` belongs to: the challenge object itself, a local post of a
 * thread, or an entry of a thread `me` hosts (which only reaches `me` when the Note is delivered to
 * the host's inbox). Null when it answers none of them.
 */
export const resolveInboundThread = async (
  deps: ResolveDeps,
  origin: string,
  me: string,
  target: string,
): Promise<InboundThread | null> =>
  (await byChallengeObject(deps, origin, target)) ??
  (await byThreadPost(deps, origin, target)) ??
  (await byHostedEntry(deps, me, target))

export interface InboundThreadNote {
  origin: string
  /** The local user whose inbox the Note reached. */
  me: string
  /** The signature-verified sender. */
  actor_uri: string
  note: Note
  /** The sender's byline, fetched only once the Note passed every other check. */
  presentation: () => Promise<Omit<ThreadAuthor, 'actor_uri'> | null>
}

export interface InboundThreadAdmission {
  host: string
  challenge_id: string
  /** The thread notifies `me` of this entry (or, for a reply under a post they do not follow, deliberately not): the timeline must not notify again. */
  quiet: boolean
  /** Quiet, but the thread does not notify `me` of it: a mention of them is still the timeline's to raise. */
  notify_mention: boolean
}

const hostOf = (uri: string): string | null => {
  try {
    return new URL(uri).host
  } catch {
    return null
  }
}

/** The timeline's authority rule: the Note lives on the sender's host and names the sender as author. */
export const isSendersNote = (noteId: URL, note: Note, actorUri: string): boolean =>
  noteId.host === hostOf(actorUri) && note.attributionIds.some((uri) => uri.href === actorUri)

/** `public` for a Note addressed to Public; else `participants`, only with the challenge as `context`. */
export const inboundAudience = (note: Note, challengeObjectUri: string): ChallengeThreadAudience | null => {
  if ([...note.toIds, ...note.ccIds].some((uri) => uri.href === AS_PUBLIC)) return 'public'
  return note.contextIds.some((uri) => uri.href === challengeObjectUri) ? 'participants' : null
}

export const clampToNow = (date: Date, now: number): Date => new Date(Math.min(date.getTime(), now))

const inboundCandidate = async (
  note: Note,
  noteId: URL,
  published: Temporal.Instant,
  fields: Pick<ThreadCandidate, 'audience' | 'author' | 'in_reply_to_uri'>,
  now: number,
): Promise<ThreadCandidate> => {
  const publishedAt = temporalInstantToDate(published)
  const updatedAt = note.updated == null ? null : temporalInstantToDate(note.updated)
  return {
    ...fields,
    content: sanitizeRemoteHtml(note.content?.toString() ?? ''),
    edited_at:
      updatedAt != null && updatedAt.getTime() > publishedAt.getTime() ? clampToNow(updatedAt, now) : null,
    images: await extractNoteImages(note),
    kind: 'comment',
    object_uri: noteId.href,
    published_at: clampToNow(publishedAt, now),
    url: noteLinkUrl(note, noteId),
  }
}

/**
 * Whether someone who is not a participant is kept out: a participants entry is theirs to write
 * only as a rewrite of their own entry (they have left since).
 */
const closedToOutsider = (
  challenge: Pick<ChallengeRecord, 'is_public'>,
  audience: ChallengeThreadAudience,
  existing: Pick<ChallengeThreadEntryRecord, 'actor_uri' | 'audience'> | null,
  actorUri: string,
): boolean => {
  if (challenge.is_public && audience === 'public') return false
  return !(existing?.actor_uri === actorUri && existing.audience === 'participants')
}

const notifiedByThread = async (
  deps: InboundThreadDeps,
  host: string,
  members: readonly ChallengeMemberRecord[],
  entry: ChallengeThreadEntryRecord,
  me: string,
): Promise<boolean> => {
  try {
    return await threadNotifies(deps, host, members, entry, me)
  } catch (error) {
    console.warn(`⚠️ challenge thread follow check failed for ${entry.object_uri}:`, error)
    return true
  }
}

const admitIntoThread = async (
  deps: InboundThreadDeps,
  input: InboundThreadNote,
  thread: InboundThread,
  noteId: URL,
  published: Temporal.Instant,
): Promise<InboundThreadAdmission | null> => {
  const { actor_uri: actorUri, me, note, origin } = input
  const { challenge, host } = thread
  const [members, existing] = await Promise.all([
    deps.listMembers(host, challenge.id),
    deps.getEntryByObjectUri(host, noteId.href),
  ])
  const quiet = challengeThreadRole(host, members, me) !== 'visitor' && buildActorUrl(origin, me) !== actorUri
  const admission = async (entry: ChallengeThreadEntryRecord): Promise<InboundThreadAdmission> => ({
    challenge_id: challenge.id,
    host,
    notify_mention: quiet && !(await notifiedByThread(deps, host, members, entry, me)),
    quiet,
  })
  if (existing != null && noteId.href.startsWith(`${trimSlashes(origin)}/users/`)) return admission(existing)

  const audience = inboundAudience(note, buildChallengeObjectUrl(origin, host, challenge.slug))
  if (audience == null) return null
  const participant = isThreadParticipant(origin, host, members, actorUri)
  if (!participant && closedToOutsider(challenge, audience, existing, actorUri)) return null
  const now = deps.now()
  if (!participant && existing == null) {
    const recent = await deps.countByActorSince(host, challenge.id, actorUri, new Date(now - DAY_MS))
    if (recent >= INBOUND_NON_MEMBER_DAILY_LIMIT) return null
  }

  const presentation = await input.presentation()
  if (presentation == null) return null
  const candidate = await inboundCandidate(
    note,
    noteId,
    published,
    { audience, author: { ...presentation, actor_uri: actorUri }, in_reply_to_uri: thread.in_reply_to_uri },
    now,
  )
  const admitted = await admitThreadEntry(deps, host, challenge, candidate)
  if (!admitted.admitted) return null
  if (admitted.created && !verifiedRemoteActors(members).includes(actorUri)) {
    signalVerifiedMembers(deps, thread, members, 'add', admitted.entry.object_uri)
  }
  return admission(admitted.entry)
}

/**
 * Admit an inbound Note into a thread hosted here, or say it is none (null: handle it as before).
 * Authority as for the timeline (same host, explicit attribution); a non-public Note only with the
 * challenge as its `context`; participants-only from participants; and at most
 * `INBOUND_NON_MEMBER_DAILY_LIMIT` new entries a day from anyone else. An entry the verified members
 * on other servers did not get pushed by its author is signalled (`add`) to them when it first enters
 * the thread, not again on its `Update`.
 */
export const admitInboundThreadNote = async (
  deps: InboundThreadDeps,
  input: InboundThreadNote,
): Promise<InboundThreadAdmission | null> => {
  const { note } = input
  const target = note.replyTargetIds[0]?.href
  if (note.id == null || note.published == null || target == null) return null
  const noteId = note.id
  const published = note.published
  try {
    const thread = await resolveInboundThread(deps, input.origin, input.me, target)
    if (thread == null || !isSendersNote(noteId, note, input.actor_uri)) return null
    return await admitIntoThread(deps, input, thread, noteId, published)
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
}

/**
 * Take a deleted Note out of the threads it entered, scoped to its author: from a thread `me`
 * hosts, from the host's thread when `me` received it as an answer to another user's thread, and,
 * for an actor deleting itself, every entry it wrote in threads `me` hosts.
 */
export const removeInboundThreadEntry = async (
  deps: Pick<
    InboundThreadDeps,
    | 'deleteEntriesByActor'
    | 'deleteEntry'
    | 'getChallengeById'
    | 'getEntryByObjectUri'
    | 'getFeedPost'
    | 'getTimelineEntry'
    | 'loadChallenge'
  >,
  origin: string,
  me: string,
  objectUri: string,
  actorUri: string,
): Promise<void> => {
  await tolerant(() => deps.deleteEntry(me, objectUri, actorUri))
  const received = await tolerant(() => deps.getTimelineEntry(me, objectUri))
  if (received != null && received.actor_uri === actorUri && received.in_reply_to_uri != null) {
    const target = received.in_reply_to_uri
    const thread =
      (await byChallengeObject(deps, origin, target)) ?? (await byThreadPost(deps, origin, target))
    if (thread != null && thread.host !== me) {
      await tolerant(() => deps.deleteEntry(thread.host, objectUri, actorUri))
    }
  }
  if (objectUri === actorUri) await tolerant(() => deps.deleteEntriesByActor(me, actorUri))
}
