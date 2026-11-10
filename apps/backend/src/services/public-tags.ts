/**
 * Public tag pages: `/tags/<tag>` lists the public posts, from every server,
 * that carry `#<tag>`. The instance actor follows each configured tag's actor
 * on the tag actor host (`<tag>@tags.pub`) and keeps what it announces
 * (`activitypub/public-tag-ingest.ts`); this server's own public posts with the
 * tag are recorded on delivery (`activitypub/deliver.ts`). Shared by the admin
 * settings route, the public REST routes and the MCP tool.
 */
import type { Context, Federation } from '@fedify/fedify'

import {
  defaultPublicTagRetentionDays,
  normalizeTag,
  publicTagPagesMax,
  type PublicTagPostsResponse,
  type PublicTagPost,
} from '@aurboda/api-spec'
import { type Actor, Follow, isActor, Undo } from '@fedify/fedify/vocab'

import type { LocalPublicTagPosts } from './activitypub/deliver.ts'
import type { CentralDb } from './central-db.ts'
import type { InstanceTagFollowRecord, PublicTagPostRecord, PublicTagsApi } from './central-public-tags.ts'

import { extractActorPresentation } from './activitypub/actor-presentation.ts'
import {
  INSTANCE_ACTOR_ID,
  instanceTagFollowId,
  type PublicTagIngest,
  type TagFollowInboxHooks,
} from './activitypub/instance-actor.ts'
import { signedFetchOptions } from './activitypub/signed-lookup.ts'
import { temporalInstantToDate } from './activitypub/temporal-interop.ts'
import { extractNoteImages, noteHashtags, sanitizeRemoteHtml } from './activitypub/timeline-ingest.ts'
import { tagActorHandle } from './following.ts'
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor.ts'
import { withTimeout } from './with-timeout.ts'

export const PUBLIC_TAG_PAGE_SIZE = 20

const LOOKUP_TIMEOUT_MS = 10_000

export type PublicTagStore = Pick<
  PublicTagsApi,
  | 'deleteInstanceTagFollow'
  | 'deleteLocalPublicTagPost'
  | 'deletePublicTagPost'
  | 'getInstanceTagFollowByActor'
  | 'getInstanceTagFollowByFollowId'
  | 'listInstanceTagFollows'
  | 'listPublicTagPosts'
  | 'removePublicTagAnnounce'
  | 'setInstanceTagFollowAccepted'
  | 'upsertInstanceTagFollow'
  | 'upsertPublicTagPost'
>

type SettingsStore = Pick<CentralDb, 'getServerSetting'>

/** Stored-form tags, deduplicated in first-seen order, capped. */
export const normalizePublicTagPages = (input: readonly string[]): string[] =>
  [...new Set(input.map(normalizeTag).filter((tag): tag is string => tag != null))].slice(
    0,
    publicTagPagesMax,
  )

export const readPublicTagPages = async (centralDb: SettingsStore): Promise<string[]> =>
  normalizePublicTagPages((await centralDb.getServerSetting('public_tag_pages')) ?? [])

export const readPublicTagRetentionDays = async (centralDb: SettingsStore): Promise<number> =>
  (await centralDb.getServerSetting('public_tag_retention_days')) ?? defaultPublicTagRetentionDays

export const serializePublicTagPost = (record: PublicTagPostRecord): PublicTagPost => ({
  actor_uri: record.actor_uri,
  avatar_url: record.avatar_url,
  content: record.content,
  display_name: record.display_name,
  handle: record.handle,
  id: record.id,
  ...(record.images.length === 0 ? {} : { images: record.images }),
  object_uri: record.note_uri,
  published_at: record.published_at.toISOString(),
  received_at: record.created_at.toISOString(),
  tags: record.tags,
  url: record.url,
})

export interface PublicTagActionsDeps {
  federation: Federation<void>
  origin: string
  store: PublicTagStore & SettingsStore
  tagActorHost: () => Promise<string>
}

export interface ApplyPublicTagPagesResult {
  followed: string[]
  unresolved: string[]
}

export type PublicTagPageResult = { ok: true; page: PublicTagPostsResponse } | { ok: false }

