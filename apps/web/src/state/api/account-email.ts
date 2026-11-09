import type { AccountEmailResponse, UpdateAccountEmailBody } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchMyEmail = async (): Promise<AccountEmailResponse> => {
  const { token } = auth.value
  const response = await axios.get<AccountEmailResponse>(`${API_URL}/account/email`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const updateMyEmail = async (body: UpdateAccountEmailBody): Promise<AccountEmailResponse> => {
  const { token } = auth.value
  const response = await axios.put<AccountEmailResponse>(`${API_URL}/account/email`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}
