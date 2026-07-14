import type {
  CreateArticleBody,
  FeedPost,
  FeedPostResponse,
  FeedPostsResponse,
  FollowActorResponse,
  FollowerActor,
  FollowerResponse,
  FollowersQuery,
  FollowersResponse,
  FollowingActor,
  FollowingResponse,
  ShareActivityBody,
  TimelineResponse,
  UpdateArticleBody,
  UpdateFeedPostBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { parseTimelineEvents } from './timeline-sse'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

/** Publish an activity to the user's federated feed. */
export const shareActivity = async (activityId: string, body: ShareActivityBody): Promise<FeedPost> => {
  const response = await axios.post<FeedPostResponse>(
    `${API_URL}/feed/activities/${activityId}/share`,
    body,
    { headers: authHeaders() },
  )
  if (!response.data.post) throw new Error('Share failed: no post returned')
  return response.data.post
}

/** List every post the user has shared to their feed, newest-first. */
export const fetchFeed = async (): Promise<FeedPost[]> => {
  const response = await axios.get<FeedPostsResponse>(`${API_URL}/feed`, { headers: authHeaders() })
  return response.data.posts
}

/** Update a shared post's metric selection, series opt-in, or visibility. */
export const updateFeedPost = async (postId: string, body: UpdateFeedPostBody): Promise<FeedPost> => {
  const response = await axios.patch<FeedPostResponse>(`${API_URL}/feed/${postId}`, body, {
    headers: authHeaders(),
  })
  if (!response.data.post) throw new Error('Update failed: no post returned')
  return response.data.post
}

/** Publish a long-form article (title + prose + inline chart blocks) to the feed. */
export const createArticle = async (body: CreateArticleBody): Promise<FeedPost> => {
  const response = await axios.post<FeedPostResponse>(`${API_URL}/feed/articles`, body, {
    headers: authHeaders(),
  })
  if (!response.data.post) throw new Error('Create failed: no post returned')
  return response.data.post
}

/** Edit an article post (title, blocks, default window, visibility). */
export const updateArticle = async (postId: string, body: UpdateArticleBody): Promise<FeedPost> => {
  const response = await axios.patch<FeedPostResponse>(`${API_URL}/feed/articles/${postId}`, body, {
    headers: authHeaders(),
  })
  if (!response.data.post) throw new Error('Update failed: no post returned')
  return response.data.post
}

/** Unshare a post (removes it from the feed and retracts it from followers). */
export const deleteFeedPost = async (postId: string): Promise<void> => {
  await axios.delete(`${API_URL}/feed/${postId}`, { headers: authHeaders() })
}

/** List the actors the user follows (accepted + pending), newest-first. */
export const fetchFollowing = async (): Promise<FollowingActor[]> => {
  const response = await axios.get<FollowingResponse>(`${API_URL}/feed/following`, {
    headers: authHeaders(),
  })
  return response.data.following
}

/** Pull the server's `{ error }` message off a failed request, or fall back to `fallback`. */
const apiErrorMessage = (error: unknown, fallback: string): string => {
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
    // Surface the server's specific reason (e.g. "You can't follow yourself.",
    // "Could not resolve an actor for …") instead of a generic message.
    throw new Error(apiErrorMessage(error, 'Couldn’t follow that handle. Check it and try again.'))
  }
  if (!response.data.actor) throw new Error('Follow failed: no actor returned')
  return response.data.actor
}

/** Unfollow an actor by its local follow id. */
export const unfollowActor = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/feed/following/${id}`, { headers: authHeaders() })
}

/** List the actors that follow the user, optionally filtered by acceptance state. */
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
export const fetchTimeline = async (cursor?: string): Promise<TimelineResponse> => {
  const response = await axios.get<TimelineResponse>(`${API_URL}/feed/timeline`, {
    headers: authHeaders(),
    params: cursor ? { cursor } : {},
  })
  return response.data
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
