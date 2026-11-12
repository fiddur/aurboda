/**
 * The official feed (the instance blog at `/blog`): public posts by chosen
 * users and authors on other servers that carry one of chosen tags. Helpers for
 * its admin inputs and the line that says what it lists.
 */
import type { OfficialFeedResponse, OfficialFeedSetting } from '@aurboda/api-spec'

/** Usernames typed separated by spaces or commas, a leading `@` dropped, deduplicated in order. */
export const parseUsernamesInput = (text: string): string[] => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((word) => word.replace(/^@/, ''))
      .filter(Boolean),
  ),
]

export const formatUsernamesInput = (users: readonly string[]): string => users.join(', ')

/** Fediverse handles typed separated by spaces or commas, each kept as typed, deduplicated in order. */
export const parseHandlesInput = (text: string): string[] => [
  ...new Set(text.split(/[\s,]+/).filter(Boolean)),
]

/** Stored `user@host` handles shown as `@user@host`. */
export const formatHandlesInput = (handles: readonly string[]): string =>
  handles.map((handle) => `@${handle}`).join(', ')

const listWords = (items: readonly string[], conjunction: string): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`

/**
 * `Posts from @fiddur, @alice and @bob@peer.example tagged #aurboda or #qs`, or
 * `Posts from @fiddur` without tags.
 */
export const officialFeedSummary = ({
  remote_authors,
  tags,
  users,
}: Pick<OfficialFeedSetting, 'remote_authors' | 'tags' | 'users'>): string =>
  `Posts from ${listWords(
    [...users, ...remote_authors].map((author) => `@${author}`),
    'and',
  )}${
    tags.length > 0
      ? ` tagged ${listWords(
          tags.map((tag) => `#${tag}`),
          'or',
        )}`
      : ''
  }`

/** What a page of the official feed says it lists; nothing when it has not loaded. */
export const officialFeedOfPage = (page: OfficialFeedResponse | undefined): OfficialFeedSetting => ({
  remote_authors: page?.remote_authors ?? [],
  tags: page?.tags ?? [],
  users: page?.users ?? [],
})

/** Whether the feed lists anyone: local users or authors on other servers. */
export const listsAuthors = (feed: Pick<OfficialFeedSetting, 'remote_authors' | 'users'>): boolean =>
  feed.users.length > 0 || feed.remote_authors.length > 0
