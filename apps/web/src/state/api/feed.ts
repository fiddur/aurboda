import type {
  FeedPost,
  FeedPostResponse,
  FeedPostsResponse,
  FollowActorResponse,
  FollowingActor,
  FollowingResponse,
  ShareActivityBody,
  UpdateFeedPostBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

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

/** Follow a fediverse actor by handle (`@user@host`, `user@host`, or actor URL). */
export const followActor = async (handle: string): Promise<FollowingActor> => {
  const response = await axios.post<FollowActorResponse>(
    `${API_URL}/feed/following`,
    { handle },
    { headers: authHeaders() },
  )
  if (!response.data.actor) throw new Error('Follow failed: no actor returned')
  return response.data.actor
}

/** Unfollow an actor by its local follow id. */
export const unfollowActor = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/feed/following/${id}`, { headers: authHeaders() })
}
