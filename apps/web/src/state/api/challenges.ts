import type {
  Challenge,
  ChallengeParticipation,
  ChallengeParticipationResponse,
  ChallengeParticipationsResponse,
  ChallengePreview,
  ChallengePreviewResponse,
  ChallengeResponse,
  ChallengesResponse,
  ChallengeCommentBody,
  ChallengeStanding,
  ChallengeStandingsResponse,
  ChallengeThreadEntry,
  ChallengeThreadEntryResponse,
  ChallengeThreadResponse,
  CreateChallengeBody,
  DiscoverChallengesResponse,
  PublicChallengeResponse,
  PublicSharedDashboardResponse,
  PublicSharedExerciseResponse,
  UpdateChallengeBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { apiErrorMessage } from './feed'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const listChallenges = async (): Promise<Challenge[]> => {
  const res = await axios.get<ChallengesResponse>(`${API_URL}/challenges`, { headers: authHeaders() })
  return res.data.challenges
}

export const createChallenge = async (body: CreateChallengeBody): Promise<Challenge> => {
  const res = await axios.post<ChallengeResponse>(`${API_URL}/challenges`, body, { headers: authHeaders() })
  if (!res.data.challenge) throw new Error(res.data.error ?? 'Failed to create challenge')
  return res.data.challenge
}

export const updateChallenge = async (id: string, body: UpdateChallengeBody): Promise<Challenge> => {
  const res = await axios.put<ChallengeResponse>(`${API_URL}/challenges/${id}`, body, {
    headers: authHeaders(),
  })
  if (!res.data.challenge) throw new Error(res.data.error ?? 'Failed to update challenge')
  return res.data.challenge
}

export const uploadChallengeBanner = async (id: string, file: File): Promise<Challenge> => {
  const formData = new FormData()
  formData.append('banner', file)
  const res = await axios.post<ChallengeResponse>(`${API_URL}/challenges/${id}/banner`, formData, {
    headers: authHeaders(),
  })
  if (!res.data.challenge) throw new Error(res.data.error ?? 'Failed to upload banner')
  return res.data.challenge
}

export const deleteChallengeBanner = async (id: string): Promise<Challenge> => {
  const res = await axios.delete<ChallengeResponse>(`${API_URL}/challenges/${id}/banner`, {
    headers: authHeaders(),
  })
  if (!res.data.challenge) throw new Error(res.data.error ?? 'Failed to remove banner')
  return res.data.challenge
}

export const deleteChallenge = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/challenges/${id}`, { headers: authHeaders() })
}

export const listMyChallengeParticipations = async (): Promise<ChallengeParticipation[]> => {
  const res = await axios.get<ChallengeParticipationsResponse>(`${API_URL}/challenges/participations/mine`, {
    headers: authHeaders(),
  })
  return res.data.participations
}

export const joinChallengeByUrl = async (challengeUrl: string): Promise<ChallengeParticipation> => {
  const res = await axios.post<ChallengeParticipationResponse>(
    `${API_URL}/challenges/join`,
    { challenge_url: challengeUrl },
    { headers: authHeaders() },
  )
  if (!res.data.participation) throw new Error(res.data.error ?? 'Failed to join challenge')
  return res.data.participation
}

/** What joining `challengeUrl` would join, read from its host without joining. */
export const previewChallenge = async (challengeUrl: string): Promise<ChallengePreview> => {
  const res = await axios.get<ChallengePreviewResponse>(`${API_URL}/challenges/preview`, {
    headers: authHeaders(),
    params: { challenge_url: challengeUrl },
  })
  if (!res.data.challenge) throw new Error(res.data.error ?? 'Failed to read the challenge')
  return res.data.challenge
}

export const leaveChallenge = async (participationId: string): Promise<void> => {
  await axios.delete(`${API_URL}/challenges/participations/${participationId}`, { headers: authHeaders() })
}

/** Open challenges hosted by people you follow that you haven't joined (walks their instances, so it can take a moment). */
export const discoverChallenges = async (): Promise<DiscoverChallengesResponse> => {
  const res = await axios.get<DiscoverChallengesResponse>(`${API_URL}/challenges/discover`, {
    headers: authHeaders(),
  })
  return res.data
}

type PublicResourceResponse =
  | PublicSharedDashboardResponse
  | PublicChallengeResponse
  | PublicSharedExerciseResponse

/**
 * Resolve a `/u/:username/:slug` resource — a shared dashboard, a challenge or a shared exercise. `period`
 * asks a browsable period dashboard for one finished period; the server ignores it otherwise.
 */
export const fetchPublicResource = async (
  username: string,
  slug: string,
  period?: string,
): Promise<PublicResourceResponse> => {
  const res = await axios.get<PublicResourceResponse>(
    `${API_URL}/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
    period === undefined ? undefined : { params: { period } },
  )
  return res.data
}

export const fetchPublicChallengeStandings = async (
  username: string,
  slug: string,
  options: { bustCache?: boolean } = {},
): Promise<ChallengeStanding[]> => {
  const res = await axios.get<ChallengeStandingsResponse>(
    `${API_URL}/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/standings`,
    // The endpoint sends `Cache-Control: public, max-age=60`, so a plain refetch right
    // after joining can be served a pre-join member list from an HTTP/proxy cache. A
    // unique query param forces a never-before-seen URL past those caches. The backend
    // ignores unknown params (and never honors `refresh` here — see public-shares-router).
    { params: options.bustCache ? { _: Date.now() } : undefined },
  )
  return res.data.members ?? []
}

/**
 * A challenge's comment thread: the viewer's view when signed in, else the public entries only.
 */
export const fetchChallengeThread = async (
  username: string,
  slug: string,
  challengeUrl: string,
  cursor?: string,
): Promise<ChallengeThreadResponse> => {
  try {
    const res = auth.value.token
      ? await axios.get<ChallengeThreadResponse>(`${API_URL}/challenges/thread`, {
          headers: authHeaders(),
          params: { challenge_url: challengeUrl, cursor },
        })
      : await axios.get<ChallengeThreadResponse>(
          `${API_URL}/public/${encodeURIComponent(username)}/challenges/${encodeURIComponent(slug)}/thread`,
          { params: { cursor } },
        )
    return res.data
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t load the comments.'))
  }
}

export const addChallengeComment = async (body: ChallengeCommentBody): Promise<ChallengeThreadEntry> => {
  let res
  try {
    res = await axios.post<ChallengeThreadEntryResponse>(`${API_URL}/challenges/thread/comments`, body, {
      headers: authHeaders(),
    })
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t post the comment. Please try again.'))
  }
  if (!res.data.entry) throw new Error(res.data.error ?? 'Couldn’t post the comment.')
  return res.data.entry
}

/** Hide (host) or unhide a thread entry. */
export const setChallengeCommentHidden = async (
  challengeUrl: string,
  entryId: string,
  hidden: boolean,
): Promise<ChallengeThreadEntry> => {
  const url = `${API_URL}/challenges/thread/entries/${encodeURIComponent(entryId)}/hidden`
  let res
  try {
    res = hidden
      ? await axios.post<ChallengeThreadEntryResponse>(
          url,
          { challenge_url: challengeUrl },
          { headers: authHeaders() },
        )
      : await axios.delete<ChallengeThreadEntryResponse>(url, {
          headers: authHeaders(),
          params: { challenge_url: challengeUrl },
        })
  } catch (error) {
    throw new Error(apiErrorMessage(error, hidden ? 'Couldn’t hide that.' : 'Couldn’t unhide that.'))
  }
  if (!res.data.entry) throw new Error(res.data.error ?? 'No entry returned')
  return res.data.entry
}