export interface PublicTagActions {
  /** Follow the tag actor of every tag newly listed, unfollow those no longer listed. */
  apply: (tags: string[]) => Promise<ApplyPublicTagPagesResult>
  /** A page of `tag`'s public page; not ok when the tag has no page. */
  page: (rawTag: string, cursor?: string) => Promise<PublicTagPageResult>
  /** The newest `limit` posts of `tag`'s page; null when the tag has no page. */
  latest: (rawTag: string, limit: number) => Promise<{ tag: string; posts: PublicTagPostRecord[] } | null>
}

const tagFollow = (actorUri: URL, origin: string, tag: string, object: URL) =>
  new Follow({ actor: actorUri, id: instanceTagFollowId(origin, tag), object })

const followTagActor = async (
  deps: PublicTagActionsDeps,
  ctx: Context<void>,
  tag: string,
): Promise<boolean> => {
  const handle = tagActorHandle(tag, await deps.tagActorHost())
  const actor = await withTimeout(
    signedFetchOptions(ctx, INSTANCE_ACTOR_ID).then((options) => ctx.lookupObject(handle, options)),
    LOOKUP_TIMEOUT_MS,
  ).catch(() => null)
  if (!isActor(actor) || actor.id == null || actor.inboxId == null) return false
  await deps.store.upsertInstanceTagFollow({
    actor_uri: actor.id.href,
    follow_activity_id: instanceTagFollowId(deps.origin, tag).href,
    inbox_uri: actor.inboxId.href,
    tag,
  })
  try {
    await ctx.sendActivity(
      { identifier: INSTANCE_ACTOR_ID },
      actor,
      tagFollow(ctx.getActorUri(INSTANCE_ACTOR_ID), deps.origin, tag, actor.id),
    )
  } catch (error) {
    console.error(`⚠️ Tag actor Follow delivery failed → ${actor.inboxId.href}:`, error)
  }
  return true
}

const unfollowTagActor = async (
  deps: PublicTagActionsDeps,
  ctx: Context<void>,
  row: InstanceTagFollowRecord,
): Promise<void> => {
  const actorUri = ctx.getActorUri(INSTANCE_ACTOR_ID)
  const follow = tagFollow(actorUri, deps.origin, row.tag, new URL(row.actor_uri))
  try {
    await ctx.sendActivity(
      { identifier: INSTANCE_ACTOR_ID },
      { id: new URL(row.actor_uri), inboxId: new URL(row.inbox_uri) },
      new Undo({
        actor: actorUri,
        id: new URL(`${instanceTagFollowId(deps.origin, row.tag).href}#undo`),
        object: follow,
      }),
    )
  } catch (error) {
    console.error(`⚠️ Tag actor Undo{Follow} delivery failed → ${row.inbox_uri}:`, error)
  }
  await deps.store.deleteInstanceTagFollow(row.tag)
}

/**
 * Diff the configured tags against the instance actor's tag follows. A tag
 * already followed is left alone; a tag whose actor cannot be resolved gets no
 * row and is reported, so the next save that lists it tries again.
 */
export const applyPublicTagPages = async (
  deps: PublicTagActionsDeps,
  tags: string[],
): Promise<ApplyPublicTagPagesResult> => {
  const wanted = normalizePublicTagPages(tags)
  const existing = await deps.store.listInstanceTagFollows()
  const followedTags = new Set(existing.map((row) => row.tag))
  const ctx = deps.federation.createContext(new URL(deps.origin))
  const result: ApplyPublicTagPagesResult = { followed: [], unresolved: [] }
  for (const tag of wanted.filter((t) => !followedTags.has(t))) {
    if (await followTagActor(deps, ctx, tag)) result.followed.push(tag)
    else result.unresolved.push(tag)
  }
  for (const row of existing.filter((r) => !wanted.includes(r.tag))) await unfollowTagActor(deps, ctx, row)
  return result
}

const configuredTag = async (deps: PublicTagActionsDeps, rawTag: string): Promise<string | null> => {
  const tag = normalizeTag(rawTag)
  if (tag == null) return null
  return (await readPublicTagPages(deps.store)).includes(tag) ? tag : null
}

