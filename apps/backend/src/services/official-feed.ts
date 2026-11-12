/**
 * The instance's official feed: public posts by admin-chosen local users, and
 * by authors on other servers, that carry one of admin-chosen hashtags, linked
 * from the front page as its blog. Each local user has their own database and
 * remote posts arrive through the instance actor's tag follows into the central
 * `public_tag_posts` table, so a page is a keyset merge of one page per source.
 */
import { normalizeFediverseHandle, normalizeTag, type OfficialFeedSetting } from '@aurboda/api-spec'

import type { CentralDb } from './central-db.ts'

import { isMissingDatabase } from '../db/pg-errors.ts'
import { keysetTsMicros } from './keyset-cursor.ts'

export const OFFICIAL_FEED_PAGE_SIZE = 20

const OFF: OfficialFeedSetting = { remote_authors: [], tags: [], users: [] }

/** What a fresh installation lists until an admin changes it: the Aurboda project blog. */
export const DEFAULT_OFFICIAL_FEED: OfficialFeedSetting = {
  remote_authors: ['fiddur@aurboda.net'],
  tags: ['aurbodablog'],
  users: [],
}

export const isOfficialFeedOn = (setting: OfficialFeedSetting): boolean =>
  setting.users.length > 0 || setting.remote_authors.length > 0

/** The remote authors as `public_tag_posts.handle` stores them, `@user@host`, lowercased to match. */
export const officialRemoteHandles = (setting: Pick<OfficialFeedSetting, 'remote_authors'>): string[] =>
  setting.remote_authors.map((author) => `@${author}`.toLowerCase())

/**
 * The stored setting, or — before it was ever written — the legacy single-user
 * `blog_username` as a feed of that user with no tag filter.
 */
export const readOfficialFeedSetting = async (
  centralDb: Pick<CentralDb, 'getServerSetting'>,
): Promise<OfficialFeedSetting> => {
  const [stored, legacy] = await Promise.all([
    centralDb.getServerSetting('official_feed'),
    centralDb.getServerSetting('blog_username'),
  ])
  if (stored) {
    return {
      remote_authors: [...(stored.remote_authors ?? [])],
      tags: [...(stored.tags ?? [])],
      users: [...(stored.users ?? [])],
    }
  }
  return legacy ? { ...OFF, users: [legacy] } : OFF
}

/**
 * Gives a fresh installation the default feed: only when the setting was never
 * stored, there is no legacy `blog_username`, and no account exists yet, so an
 * existing server keeps its feed off until an admin turns it on.
 */
export const ensureDefaultOfficialFeed = async (deps: {
  centralDb: Pick<CentralDb, 'getServerSetting' | 'setServerSetting'>
  countUsers: () => Promise<number>
}): Promise<boolean> => {
  const [stored, legacy] = await Promise.all([
    deps.centralDb.getServerSetting('official_feed'),
    deps.centralDb.getServerSetting('blog_username'),
  ])
  if (stored || legacy) return false
  if ((await deps.countUsers()) > 0) return false
  await deps.centralDb.setServerSetting('official_feed', DEFAULT_OFFICIAL_FEED)
  return true
}

/** Stores the setting and retires the legacy `blog_username`, which it replaces. */
export const writeOfficialFeedSetting = async (
  centralDb: Pick<CentralDb, 'setServerSetting'>,
  setting: OfficialFeedSetting,
): Promise<void> => {
  await centralDb.setServerSetting('official_feed', setting)
  await centralDb.setServerSetting('blog_username', '')
}

const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Trimmed, deduplicated users, `user@host` remote authors and stored-form tags,
 * each in first-seen order. A remote author on `ownOrigin`'s host is one of this
 * server's users, so it moves to `users`.
 */
