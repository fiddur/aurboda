/**
 * Moderation of the public tag pages and the official feed: an admin hides one
 * post (its Note id is remembered so it is not stored again) or blocks an actor
 * or a whole domain. Both are checked when a post is stored, remote or local.
 * Shared by the admin REST routes and the admin MCP tools.
 */
import type { AddPublicTagBlockBody, PublicTagBlock, PublicTagHiddenPost } from '@aurboda/api-spec'

import { actorHost, hostMatches } from '@aurboda/api-spec'

import type { PublicTagBlockRecord, PublicTagHiddenRecord, PublicTagsApi } from './central-public-tags.ts'

import { UUID_RE } from '../utils.ts'

export const HIDDEN_LIST_LIMIT = 200

export type PublicTagModerationStore = Pick<
  PublicTagsApi,
  | 'deletePublicTagBlock'
  | 'deletePublicTagPostsByActors'
  | 'hidePublicTagPost'
  | 'insertPublicTagBlock'
  | 'listHiddenPublicTagPosts'
  | 'listPublicTagBlocks'
  | 'listPublicTagPostActors'
  | 'unhidePublicTagPost'
>

export type PublicTagRefusalStore = Pick<PublicTagsApi, 'isPublicTagPostHidden' | 'listPublicTagBlocks'>

type BlockRule = Pick<PublicTagBlockRecord, 'kind' | 'value'>

const HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?)*$/

/** Whether a post by `actorUri` is kept off the tag pages by one of `blocks`. */
export const isBlocked = (actorUri: string, blocks: readonly BlockRule[]): boolean => {
  const host = actorHost(actorUri)
  return blocks.some((block) =>
    block.kind === 'actor' ? block.value === actorUri : host != null && hostMatches(host, block.value),
  )
}

/**
 * A domain as an admin may type it (`https://Social.Example.org/@bob`, `@bob@example.org`,
 * `*.example.org:443`) reduced to its lowercased host; null when nothing host-like is left.
 */
export const normalizeBlockDomain = (input: string): string | null => {
  let value = input.trim().toLowerCase()
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.split(/[/?#]/)[0]
  value = value.slice(value.lastIndexOf('@') + 1)
  value = value.replace(/^\*\./, '').replace(/:\d*$/, '').replace(/\.$/, '')
  return HOSTNAME_RE.test(value) ? value : null
}

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export const serializePublicTagBlock = (record: PublicTagBlockRecord): PublicTagBlock => ({
  created_at: record.created_at.toISOString(),
  created_by: record.created_by,
  id: record.id,
  kind: record.kind,
  value: record.value,
})

export const serializePublicTagHidden = (record: PublicTagHiddenRecord): PublicTagHiddenPost => ({
  actor_uri: record.actor_uri,
  hidden_at: record.hidden_at.toISOString(),
  hidden_by: record.hidden_by,
  id: record.id,
  note_uri: record.note_uri,
})

/** Whether a post may not be stored on the tag pages: hidden by its Note id, or its actor blocked. */
export const isPublicTagPostRefused = async (
  store: PublicTagRefusalStore,
  noteUri: string,
  actorUri: string,
): Promise<boolean> => {
  if (await store.isPublicTagPostHidden(noteUri)) return true
  return isBlocked(actorUri, await store.listPublicTagBlocks())
}

export type AddPublicTagBlockResult =
  | { ok: true; block: PublicTagBlock; removed_posts: number }
  | { ok: false; status: 400 | 409; error: string }

export interface PublicTagModeration {
  hide: (postId: string, admin: string) => Promise<PublicTagHiddenPost | null>
  listHidden: () => Promise<PublicTagHiddenPost[]>
  unhide: (id: string) => Promise<boolean>
  listBlocks: () => Promise<PublicTagBlock[]>
  addBlock: (input: AddPublicTagBlockBody, admin: string) => Promise<AddPublicTagBlockResult>
  removeBlock: (id: string) => Promise<boolean>
}

const blockValue = (
  input: AddPublicTagBlockBody,
  ownHost: string,
): { ok: true; value: string } | { ok: false; error: string } => {
  if (input.kind === 'actor') {
    const value = input.value.trim()
    return isHttpUrl(value)
      ? { ok: true, value }
      : { error: 'An actor block needs the http(s) actor URI', ok: false }
  }
  const domain = normalizeBlockDomain(input.value)
  if (domain == null) return { error: `"${input.value}" is not a domain`, ok: false }
  if (hostMatches(ownHost, domain)) {
    return { error: `${domain} would block this server's own posts`, ok: false }
  }
  return { ok: true, value: domain }
}

export const createPublicTagModeration = (deps: {
  store: PublicTagModerationStore
  /** This server's web host, never blockable as a domain. */
  ownHost: string
}): PublicTagModeration => {
  const ownHost = deps.ownHost.toLowerCase()
  return {
    addBlock: async (input, admin) => {
      const parsed = blockValue(input, ownHost)
      if (!parsed.ok) return { error: parsed.error, ok: false, status: 400 }
      const record = await deps.store.insertPublicTagBlock(input.kind, parsed.value, admin)
      if (record == null) return { error: 'Already blocked', ok: false, status: 409 }
      const actors = (await deps.store.listPublicTagPostActors()).filter((uri) => isBlocked(uri, [record]))
      const removed = await deps.store.deletePublicTagPostsByActors(actors)
      return { block: serializePublicTagBlock(record), ok: true, removed_posts: removed }
    },

    hide: async (postId, admin) => {
      if (!UUID_RE.test(postId)) return null
      const record = await deps.store.hidePublicTagPost(postId, admin)
      return record == null ? null : serializePublicTagHidden(record)
    },

    listBlocks: async () => (await deps.store.listPublicTagBlocks()).map(serializePublicTagBlock),

    listHidden: async () =>
      (await deps.store.listHiddenPublicTagPosts(HIDDEN_LIST_LIMIT)).map(serializePublicTagHidden),

    removeBlock: async (id) => UUID_RE.test(id) && deps.store.deletePublicTagBlock(id),

    unhide: async (id) => UUID_RE.test(id) && deps.store.unhidePublicTagPost(id),
  }
}
