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
  officialFeedMaxEntries,
  publicTagPagesMax,
  type PublicTagFollow,
  type PublicTagPostsResponse,
  type PublicTagPost,
} from '@aurboda/api-spec'
import { type Actor, Follow, isActor, Undo } from '@fedify/fedify/vocab'
import { randomUUID } from 'node:crypto'

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
import {
  extractNoteImages,
  noteHashtags,
  noteLinkUrl,
  sanitizeRemoteHtml,
} from './activitypub/timeline-ingest.ts'
import { tagActorHandle } from './following.ts'
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor.ts'
import { readOfficialFeedSetting } from './official-feed.ts'
import { withTimeout } from './with-timeout.ts'

export const PUBLIC_TAG_PAGE_SIZE = 20

const LOOKUP_TIMEOUT_MS = 10_000

export type PublicTagStore = Pick<
  PublicTagsApi,
  | 'deleteInstanceTagFollow'
  | 'deleteLocalPublicTagPost'
  | 'deletePublicTagPost'
  | 'deletePublicTagPostsByActor'
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

const normalizeTags = (input: readonly string[], max: number): string[] =>
  [...new Set(input.map(normalizeTag).filter((tag): tag is string => tag != null))].slice(0, max)

/** Stored-form tags, deduplicated in first-seen order, capped. */
export const normalizePublicTagPages = (input: readonly string[]): string[] =>
  normalizeTags(input, publicTagPagesMax)

/** Every tag the instance actor may follow: the public tag pages' and the official feed's. */
export const instanceFollowedTagsMax = publicTagPagesMax + officialFeedMaxEntries

export const readPublicTagPages = async (centralDb: SettingsStore): Promise<string[]> =>
  normalizePublicTagPages((await centralDb.getServerSetting('public_tag_pages')) ?? [])

/**
 * The tags the instance actor follows: every public tag page's, and the official
 * feed's when it lists authors on other servers, whose posts only reach this
 * server through those follows. An official-feed tag gets no public page.
 */
export const readInstanceFollowedTags = async (centralDb: SettingsStore): Promise<string[]> => {
  const [pages, feed] = await Promise.all([readPublicTagPages(centralDb), readOfficialFeedSetting(centralDb)])
  return normalizeTags(
    [...pages, ...(feed.remote_authors.length > 0 ? feed.tags : [])],
    instanceFollowedTagsMax,
  )
}

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
  /** Follow the tag actor of every tag newly listed, unfollow those no longer listed (`readInstanceFollowedTags`). */
  apply: (tags: string[]) => Promise<ApplyPublicTagPagesResult>
  /** A page of `tag`'s public page; not ok when the tag has no page. */
  page: (rawTag: string, cursor?: string) => Promise<PublicTagPageResult>
  /** The newest `limit` posts of `tag`'s page; null when the tag has no page. */
  latest: (rawTag: string, limit: number) => Promise<{ tag: string; posts: PublicTagPostRecord[] } | null>
}

const resolveTagActor = async (
  ctx: Context<void>,
  tag: string,
  host: string,
): Promise<{ actor_uri: string; inbox_uri: string } | null> => {
  const actor = await withTimeout(
    signedFetchOptions(ctx, INSTANCE_ACTOR_ID).then((options) =>
      ctx.lookupObject(tagActorHandle(tag, host), options),
    ),
    LOOKUP_TIMEOUT_MS,
  ).catch(() => null)
  if (!isActor(actor) || actor.id == null || actor.inboxId == null) return null
  return { actor_uri: actor.id.href, inbox_uri: actor.inboxId.href }
}

const recipientOf = (target: { actor_uri: string; inbox_uri: string }) => ({
  id: new URL(target.actor_uri),
  inboxId: new URL(target.inbox_uri),
})

/** Store the follow under a fresh id (pending again) and send it, best-effort. */
const sendTagFollow = async (
  deps: PublicTagActionsDeps,
  ctx: Context<void>,
  tag: string,
  target: { actor_uri: string; inbox_uri: string },
): Promise<void> => {
  const id = instanceTagFollowId(deps.origin, tag, randomUUID())
  await deps.store.upsertInstanceTagFollow({ ...target, follow_activity_id: id.href, tag })
  try {
    await ctx.sendActivity(
      { identifier: INSTANCE_ACTOR_ID },
      recipientOf(target),
      new Follow({ actor: ctx.getActorUri(INSTANCE_ACTOR_ID), id, object: new URL(target.actor_uri) }),
    )
  } catch (error) {
    console.error(`⚠️ Tag actor Follow delivery failed → ${target.inbox_uri}:`, error)
  }
}

/** Send `Undo` of the stored Follow (best-effort) and drop the row. */
const unfollowTagActor = async (ctx: Context<void>, store: PublicTagStore, row: InstanceTagFollowRecord) => {
  const actorUri = ctx.getActorUri(INSTANCE_ACTOR_ID)
  const follow = new Follow({
    actor: actorUri,
    id: new URL(row.follow_activity_id),
    object: new URL(row.actor_uri),
  })
  try {
    await ctx.sendActivity(
      { identifier: INSTANCE_ACTOR_ID },
      recipientOf(row),
      new Undo({ actor: actorUri, id: new URL(`${row.follow_activity_id}#undo`), object: follow }),
    )
  } catch (error) {
    console.error(`⚠️ Tag actor Undo{Follow} delivery failed → ${row.inbox_uri}:`, error)
  }
  await store.deleteInstanceTagFollow(row.tag)
}

