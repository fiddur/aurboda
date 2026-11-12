import type { BaseResponse, FeedImage, FeedImageResponse, FeedImagesResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export type UploadFailure = Error & { status?: number; network?: boolean }

const uploadFailure = (error: unknown): UploadFailure => {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error : new Error(String(error))
  const body = error.response?.data as BaseResponse | undefined
  return Object.assign(new Error(body?.error ?? error.message), {
    network: error.response === undefined,
    status: error.response?.status,
  })
}

export const uploadFeedImage = async (file: File): Promise<FeedImage> => {
  const formData = new FormData()
  formData.append('image', file)
  try {
    const res = await axios.post<FeedImageResponse>(`${API_URL}/feed/images`, formData, {
      headers: authHeaders(),
    })
    if (!res.data.image) throw new Error(res.data.error ?? 'Failed to upload picture')
    return res.data.image
  } catch (error) {
    throw uploadFailure(error)
  }
}

export const fetchFeedImages = async (): Promise<FeedImagesResponse> => {
  const res = await axios.get<FeedImagesResponse>(`${API_URL}/feed/images`, { headers: authHeaders() })
  return res.data
}

export const deleteFeedImage = async (id: string): Promise<void> => {
  await axios.delete<BaseResponse>(`${API_URL}/feed/images/${id}`, { headers: authHeaders() })
}
