import type { PublicTagBlockKind, PublicTagPost } from '@aurboda/api-spec'

import { actorHost, hostMatches } from '@aurboda/api-spec'

export type ModerationAction =
  | { kind: 'hide' }
  | { kind: 'actor'; value: string }
  | { kind: 'domain'; value: string }

export interface ModerationOption {
  action: ModerationAction
  label: string
  confirmMessage: string
  confirmLabel: string
}

/** The admin's choices for one tag page post: hide it, block its author, block its domain. */
export const moderationOptions = (
  entry: Pick<PublicTagPost, 'actor_uri' | 'handle'>,
  ownHost: string,
): ModerationOption[] => {
  const author = entry.handle ?? entry.actor_uri
  const host = actorHost(entry.actor_uri)
  const options: ModerationOption[] = [
    {
      action: { kind: 'hide' },
      confirmLabel: 'Hide',
      confirmMessage: 'Hide this post from the tag pages?',
      label: 'Hide post',
    },
    {
      action: { kind: 'actor', value: entry.actor_uri },
      confirmLabel: 'Block',
      confirmMessage: `Block ${author} from the tag pages?`,
      label: `Block ${author}`,
    },
  ]
  if (host != null && !hostMatches(ownHost.toLowerCase(), host)) {
    options.push({
      action: { kind: 'domain', value: host },
      confirmLabel: 'Block',
      confirmMessage: `Block everyone on ${host} from the tag pages?`,
      label: `Block ${host}`,
    })
  }
  return options
}

/** Whether `post` goes from the page once `action` is done on the post with `postId`. */
export const removedByModeration = (
  post: Pick<PublicTagPost, 'actor_uri' | 'id'>,
  postId: string,
  action: ModerationAction,
): boolean => {
  if (action.kind === 'hide') return post.id === postId
  if (action.kind === 'actor') return post.actor_uri === action.value
  const host = actorHost(post.actor_uri)
  return host != null && hostMatches(host, action.value)
}

const KIND_LABELS: Record<PublicTagBlockKind, string> = { actor: 'Author', domain: 'Domain' }

export const blockKindLabel = (kind: PublicTagBlockKind): string => KIND_LABELS[kind]