export const normalizeOfficialFeedSetting = (
  input: Pick<OfficialFeedSetting, 'tags' | 'users'> & Partial<Pick<OfficialFeedSetting, 'remote_authors'>>,
  ownOrigin?: string,
): OfficialFeedSetting => {
  const ownHost = ownOrigin == null ? null : hostOf(ownOrigin)
  const handles = (input.remote_authors ?? [])
    .map(normalizeFediverseHandle)
    .filter((handle): handle is string => handle != null && handle !== '')
  const isOwn = (handle: string) => ownHost != null && handle.slice(handle.lastIndexOf('@') + 1) === ownHost
  const localFromHandles = handles.filter(isOwn).map((handle) => handle.slice(0, handle.lastIndexOf('@')))
  const remote = handles.filter((handle) => !isOwn(handle))
  return {
    remote_authors: remote.filter(
      (handle, i) => remote.findIndex((other) => other.toLowerCase() === handle.toLowerCase()) === i,
    ),
    tags: [...new Set(input.tags.map(normalizeTag).filter((tag): tag is string => tag != null))],
    users: [
      ...new Set(
        [...input.users, ...localFromHandles].map((user) => user.trim()).filter((user) => user !== ''),
      ),
    ],
  }
}

export interface OfficialFeedRow {
  id: string
  /** The row's keyset timestamp as Postgres text, at the µs precision the page predicate compares. */
  cursor_ts: string
}

export type OfficialFeedEntryRow<Row extends OfficialFeedRow, Remote extends OfficialFeedRow> =
  | { origin: 'local'; username: string; row: Row }
  | { origin: 'remote'; row: Remote }

export interface OfficialFeedPage<Row extends OfficialFeedRow, Remote extends OfficialFeedRow = never> {
  rows: OfficialFeedEntryRow<Row, Remote>[]
  /** The last listed row's keyset position when more rows follow it, else null. */
  next: Row | Remote | null
}

export interface MergeOfficialFeedInput<Row extends OfficialFeedRow, Remote extends OfficialFeedRow = never> {
  users: readonly string[]
  limit: number
  /**
   * One user's rows, newest first by `(created_at, id)`, after the request's
   * cursor and with the feed's filters applied, at most `limit` of them.
   */
  fetchUser: (username: string, limit: number) => Promise<Row[]>
  /**
   * The remote authors' rows, newest first by `(published_at, id)`, after the
   * request's cursor, at most `limit` of them; absent when the feed lists none.
   */
  fetchRemote?: (limit: number) => Promise<Remote[]>
  /** Called for a listed user whose database is gone; that user is left out. */
  onMissingUser?: (username: string) => void
}

const newestFirst = (a: { row: OfficialFeedRow }, b: { row: OfficialFeedRow }): number => {
  const byTime = keysetTsMicros(b.row.cursor_ts) - keysetTsMicros(a.row.cursor_ts)
  if (byTime !== 0) return byTime
  if (a.row.id === b.row.id) return 0
  return a.row.id < b.row.id ? 1 : -1
}

/**
 * One page of the official feed: `limit + 1` rows from every source (enough to
 * know whether anything follows the page), merged newest first on the
 * `(timestamp, id)` key every source's predicate pages on. Ids are UUIDs, so the
 * key is unique across sources and the next page's cursor resumes every source
 * at the right place.
 */
export const mergeOfficialFeedPage = async <
  Row extends OfficialFeedRow,
  Remote extends OfficialFeedRow = never,
>({
  fetchRemote,
  fetchUser,
  limit,
  onMissingUser,
  users,
}: MergeOfficialFeedInput<Row, Remote>): Promise<OfficialFeedPage<Row, Remote>> => {
  const [perUser, remote] = await Promise.all([
    Promise.all(
      users.map(async (username): Promise<OfficialFeedEntryRow<Row, Remote>[]> => {
        try {
          return (await fetchUser(username, limit + 1)).map((row) => ({ origin: 'local', row, username }))
        } catch (error) {
          if (!isMissingDatabase(error)) throw error
          onMissingUser?.(username)
          return []
        }
      }),
    ),
    fetchRemote ? fetchRemote(limit + 1) : Promise.resolve([]),
  ])
  const merged = [
    ...perUser.flat(),
    ...remote.map((row): OfficialFeedEntryRow<Row, Remote> => ({ origin: 'remote', row })),
  ].sort(newestFirst)
  const rows = merged.slice(0, limit)
  return {
    next: merged.length > limit ? (rows[rows.length - 1]?.row ?? null) : null,
    rows,
  }
}

/** The setting without `username`, or null when it does not list them. */
export const withoutOfficialFeedUser = (
  setting: OfficialFeedSetting,
  username: string,
): OfficialFeedSetting | null =>
  setting.users.includes(username)
    ? { ...setting, users: setting.users.filter((user) => user !== username) }
    : null
