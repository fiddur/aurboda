/**
 * The official feed (the instance blog at `/blog`): public posts by chosen
 * users that carry one of chosen tags. Helpers for its admin inputs and the
 * line that says what it lists.
 */

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

const listWords = (items: readonly string[], conjunction: string): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`

/** `Posts from fiddur and alice tagged #aurboda or #qs`, or `Posts from fiddur` without tags. */
export const officialFeedSummary = (users: readonly string[], tags: readonly string[]): string =>
  `Posts from ${listWords(
    users.map((user) => `@${user}`),
    'and',
  )}${
    tags.length > 0
      ? ` tagged ${listWords(
          tags.map((tag) => `#${tag}`),
          'or',
        )}`
      : ''
  }`