export const createPublicTagActions = (deps: PublicTagActionsDeps): PublicTagActions => ({
  apply: (tags) => applyPublicTagPages(deps, tags),

  latest: async (rawTag, limit) => {
    const tag = await configuredTag(deps, rawTag)
    return tag == null ? null : { posts: await deps.store.listPublicTagPosts(tag, limit), tag }
  },

  page: async (rawTag, cursor) => {
    const tag = await configuredTag(deps, rawTag)
    if (tag == null) return { ok: false }
    const [rows, retentionDays] = await Promise.all([
      deps.store.listPublicTagPosts(tag, PUBLIC_TAG_PAGE_SIZE + 1, decodeKeysetCursor(cursor)),
      readPublicTagRetentionDays(deps.store),
    ])
    const records = rows.slice(0, PUBLIC_TAG_PAGE_SIZE)
    const last = records[records.length - 1]
    return {
      ok: true,
      page: {
        next_cursor:
          rows.length > PUBLIC_TAG_PAGE_SIZE && last ? encodeKeysetCursor(last.cursor_ts, last.id) : null,
        posts: records.map(serializePublicTagPost),
        retention_days: retentionDays,
        success: true,
        tag,
      },
    }
  },
})

/**
 * Answers to the instance actor's tag follows. Only the followed tag actor itself
 * can accept or reject: anyone who learned the Follow id could otherwise flip it.
 */
export const createPublicTagInboxHooks = (
  store: Pick<
    PublicTagStore,
    'deleteInstanceTagFollow' | 'getInstanceTagFollowByFollowId' | 'setInstanceTagFollowAccepted'
  >,
): TagFollowInboxHooks => {
  const answer = async (followActivityId: string, actorUri: string | null, accepted: boolean) => {
    const row = await store.getInstanceTagFollowByFollowId(followActivityId)
    if (row == null) return false
    if (actorUri !== row.actor_uri) return true
    if (accepted) await store.setInstanceTagFollowAccepted(followActivityId, true)
    else await store.deleteInstanceTagFollow(row.tag)
    return true
  }
  return {
    onAccept: (followActivityId, actorUri) => answer(followActivityId, actorUri, true),
    onReject: (followActivityId, actorUri) => answer(followActivityId, actorUri, false),
  }
}

export const createPublicTagIngest = (
  store: Pick<
    PublicTagStore,
    'deletePublicTagPost' | 'getInstanceTagFollowByActor' | 'removePublicTagAnnounce' | 'upsertPublicTagPost'
  >,
): PublicTagIngest => ({
  deletePublicTagPost: (noteUri, actorUri) => store.deletePublicTagPost(noteUri, actorUri),
  followedTagActor: async (actorUri) => {
    const row = await store.getInstanceTagFollowByActor(actorUri)
    return row != null && row.accepted ? { actor_uri: row.actor_uri, tag: row.tag } : null
  },
  removePublicTagAnnounce: (announceUri) => store.removePublicTagAnnounce(announceUri),
  upsertPublicTagPost: (input) => store.upsertPublicTagPost(input),
})

export const createLocalPublicTagPosts = (deps: {
  store: Pick<PublicTagStore, 'deleteLocalPublicTagPost' | 'upsertPublicTagPost'>
  publicTagPages: () => Promise<string[]>
  /** The local actor as the actor dispatcher serves it (no network). */
  localActor: (ctx: Context<void>, user: string) => Promise<Actor | null>
  now?: () => Date
}): LocalPublicTagPosts => ({
  record: async (user, note, ctx) => {
    if (note.id == null) return
    const tags = await noteHashtags(note)
    const pages = await deps.publicTagPages()
    if (!tags.some((tag) => pages.includes(tag))) return
    const actor = await deps.localActor(ctx, user)
    const presentation =
      actor == null
        ? { avatar_url: null, display_name: null, handle: null }
        : await extractActorPresentation(actor)
    const published =
      note.published == null ? (deps.now?.() ?? new Date()) : temporalInstantToDate(note.published)
    await deps.store.upsertPublicTagPost({
      ...presentation,
      actor_uri: ctx.getActorUri(user).href,
      announce_uris: [],
      content: sanitizeRemoteHtml(note.content?.toString() ?? ''),
      images: await extractNoteImages(note),
      local_user: user,
      note_uri: note.id.href,
      published_at: published,
      tags,
      url: note.url instanceof URL ? note.url.href : note.id.href,
    })
  },
  remove: async (user, objectUri) => {
    await deps.store.deleteLocalPublicTagPost(objectUri, user)
  },
})
