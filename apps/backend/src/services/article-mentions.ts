import {
  type ArticleContent,
  distinctHandles,
  type HandleMatch,
  handleKey,
  MAX_POST_MENTIONS,
  type PostMention,
} from '@aurboda/api-spec'

import { ownActorUri } from './timeline.ts'
import { withTimeout } from './with-timeout.ts'

const REMOTE_LOOKUP_TIMEOUT_MS = 5_000

export interface ArticleMentionDeps {
  /** This instance's web origin: a handle on its host names a local user, resolved without the network. */
  webHost: string
  userExists: (username: string) => Promise<boolean>
  /** The actor URI a remote handle names (WebFinger and the actor document); absent without federation. */
  resolveRemote?: (user: string, handle: string) => Promise<string | null>
}

const proseMarkdowns = (article: Pick<ArticleContent, 'blocks'>): string[] =>
  article.blocks.flatMap((block) => (block.type === 'prose' ? [block.markdown] : []))

const resolveHandle = async (
  deps: ArticleMentionDeps | undefined,
  user: string,
  match: HandleMatch,
): Promise<string | null> => {
  if (deps == null) return null
  if (match.host.toLowerCase() === new URL(deps.webHost).host.toLowerCase()) {
    const username = match.username.toLowerCase()
    return (await deps.userExists(username)) ? ownActorUri(deps.webHost, username) : null
  }
  if (deps.resolveRemote == null) return null
  return withTimeout(deps.resolveRemote(user, match.handle), REMOTE_LOOKUP_TIMEOUT_MS).catch(() => null)
}

/**
 * The mentions an article's prose makes: each distinct `@user@host` typed in a prose block (at most
 * `MAX_POST_MENTIONS`, so prose cannot set off unbounded lookups) that names an account. A handle
 * the post already mentions (`stored`, on an edit) keeps its account without a lookup; a local
 * user's is derived without the network; a remote one is looked up best effort, and one that does
 * not resolve is left out. Each account once, under the handle as first written. Without `deps`
 * (no lookups configured) only the stored mentions the prose still types are kept.
 */
export const resolveArticleMentions = async (
  deps: ArticleMentionDeps | undefined,
  user: string,
  article: Pick<ArticleContent, 'blocks'>,
  stored: readonly PostMention[] = [],
): Promise<PostMention[]> => {
  const known = new Map(stored.map((mention) => [handleKey(mention.handle), mention.actor_uri]))
  const handles = distinctHandles(proseMarkdowns(article), MAX_POST_MENTIONS)
  const actors = await Promise.all(
    handles.map((match) => known.get(handleKey(match.handle)) ?? resolveHandle(deps, user, match)),
  )
  const seen = new Set<string>()
  return handles.flatMap((match, i) => {
    const actor = actors[i]
    if (actor == null || seen.has(actor)) return []
    seen.add(actor)
    return [{ actor_uri: actor, handle: match.handle }]
  })
}

/** The `mentions` whose handle `article`'s prose still types; no lookups. */
export const keepTypedMentions = (
  article: Pick<ArticleContent, 'blocks'>,
  mentions: readonly PostMention[],
): PostMention[] => {
  const typed = new Set(
    distinctHandles(proseMarkdowns(article), MAX_POST_MENTIONS).map((match) => handleKey(match.handle)),
  )
  return mentions.filter((mention) => typed.has(handleKey(mention.handle)))
}
