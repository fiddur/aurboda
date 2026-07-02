import type {
  Challenge,
  ChallengeParticipation,
  ChallengeParticipationResponse,
  ChallengeParticipationsResponse,
  ChallengeResponse,
  ChallengesResponse,
  ChallengeStanding,
  ChallengeStandingsResponse,
  CreateChallengeBody,
  PublicChallengeResponse,
  PublicSharedDashboardResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

// ===========================================================================
// Owner / joiner (authenticated)
// ===========================================================================

export const listChallenges = async (): Promise<Challenge[]> => {
  const res = await axios.get<ChallengesResponse>(`${API_URL}/challenges`, { headers: authHeaders() })
  return res.data.challenges
}

export const createChallenge = async (body: CreateChallengeBody): Promise<Challenge> => {
  const res = await axios.post<ChallengeResponse>(`${API_URL}/challenges`, body, { headers: authHeaders() })
  if (!res.data.challenge) throw new Error(res.data.error ?? 'Failed to create challenge')
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

export const leaveChallenge = async (participationId: string): Promise<void> => {
  await axios.delete(`${API_URL}/challenges/participations/${participationId}`, { headers: authHeaders() })
}

// ===========================================================================
// Public viewing (unauthenticated — no Authorization header)
// ===========================================================================

/** Resolve a `/u/:username/:slug` resource — either a shared dashboard or a challenge. */
export const fetchPublicResource = async (
  username: string,
  slug: string,
): Promise<PublicSharedDashboardResponse | PublicChallengeResponse> => {
  const res = await axios.get<PublicSharedDashboardResponse | PublicChallengeResponse>(
    `${API_URL}/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
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
