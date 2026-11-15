import type {
  AccountEmailResponse,
  BaseResponse,
  RecoveryCompleteBody,
  RecoveryCompleteResponse,
  RecoveryRequestResponse,
  SendEmailVerificationResponse,
  UpdateAccountEmailBody,
} from '@aurboda/api-spec'

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

export const sendEmailVerification = async (): Promise<SendEmailVerificationResponse> => {
  const { token } = auth.value
  const response = await axios.post<SendEmailVerificationResponse>(
    `${API_URL}/account/email/verification`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

/** Public: the token from the emailed link is the credential. */
export const verifyEmailToken = async (token: string): Promise<BaseResponse> => {
  const response = await axios.post<BaseResponse>(`${API_URL}/account/email/verify`, { token })
  return response.data
}

export const requestAccountRecovery = async (identifier: string): Promise<RecoveryRequestResponse> => {
  const response = await axios.post<RecoveryRequestResponse>(`${API_URL}/account/recovery/request`, {
    identifier,
  })
  return response.data
}

/** Uses a recovery link and signs in: the answer is a session token like `/login`'s. */
export const completeAccountRecovery = async (
  body: RecoveryCompleteBody,
): Promise<RecoveryCompleteResponse> => {
  const response = await axios.post<RecoveryCompleteResponse>(`${API_URL}/account/recovery/complete`, body)
  return response.data
}
