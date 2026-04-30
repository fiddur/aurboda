import type {
  AddSensitivityFlagBody,
  SensitivityFlag,
  SensitivityFlagResponse,
  SensitivityFlagsResponse,
  UpdateSensitivityFlagBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const headers = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const fetchSensitivityFlags = async (): Promise<SensitivityFlag[]> => {
  const res = await axios.get<SensitivityFlagsResponse>(`${API_URL}/sensitivity-flags`, {
    headers: headers(),
  })
  return res.data.data ?? []
}

export const createSensitivityFlag = async (body: AddSensitivityFlagBody): Promise<SensitivityFlag> => {
  const res = await axios.post<SensitivityFlagResponse>(`${API_URL}/sensitivity-flags`, body, {
    headers: headers(),
  })
  if (!res.data.data) throw new Error('Failed to create sensitivity flag')
  return res.data.data
}

export const updateSensitivityFlag = async (
  id: string,
  body: UpdateSensitivityFlagBody,
): Promise<SensitivityFlag> => {
  const res = await axios.patch<SensitivityFlagResponse>(`${API_URL}/sensitivity-flags/${id}`, body, {
    headers: headers(),
  })
  if (!res.data.data) throw new Error('Failed to update sensitivity flag')
  return res.data.data
}

export const deleteSensitivityFlag = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/sensitivity-flags/${id}`, { headers: headers() })
}

export const setFoodItemSensitivities = async (foodItemId: string, flagIds: string[]): Promise<void> => {
  await axios.put(
    `${API_URL}/food-items/${foodItemId}/sensitivities`,
    { sensitivity_flag_ids: flagIds },
    { headers: headers() },
  )
}