const isOnHost = (actorUri: string, host: string): boolean => {
  try {
    return new URL(actorUri).host === host
  } catch {
    return false
  }
}

/**
 * Bring the instance actor's tag follows in line with `tags`, the public tag
 * pages' and the official feed's (`readInstanceFollowedTags`):
 * - a removed tag, or one followed on a tag actor host no longer configured, is unfollowed;
 * - a new (or re-hosted) tag's actor is resolved and followed; one that cannot be resolved
 *   gets no row and is reported, so the next save tries again;
 * - a follow still pending is sent again under a fresh id;
 * - an accepted follow is left alone.
 */
export const applyPublicTagPages = async (
  deps: PublicTagActionsDeps,
  tags: string[],
): Promise<ApplyPublicTagPagesResult> => {
  const wanted = normalizeTags(tags, instanceFollowedTagsMax)
  const host = await deps.tagActorHost()
  const existing = await deps.store.listInstanceTagFollows()
  const ctx = deps.federation.createContext(new URL(deps.origin))
  const current = existing.filter((row) => wanted.includes(row.tag) && isOnHost(row.actor_uri, host))
  const dropped = existing.filter((row) => !current.includes(row))
  await Promise.all(dropped.map((row) => unfollowTagActor(ctx, deps.store, row)))

  const currentTags = new Set(current.map((row) => row.tag))
  const pending = current.filter((row) => !row.accepted)
  const fresh = wanted.filter((tag) => !currentTags.has(tag))
  const resolved = await Promise.all(
    fresh.map(async (tag) => ({ tag, target: await resolveTagActor(ctx, tag, host) })),
  )
  await Promise.all([
    ...pending.map((row) => sendTagFollow(deps, ctx, row.tag, row)),
    ...resolved.flatMap(({ tag, target }) => (target == null ? [] : [sendTagFollow(deps, ctx, tag, target)])),
  ])
  return {
    followed: [
      ...pending.map((row) => row.tag),
      ...resolved.filter(({ target }) => target != null).map(({ tag }) => tag),
    ],
    unresolved: resolved.filter(({ target }) => target == null).map(({ tag }) => tag),
  }
}

/** Each configured tag's follow: accepted, pending, or unresolved (no follow row). */
export const publicTagFollowStates = (
  tags: readonly string[],
  rows: readonly Pick<InstanceTagFollowRecord, 'accepted' | 'tag'>[],
): PublicTagFollow[] =>
  tags.map((tag) => {
    const row = rows.find((r) => r.tag === tag)
    return { state: row == null ? 'unresolved' : row.accepted ? 'accepted' : 'pending', tag }
  })

export const readPublicTagFollows = async (
  store: SettingsStore & Pick<PublicTagStore, 'listInstanceTagFollows'>,
): Promise<PublicTagFollow[]> => {
  const [tags, rows] = await Promise.all([readPublicTagPages(store), store.listInstanceTagFollows()])
  return publicTagFollowStates(tags, rows)
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
    if (tag == null) return null
    const retentionDays = await readPublicTagRetentionDays(deps.store)
    return { posts: await deps.store.listPublicTagPosts(tag, limit, { retentionDays }), tag }
  },

  page: async (rawTag, cursor) => {
    const tag = await configuredTag(deps, rawTag)
    if (tag == null) return { ok: false }
    const retentionDays = await readPublicTagRetentionDays(deps.store)
    const rows = await deps.store.listPublicTagPosts(tag, PUBLIC_TAG_PAGE_SIZE + 1, {
      before: decodeKeysetCursor(cursor),
      retentionDays,
    })
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
    | 'deletePublicTagPost'
    | 'deletePublicTagPostsByActor'
    | 'getInstanceTagFollowByActor'
    | 'removePublicTagAnnounce'
    | 'upsertPublicTagPost'
  >,
): PublicTagIngest => ({
  deletePublicTagPost: (noteUri, actorUri) => store.deletePublicTagPost(noteUri, actorUri),
  deletePublicTagPostsByActor: (actorUri) => store.deletePublicTagPostsByActor(actorUri),
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
    if (!tags.some((tag) => pages.includes(tag))) {
      await deps.store.deleteLocalPublicTagPost(note.id.href, user)
      return
    }
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
      url: noteLinkUrl(note, note.id),
    })
  },
  remove: async (user, objectUri) => {
    await deps.store.deleteLocalPublicTagPost(objectUri, user)
  },
})

const STARTUP_APPLY_TIMEOUT_MS = 60_000

/**
 * Applies the instance actor's tag follows once at startup, so a fresh
 * installation's default official feed starts receiving posts without an admin
 * saving anything. Never throws: a server the tag actor host cannot reach (a
 * localhost dev server) logs one line and boots on.
 */
export const applyInstanceTagFollowsAtStartup = async (deps: {
  readTags: () => Promise<string[]>
  apply: (tags: string[]) => Promise<ApplyPublicTagPagesResult>
  timeoutMs?: number
  log?: (message: string) => void
}): Promise<void> => {
  const log = deps.log ?? ((message: string) => console.warn(message))
  try {
    const tags = await deps.readTags()
    const { unresolved } = await withTimeout(deps.apply(tags), deps.timeoutMs ?? STARTUP_APPLY_TIMEOUT_MS)
    if (unresolved.length > 0) {
      log(
        `⚠️ Tag follows: could not resolve the tag actor of ${unresolved.map((tag) => `#${tag}`).join(', ')}`,
      )
    }
  } catch (error) {
    log(`⚠️ Tag follows not applied at startup: ${error instanceof Error ? error.message : String(error)}`)
  }
}
