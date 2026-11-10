import type {
  CreateSharedDashboardBody,
  CreateSharedExerciseBody,
  FeedPostKind,
  FeedPostResponse,
  FeedPostsResponse,
  OfficialFeedQuery,
  OfficialFeedResponse,
  PublicTagPostsQuery,
  PublicTagPostsResponse,
  PublicPostsQuery,
  PublicProfileResponse,
  SharedDashboard,
  SharedDashboardResponse,
  SharedDashboardsResponse,
  SharedExercise,
  SharedExerciseResponse,
  SharedExercisesResponse,
  UpdateSharedDashboardBody,
  UpdateSharedExerciseBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { buildArticlesAtomUrl, buildOfficialFeedAtomUrl, buildPublicTagAtomUrl } from './blogUrls'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const listSharedDashboards = async (): Promise<SharedDashboard[]> => {
  const response = await axios.get<SharedDashboardsResponse>(`${API_URL}/shared-dashboards`, {
    headers: authHeaders(),
  })
  return response.data.dashboards
}

export const createSharedDashboard = async (body: CreateSharedDashboardBody): Promise<SharedDashboard> => {
  const response = await axios.post<SharedDashboardResponse>(`${API_URL}/shared-dashboards`, body, {
    headers: authHeaders(),
  })
  if (!response.data.dashboard) throw new Error(response.data.error ?? 'Failed to create shared dashboard')
  return response.data.dashboard
}

export const updateSharedDashboard = async (
  id: string,
  body: UpdateSharedDashboardBody,
): Promise<SharedDashboard> => {
  const response = await axios.put<SharedDashboardResponse>(`${API_URL}/shared-dashboards/${id}`, body, {
    headers: authHeaders(),
  })
  if (!response.data.dashboard) throw new Error(response.data.error ?? 'Failed to update shared dashboard')
  return response.data.dashboard
}

export const deleteSharedDashboard = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/shared-dashboards/${id}`, { headers: authHeaders() })
}

export const listSharedExercises = async (): Promise<SharedExercise[]> => {
  const response = await axios.get<SharedExercisesResponse>(`${API_URL}/shared-exercises`, {
    headers: authHeaders(),
  })
  return response.data.exercises
}

export const createSharedExercise = async (body: CreateSharedExerciseBody): Promise<SharedExercise> => {
  const response = await axios.post<SharedExerciseResponse>(`${API_URL}/shared-exercises`, body, {
    headers: authHeaders(),
  })
  if (!response.data.exercise) throw new Error(response.data.error ?? 'Failed to share the exercise')
  return response.data.exercise
}

export const updateSharedExercise = async (
  id: string,
  body: UpdateSharedExerciseBody,
): Promise<SharedExercise> => {
  const response = await axios.put<SharedExerciseResponse>(`${API_URL}/shared-exercises/${id}`, body, {
    headers: authHeaders(),
  })
  if (!response.data.exercise) throw new Error(response.data.error ?? 'Failed to update the shared exercise')
  return response.data.exercise
}

export const deleteSharedExercise = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/shared-exercises/${id}`, { headers: authHeaders() })
}

export const fetchPublicProfile = async (username: string): Promise<PublicProfileResponse> => {
  const response = await axios.get<PublicProfileResponse>(
    `${API_URL}/public/${encodeURIComponent(username)}/dashboards`,
  )
  return response.data
}

/**
 * One keyset page of a user's public/unlisted feed posts (newest-first) for
 * their profile page. Pass the previous page's `next_cursor` for the next one,
 * and `kind` to list only one kind of post (`article` for the blog view).
 */
export const fetchPublicPosts = async (
  username: string,
  cursor?: string,
  kind?: FeedPostKind,
  tag?: string,
): Promise<FeedPostsResponse> => {
  const params: PublicPostsQuery = {}
  if (cursor != null) params.cursor = cursor
  if (kind != null) params.kind = kind
  if (tag != null) params.tag = tag
  const response = await axios.get<FeedPostsResponse>(
    `${API_URL}/public/${encodeURIComponent(username)}/posts`,
    { params },
  )
  return response.data
}

/** Absolute URL of the Atom feed of a user's public articles. */
export const articlesAtomUrl = (username: string): string =>
  buildArticlesAtomUrl(username, API_URL, window.location.origin)

/** One keyset page of the instance's official feed, newest first across its users. */
export const fetchOfficialFeed = async (cursor?: string): Promise<OfficialFeedResponse> => {
  const params: OfficialFeedQuery = {}
  if (cursor != null) params.cursor = cursor
  const response = await axios.get<OfficialFeedResponse>(`${API_URL}/public/official-feed`, { params })
  return response.data
}

/** Absolute URL of the official feed's Atom document. */
export const officialFeedAtomUrl = (): string => buildOfficialFeedAtomUrl(API_URL, window.location.origin)

/** One keyset page of a public tag page, newest first. */
export const fetchPublicTagPosts = async (tag: string, cursor?: string): Promise<PublicTagPostsResponse> => {
  const params: PublicTagPostsQuery = {}
  if (cursor != null) params.cursor = cursor
  const response = await axios.get<PublicTagPostsResponse>(
    `${API_URL}/public/tags/${encodeURIComponent(tag)}/posts`,
    { params },
  )
  return response.data
}

/** Absolute URL of a public tag page's Atom document. */
export const publicTagAtomUrl = (tag: string): string =>
  buildPublicTagAtomUrl(tag, API_URL, window.location.origin)

/** One public/unlisted feed post, for its permalink page `/u/:username/posts/:postId`. */
export const fetchPublicPost = async (username: string, postId: string): Promise<FeedPostResponse> => {
  const response = await axios.get<FeedPostResponse>(
    `${API_URL}/public/${encodeURIComponent(username)}/posts/${encodeURIComponent(postId)}`,
  )
  return response.data
}
