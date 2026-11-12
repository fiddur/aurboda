import type {
  ArticleDraft,
  ArticleDraftResponse,
  ArticleDraftsResponse,
  ArticleExportResponse,
  ArticlePreviewResponse,
  CreateArticleDraftBody,
  CreateArticleBody,
  DashboardSharePreviewResponse,
  ExerciseSharePreviewResponse,
  FeedPost,
  FeedPostReaction,
  FeedPostReactionsResponse,
  FeedPostRepliesResponse,
  FeedPostResponse,
  FeedPostsResponse,
  FeedVisibility,
  FollowActorResponse,
  FollowedTag,
  FollowedTagsResponse,
  FollowerActor,
  FollowerResponse,
  FollowersQuery,
  FollowersResponse,
  FollowingActor,
  FollowingResponse,
  FollowTagResponse,
  PreviewArticleBody,
  ReplyToPostBody,
  ShareActivityBody,
  ShareChallengeBody,
  ShareDashboardPeriodBody,
  ShareExerciseBody,
  SharePreviewResponse,
  TimelineEntry,
  TimelineEntryResponse,
  TimelineRepliesResponse,
  TimelineResponse,
  UpdateArticleBody,
  UpdateArticleDraftBody,
  UpdateFeedPostBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { parseTimelineEvents } from './timeline-sse'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const shareActivity = async (activityId: string, body: ShareActivityBody): Promise<FeedPost> => {
  const response = await axios.post<FeedPostResponse>(
    `${API_URL}/feed/activities/${activityId}/share`,
    body,
    { headers: authHeaders() },
  )
  if (!response.data.post) throw new Error('Share failed: no post returned')
  return response.data.post
}

/**
 * One keyset page of the user's own feed posts, newest-first. Pass the
 * previous page's `next_cursor` for the next page; null means the last page.
 */
export const fetchFeed = async (cursor?: string): Promise<FeedPostsResponse> => {
  const response = await axios.get<FeedPostsResponse>(`${API_URL}/feed`, {
    headers: authHeaders(),
    params: cursor === undefined ? {} : { cursor },
  })
  return response.data
}

/**
 * Preview what sharing `activityId` with this selection would federate:
 * the exact post HTML + resolved metric values. Creates nothing.
 */
export const previewShare = async (
  activityId: string,
  body: Pick<ShareActivityBody, 'include_exercises' | 'included_metrics' | 'message' | 'tags'>,
): Promise<SharePreviewResponse> => {
  const response = await axios.post<SharePreviewResponse>(
    `${API_URL}/feed/activities/${activityId}/preview`,
    body,
    { headers: authHeaders() },
  )
  return response.data
}

export const shareChallenge = async (body: ShareChallengeBody): Promise<FeedPost> => {
  const response = await axios.post<FeedPostResponse>(`${API_URL}/feed/challenges`, body, {
    headers: authHeaders(),
  })
  if (!response.data.post) throw new Error('Share failed: no post returned')
  return response.data.post
}

export const shareExercise = async (body: ShareExerciseBody): Promise<FeedPost> => {
  const response = await axios.post<FeedPostResponse>(`${API_URL}/feed/exercises`, body, {
    headers: authHeaders(),
  })
  if (!response.data.post) throw new Error('Share failed: no post returned')
  return response.data.post
}

/** What an article (draft) would federate as, and how Mastodon would show it; creates nothing. */
export const previewArticle = async (body: PreviewArticleBody): Promise<ArticlePreviewResponse> => {
  const response = await axios.post<ArticlePreviewResponse>(`${API_URL}/feed/articles/preview`, body, {
    headers: authHeaders(),
  })
  return response.data
}

/** What sharing this exercise with these opt-ins would post: the Note HTML and the native payload. Creates nothing. */
export const previewExerciseShare = async (
  body: Omit<ShareExerciseBody, 'visibility'>,
): Promise<ExerciseSharePreviewResponse> => {
  const response = await axios.post<ExerciseSharePreviewResponse>(`${API_URL}/feed/exercises/preview`, body, {
    headers: authHeaders(),
  })
  return response.data
}

export const shareDashboardPeriod = async (body: ShareDashboardPeriodBody): Promise<FeedPost> => {
  const response = await axios.post<FeedPostResponse>(`${API_URL}/feed/dashboards`, body, {
    headers: authHeaders(),
  })
  if (!response.data.post) throw new Error('Share failed: no post returned')
  return response.data.post
}

/** What sharing this dashboard period would post: the Note HTML and the native payload. Creates nothing. */
export const previewDashboardPeriodShare = async (
  body: Omit<ShareDashboardPeriodBody, 'visibility'>,
): Promise<DashboardSharePreviewResponse> => {
  const response = await axios.post<DashboardSharePreviewResponse>(
    `${API_URL}/feed/dashboards/preview`,
    body,
    {
      headers: authHeaders(),
    },
  )
  return response.data
}

export const updateFeedPost = async (postId: string, body: UpdateFeedPostBody): Promise<FeedPost> => {
  const response = await axios.patch<FeedPostResponse>(`${API_URL}/feed/${postId}`, body, {
    headers: authHeaders(),
  })
  if (!response.data.post) throw new Error('Update failed: no post returned')
  return response.data.post
}

export const createArticle = async (body: CreateArticleBody): Promise<FeedPost> => {
  let response
  try {
    response = await axios.post<FeedPostResponse>(`${API_URL}/feed/articles`, body, {
      headers: authHeaders(),
    })
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t publish the article. Please try again.'))
  }
  if (!response.data.post) throw new Error('Create failed: no post returned')
  return response.data.post
}

export const updateArticle = async (postId: string, body: UpdateArticleBody): Promise<FeedPost> => {
  let response
  try {
    response = await axios.patch<FeedPostResponse>(`${API_URL}/feed/articles/${postId}`, body, {
      headers: authHeaders(),
    })
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t save the article. Please try again.'))
  }
  if (!response.data.post) throw new Error('Update failed: no post returned')
  return response.data.post
}

export const fetchArticleDrafts = async (): Promise<ArticleDraft[]> => {
  const response = await axios.get<ArticleDraftsResponse>(`${API_URL}/feed/article-drafts`, {
    headers: authHeaders(),
  })
  return response.data.drafts
}

const draftOrThrow = (response: ArticleDraftResponse): ArticleDraft => {
  if (!response.draft) throw new Error('Save failed: no draft returned')
  return response.draft
}

export const createArticleDraft = async (body: Partial<CreateArticleDraftBody>): Promise<ArticleDraft> => {
  let response
  try {
    response = await axios.post<ArticleDraftResponse>(`${API_URL}/feed/article-drafts`, body, {
      headers: authHeaders(),
    })
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t save the draft. Please try again.'))
  }
  return draftOrThrow(response.data)
}

export const updateArticleDraft = async (id: string, body: UpdateArticleDraftBody): Promise<ArticleDraft> => {
  let response
  try {
    response = await axios.patch<ArticleDraftResponse>(`${API_URL}/feed/article-drafts/${id}`, body, {
      headers: authHeaders(),
    })
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t save the draft. Please try again.'))
  }
  return draftOrThrow(response.data)
}

export const deleteArticleDraft = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/feed/article-drafts/${id}`, { headers: authHeaders() })
}

/** Publish a draft as an article post; the server validates it and deletes the draft on success. */
export const publishArticleDraft = async (id: string, visibility?: FeedVisibility): Promise<FeedPost> => {
  let response
  try {
    response = await axios.post<FeedPostResponse>(
      `${API_URL}/feed/article-drafts/${id}/publish`,
      visibility ? { visibility } : {},
      { headers: authHeaders() },
    )
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t publish the article. Please try again.'))
  }
  if (!response.data.post) throw new Error('Publish failed: no post returned')
  return response.data.post
}

/** Unshare a post (removes it from the feed and retracts it from followers). */
export const deleteFeedPost = async (postId: string): Promise<void> => {
  await axios.delete(`${API_URL}/feed/${postId}`, { headers: authHeaders() })
}

/**
 * Export an article as paste-ready markdown (title + prose + one image link per
 * chart/correlation block) for pasting into a text-only destination like
 * r/QuantifiedSelf.
 */
export const fetchArticleExport = async (postId: string): Promise<string> => {
  let response
  try {
    response = await axios.get<ArticleExportResponse>(`${API_URL}/feed/articles/${postId}/export`, {
      headers: authHeaders(),
    })
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t export this article. Please try again.'))
  }
  if (!response.data.markdown) throw new Error('Export failed: no markdown returned')
  return response.data.markdown
}

/** List the actors the user follows (accepted + pending), newest-first. */
export const fetchFollowing = async (): Promise<FollowingActor[]> => {
  const response = await axios.get<FollowingResponse>(`${API_URL}/feed/following`, {
    headers: authHeaders(),
  })
  return response.data.following
}

export const apiErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const serverError = (error.response?.data as { error?: unknown } | undefined)?.error
    if (typeof serverError === 'string' && serverError.trim()) return serverError
  }
  return fallback
}

/** Follow a fediverse actor by handle (`@user@host`, `user@host`, or actor URL). */
export const followActor = async (handle: string): Promise<FollowingActor> => {
  let response
  try {
    response = await axios.post<FollowActorResponse>(
      `${API_URL}/feed/following`,
      { handle },
      { headers: authHeaders() },
    )
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t follow that handle. Check it and try again.'))
  }
  if (!response.data.actor) throw new Error('Follow failed: no actor returned')
  return response.data.actor
}

/** Unfollow an actor by its local follow id. */
export const unfollowActor = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/feed/following/${id}`, { headers: authHeaders() })
}

