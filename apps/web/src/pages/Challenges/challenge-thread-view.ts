import type {
  ChallengeThreadAudience,
  ChallengeThreadEntryKind,
  ChallengeThreadReply,
  ChallengeThreadResponse,
  ChallengeThreadViewer,
} from '@aurboda/api-spec'

export const AUDIENCE_STORAGE_KEY = 'aurboda.challengeCommentAudience'

export const AUDIENCE_LABEL: Record<ChallengeThreadAudience, string> = {
  participants: 'People in the challenge',
  public: 'Public',
}

export const parseAudience = (value: string | null | undefined): ChallengeThreadAudience | null =>
  value === 'public' || value === 'participants' ? value : null

/** The audiences a comment may take: all the viewer's for a top-level one, never wider than the entry a reply answers. */
export const allowedAudiences = (
  viewer: Pick<ChallengeThreadViewer, 'audiences' | 'can_comment'>,
  parent?: Pick<ChallengeThreadReply, 'audience'>,
): ChallengeThreadAudience[] => {
  if (!viewer.can_comment) return []
  if (parent?.audience === 'participants') return viewer.audiences.filter((a) => a === 'participants')
  return viewer.audiences
}

/** The audience a composer starts on: the only allowed one, else the remembered choice, else `participants`. */
export const defaultAudience = (
  allowed: ChallengeThreadAudience[],
  remembered: ChallengeThreadAudience | null,
): ChallengeThreadAudience | null => {
  if (allowed.length === 0) return null
  if (allowed.length === 1) return allowed[0]
  if (remembered && allowed.includes(remembered)) return remembered
  return allowed.includes('participants') ? 'participants' : allowed[0]
}

/** The one-line note a composer shows instead of the picker, or null when the picker is shown. */
export const audienceNote = (
  allowed: ChallengeThreadAudience[],
  parent?: Pick<ChallengeThreadReply, 'audience'>,
): string | null => {
  if (allowed.length !== 1) return null
  if (parent?.audience === 'participants') {
    return 'A reply to a post for the people in the challenge is visible to them only'
  }
  return allowed[0] === 'participants'
    ? 'Visible to the people in the challenge'
    : "Public: visible to everyone and sent to your followers' servers as an unlisted reply"
}

export interface EntryActions {
  reply: boolean
  edit: boolean
  delete: boolean
  hide: boolean
  unhide: boolean
}

export const entryActions = (
  entry: Pick<ChallengeThreadReply, 'audience' | 'hidden' | 'own_post_id'>,
  viewer: ChallengeThreadViewer,
): EntryActions => {
  const own = entry.own_post_id !== undefined
  const host = viewer.role === 'host'
  return {
    delete: own,
    edit: own,
    hide: host && !entry.hidden,
    reply: !entry.hidden && allowedAudiences(viewer, entry).length > 0,
    unhide: host && entry.hidden,
  }
}

export interface FollowToggle {
  pressed: boolean
  label: string
  title: string
}

/** The bell on a top-level post: shown to the host and members only (the read carries `following` for them). */
export const followToggle = (following: boolean | undefined): FollowToggle | null => {
  if (following === undefined) return null
  return following
    ? {
        label: 'Following replies',
        pressed: true,
        title: 'You are notified of replies under this post. Click to stop.',
      }
    : { label: 'Follow replies', pressed: false, title: 'Get notified of replies under this post' }
}

/** What the bell shows: a change still on its way, else what the server said. */
export const shownFollowing = (server: boolean | undefined, pending: boolean | null): boolean | undefined =>
  server === undefined ? undefined : (pending ?? server)

export const kindLabel = (kind: ChallengeThreadEntryKind): string | null =>
  kind === 'share' ? 'shared the challenge' : kind === 'result' ? 'result' : null

export const audienceBadge = (audience: ChallengeThreadAudience): string | null =>
  audience === 'participants' ? `🔒 ${AUDIENCE_LABEL.participants}` : null

export type ComposerHint = 'sign-in' | 'members-only' | null

/** What stands in for the composer when the viewer cannot comment. */
export const composerHint = (
  isLoggedIn: boolean,
  viewer: ChallengeThreadViewer | undefined,
): ComposerHint => {
  if (!isLoggedIn) return 'sign-in'
  if (viewer && !viewer.can_comment) return 'members-only'
  return null
}

export const flattenThreadPages = (pages: ChallengeThreadResponse[] | undefined) => ({
  entries: (pages ?? []).flatMap((page) => page.entries ?? []),
  total: pages?.[0]?.total,
  viewer: pages?.[0]?.viewer,
})

export const readRememberedAudience = (
  storage: () => Pick<Storage, 'getItem'>,
): ChallengeThreadAudience | null => {
  try {
    return parseAudience(storage().getItem(AUDIENCE_STORAGE_KEY))
  } catch {
    return null
  }
}

export const rememberAudience = (
  storage: () => Pick<Storage, 'setItem'>,
  audience: ChallengeThreadAudience,
) => {
  try {
    storage().setItem(AUDIENCE_STORAGE_KEY, audience)
  } catch {
    // Storage blocked (private mode, embedded view): the default applies next time.
  }
}
