import type {
  CreateSegmentBody,
  Segment,
  SegmentDetail,
  SegmentDetailResponse,
  SegmentMatchResponse,
  SegmentMatchResult,
  SegmentResponse,
  SegmentsQuery,
  SegmentsResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const headers = () => ({ Authorization: `Bearer ${auth.value.token}` })

const segmentUrl = (id: string) => `${API_URL}/segments/${encodeURIComponent(id)}`

export const fetchSegments = async (query: Partial<SegmentsQuery> = {}): Promise<Segment[]> => {
  const params = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined))
  const response = await axios.get<SegmentsResponse>(`${API_URL}/segments`, { headers: headers(), params })
  return response.data.data ?? []
}

export const fetchSegment = async (id: string): Promise<SegmentDetail | null> => {
  try {
    const response = await axios.get<SegmentDetailResponse>(segmentUrl(id), { headers: headers() })
    return response.data.data ?? null
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null
    throw error
  }
}

/** Creates a segment; a refused cut (400) throws an Error carrying the server's reason. */
export const createSegment = async (body: CreateSegmentBody): Promise<SegmentDetail> => {
  try {
    const response = await axios.post<SegmentDetailResponse>(`${API_URL}/segments`, body, {
      headers: headers(),
    })
    return response.data.data!
  } catch (error) {
    const reason: unknown = axios.isAxiosError(error) ? error.response?.data?.error : undefined
    if (typeof reason === 'string' && reason) throw new Error(reason)
    throw error
  }
}

export const updateSegment = async (id: string, body: { name: string }): Promise<Segment> => {
  const response = await axios.patch<SegmentResponse>(segmentUrl(id), body, { headers: headers() })
  return response.data.data!
}

export const deleteSegment = async (id: string): Promise<void> => {
  await axios.delete(segmentUrl(id), { headers: headers() })
}

/** Times every tracked activity of the segment's type on it again. */
export const matchSegment = async (id: string): Promise<SegmentMatchResult> => {
  const response = await axios.post<SegmentMatchResponse>(
    `${segmentUrl(id)}/match`,
    {},
    { headers: headers() },
  )
  return response.data.data!
}