/** Toggle whether new posts from a followed actor notify (by its local follow id). */
export const updateFollowingNotify = async (id: string, notify_on_post: boolean): Promise<FollowingActor> => {
  const response = await axios.patch<FollowActorResponse>(
    `${API_URL}/feed/following/${id}`,
    { notify_on_post },
    { headers: authHeaders() },
  )
  if (!response.data.actor) throw new Error('Update failed: no actor returned')
  return response.data.actor
}

/** List the hashtags the user follows (accepted + pending), by tag. */
export const fetchFollowedTags = async (): Promise<FollowedTag[]> => {
  const response = await axios.get<FollowedTagsResponse>(`${API_URL}/feed/followed-tags`, {
    headers: authHeaders(),
  })
  return response.data.followed_tags
}

/** Follow a hashtag (with or without `#`) through its tag actor. */
export const followTag = async (tag: string): Promise<FollowedTag> => {
  let response
  try {
    response = await axios.post<FollowTagResponse>(
      `${API_URL}/feed/followed-tags`,
      { tag },
      { headers: authHeaders() },
    )
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t follow that tag. Check it and try again.'))
  }
  if (!response.data.followed_tag) throw new Error('Follow failed: no tag returned')
  return response.data.followed_tag
}

export const unfollowTag = async (tag: string): Promise<void> => {
  await axios.delete(`${API_URL}/feed/followed-tags/${encodeURIComponent(tag)}`, { headers: authHeaders() })
}

