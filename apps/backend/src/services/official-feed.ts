/**
 * The instance's official feed: public posts by admin-chosen local users that
 * carry one of admin-chosen hashtags, linked from the front page as its blog.
 * Each user has their own database, so a page is a keyset merge of one page per
 * user.
 */
import { normalizeTag, type OfficialFeedSetting } from '@aurboda/api-spec'

import type { CentralDb } from './central-db.ts'

import { isMissingDatabase } from '../db/pg-errors.ts'
import { keysetTsMicros } from './keyset-cursor.ts'

export const OFFICIAL_FEED_PAGE_SIZE = 20

const OFF: OfficialFeedSetting = { tags: [], users: [] }

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
  if (stored) return { tags: [...(stored.tags ?? [])], users: [...(stored.users ?? [])] }
  return legacy ? { tags: [], users: [legacy] } : OFF
}

/** Stores the setting and retires the legacy `blog_username`, which it replaces. */
export const writeOfficialFeedSetting = async (
  centralDb: Pick<CentralDb, 'setServerSetting'>,
  setting: OfficialFeedSetting,
): Promise<void> => {
  await centralDb.setServerSetting('official_feed', setting)
  await centralDb.setServerSetting('blog_username', '')
}

/** Trimmed, deduplicated users and stored-form tags, both in first-seen order. */
export const normalizeOfficialFeedSetting = (input: OfficialFeedSetting): OfficialFeedSetting => ({
  tags: [...new Set(input.tags.map(normalizeTag).filter((tag): tag is string => tag != null))],
  users: [...new Set(input.users.map((user) => user.trim()).filter((user) => user !== ''))],
})

export interface OfficialFeedRow {
  id: string
  /** The row's `created_at` as Postgres text, at the µs precision the page predicate compares. */
  cursor_ts: string
}

export interface OfficialFeedPage<Row extends OfficialFeedRow> {
  rows: { username: string; row: Row }[]
  /** The last listed row's keyset position when more rows follow it, else null. */
  next: Row | null
}

export interface MergeOfficialFeedInput<Row extends OfficialFeedRow> {
  users: readonly string[]
  limit: number
  /**
   * One user's rows, newest first by `(created_at, id)`, after the request's
   * cursor and with the feed's filters applied, at most `limit` of them.
   */
  fetchUser: (username: string, limit: number) => Promise<Row[]>
  /** Called for a listed user whose database is gone; that user is left out. */
  onMissingUser?: (username: string) => void
}

const newestFirst = <Row extends OfficialFeedRow>(a: { row: Row }, b: { row: Row }): number => {
  const byTime = keysetTsMicros(b.row.cursor_ts) - keysetTsMicros(a.row.cursor_ts)
  if (byTime !== 0) return byTime
  if (a.row.id === b.row.id) return 0
  return a.row.id < b.row.id ? 1 : -1
}

/**
 * One page of the official feed: `limit + 1` rows from every user (enough to
 * know whether anything follows the page), merged newest first on the same
 * `(created_at, id)` key the per-user predicate pages on. Post ids are UUIDs, so
 * the key is unique across users and the next page's cursor resumes every user
 * at the right place.
 */
export const mergeOfficialFeedPage = async <Row extends OfficialFeedRow>({
  fetchUser,
  limit,
  onMissingUser,
  users,
}: MergeOfficialFeedInput<Row>): Promise<OfficialFeedPage<Row>> => {
  const perUser = await Promise.all(
    users.map(async (username) => {
      try {
        return (await fetchUser(username, limit + 1)).map((row) => ({ row, username }))
      } catch (error) {
        if (!isMissingDatabase(error)) throw error
        onMissingUser?.(username)
        return []
      }
    }),
  )
  const merged = perUser.flat().sort(newestFirst)
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
