import type { PostAuthor } from '../Feed/FeedPostCard'

import { avatarUrl } from '../../state/api'

/** A public page's author identity: the same one the owner's own feed builds (`@user@host`, avatar on this host). */
export const publicAuthor = (username: string): PostAuthor => ({
  avatarUrl: avatarUrl(username),
  displayName: username,
  handle: `@${username}@${window.location.host}`,
  profileUrl: `/u/${encodeURIComponent(username)}`,
  username,
})