export const fetchFollowers = async (status: FollowersQuery['status'] = 'all'): Promise<FollowerActor[]> => {
  const response = await axios.get<FollowersResponse>(`${API_URL}/feed/followers`, {
    headers: authHeaders(),
    params: { status },
  })
  return response.data.followers
}

/** Approve a pending follow request by the local follower id. */
export const approveFollower = async (id: string): Promise<FollowerActor> => {
  const response = await axios.post<FollowerResponse>(
    `${API_URL}/feed/followers/${id}/approve`,
    {},
    { headers: authHeaders() },
  )
  if (!response.data.follower) throw new Error('Approve failed: no follower returned')
  return response.data.follower
}

/** Reject a pending follow request, or remove a follower, by the local follower id. */
export const rejectFollower = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/feed/followers/${id}`, { headers: authHeaders() })
}

/**
 * Fetch one page of the home timeline (posts from the actors the user follows,
 * newest-first). Pass the previous page's `next_cursor` to page; a null cursor
 * (in the response) means there are no more.
 */
export const fetchTimeline = async (cursor?: string, tag?: string | null): Promise<TimelineResponse> => {
  const response = await axios.get<TimelineResponse>(`${API_URL}/feed/timeline`, {
    headers: authHeaders(),
    params: { ...(cursor ? { cursor } : {}), ...(tag ? { tag } : {}) },
  })
  return response.data
}

/**
 * Fetch a live, bounded snapshot of one timeline post's remote reply thread.
 * `partial: true` means the server's fetch budget ran out before the thread did.
 */
export const fetchTimelineReplies = async (entryId: string): Promise<TimelineRepliesResponse> => {
  const response = await axios.get<TimelineRepliesResponse>(
    `${API_URL}/feed/timeline/${encodeURIComponent(entryId)}/replies`,
    { headers: authHeaders() },
  )
  return response.data
}

/**
 * Toggle a like ⭐ or boost 🔄 on one home-timeline post and return the server's
 * updated entry (the authoritative replacement for the caller's optimistic
 * patch). All four are idempotent server-side.
 */
const toggleReaction = async (
  entryId: string,
  kind: 'boost' | 'like',
  on: boolean,
): Promise<TimelineEntry> => {
  const url = `${API_URL}/feed/timeline/${encodeURIComponent(entryId)}/${kind}`
  let response
  try {
    response = on
      ? await axios.post<TimelineEntryResponse>(url, {}, { headers: authHeaders() })
      : await axios.delete<TimelineEntryResponse>(url, { headers: authHeaders() })
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t save that. Please try again.'))
  }
  if (!response.data.entry) throw new Error('No entry returned')
  return response.data.entry
}

/** Favourite a home-timeline post (delivers an AS2 `Like` to its author). */
export const likeTimelineEntry = (entryId: string): Promise<TimelineEntry> =>
  toggleReaction(entryId, 'like', true)

/** Remove your favourite (delivers an `Undo{Like}`). */
export const unlikeTimelineEntry = (entryId: string): Promise<TimelineEntry> =>
  toggleReaction(entryId, 'like', false)

/** Boost a home-timeline post (delivers an AS2 `Announce` to your followers + its author). */
export const boostTimelineEntry = (entryId: string): Promise<TimelineEntry> =>
  toggleReaction(entryId, 'boost', true)

/** Retract your boost (delivers an `Undo{Announce}`). */
export const unboostTimelineEntry = (entryId: string): Promise<TimelineEntry> =>
  toggleReaction(entryId, 'boost', false)

/**
 * Reply 🗨 to a home-timeline post. Publishes a reply post delivered to the
 * user's followers AND the answered author's inbox; returns the created post.
 */
export const replyToTimelineEntry = async (entryId: string, body: ReplyToPostBody): Promise<FeedPost> => {
  let response
  try {
    response = await axios.post<FeedPostResponse>(
      `${API_URL}/feed/timeline/${encodeURIComponent(entryId)}/reply`,
      body,
      { headers: authHeaders() },
    )
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t post that reply. Please try again.'))
  }
  if (!response.data.post) throw new Error('Reply failed: no post returned')
  return response.data.post
}

/**
 * The comments this instance holds under one of YOUR posts (replies remote
 * actors delivered to you) — full timeline entries, oldest first. No network
 * fetch server-side.
 */
export const fetchFeedPostReplies = async (postId: string): Promise<TimelineEntry[]> => {
  const response = await axios.get<FeedPostRepliesResponse>(
    `${API_URL}/feed/${encodeURIComponent(postId)}/replies`,
    { headers: authHeaders() },
  )
  return response.data.replies
}

/** Who favourited, boosted or quoted one of YOUR feed posts, newest first. */
export const fetchFeedPostReactions = async (postId: string): Promise<FeedPostReaction[]> => {
  const response = await axios.get<FeedPostReactionsResponse>(
    `${API_URL}/feed/${encodeURIComponent(postId)}/reactions`,
    { headers: authHeaders() },
  )
  return response.data.reactions
}

/**
 * Open the live home-timeline SSE stream, invoking `onPing` for each "new posts"
 * event. Uses `fetch` (not `EventSource`) so the bearer token rides in the
 * `Authorization` header rather than the URL. Calls `onClose` when the stream ends
 * or errors (so the caller can fall back to polling). Returns a teardown.
 */
export const openTimelineStream = (onPing: () => void, onClose: () => void): (() => void) => {
  const controller = new AbortController()
  void (async () => {
    try {
      const response = await fetch(`${API_URL}/feed/timeline/stream`, {
        headers: authHeaders(),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        onClose()
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { pings, rest } = parseTimelineEvents(buffer)
        buffer = rest
        for (let i = 0; i < pings; i++) onPing()
      }
      onClose()
    } catch {
      if (!controller.signal.aborted) onClose()
    }
  })()
  return () => controller.abort()
}
