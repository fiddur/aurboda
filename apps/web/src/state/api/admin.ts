import type {
  AddPublicTagBlockBody,
  AddRelayBody,
  AdminSettingsResponse,
  AdminTestEmailBody,
  AdminTestEmailResponse,
  AdminUserOverview,
  AdminUserPlan,
  AdminUserPlanResponse,
  AdminUserUsage,
  AdminUserUsageResponse,
  AdminUsersResponse,
  BaseResponse,
  DeleteAccountBody,
  FederationDeliveryFailure,
  FederationDeliveryFailuresResponse,
  PublicTagBlock,
  PublicTagBlockResponse,
  PublicTagBlocksResponse,
  PublicTagHiddenPost,
  PublicTagHiddenPostsResponse,
  Relay,
  RelayResponse,
  RelaysResponse,
  UpdateAdminSettingsBody,
  UpdateUserPlanBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export type SignupMode = 'open' | 'invite_only' | 'closed'

export type AdminSettings = Omit<AdminSettingsResponse, 'success' | 'error'>

export interface InvitationResult {
  token: string
  url: string
  expires_at: Date
}

export const fetchAdminSettings = async (): Promise<AdminSettings> => {
  const { token } = auth.value
  const response = await axios.get<AdminSettingsResponse>(`${API_URL}/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const updateAdminSettings = async (params: UpdateAdminSettingsBody): Promise<AdminSettings> => {
  const { token } = auth.value
  const response = await axios.patch<AdminSettingsResponse>(`${API_URL}/admin/settings`, params, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const generateInvitation = async (expiryHours?: number): Promise<InvitationResult> => {
  const { token } = auth.value
  const response = await axios.post<{
    success: boolean
    token: string
    url: string
    expires_at: string
  }>(
    `${API_URL}/admin/invitations`,
    { expiry_hours: expiryHours },
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return {
    expires_at: new Date(response.data.expires_at),
    token: response.data.token,
    url: response.data.url,
  }
}

export const fetchAdminUsers = async (): Promise<AdminUserOverview[]> => {
  const { token } = auth.value
  const response = await axios.get<AdminUsersResponse>(`${API_URL}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.users
}

export const fetchAdminUserUsage = async (username: string, days = 90): Promise<AdminUserUsage> => {
  const { token } = auth.value
  const response = await axios.get<AdminUserUsageResponse>(
    `${API_URL}/admin/users/${encodeURIComponent(username)}`,
    { headers: { Authorization: `Bearer ${token}` }, params: { days } },
  )
  if (!response.data.user) throw new Error(response.data.error ?? 'User not found')
  return response.data.user
}

/** Permanently deletes a user. Admin-only; `confirm_username` must repeat the username. */
export const deleteAdminUser = async (username: string, body: DeleteAccountBody): Promise<void> => {
  const { token } = auth.value
  await axios.delete<BaseResponse>(`${API_URL}/admin/users/${encodeURIComponent(username)}`, {
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  })
}

/** Changes a user's plan, paid-until date, trial end or note. Admin-only. */
export const updateAdminUserPlan = async (
  username: string,
  body: UpdateUserPlanBody,
): Promise<AdminUserPlan> => {
  const { token } = auth.value
  const response = await axios.patch<AdminUserPlanResponse>(
    `${API_URL}/admin/users/${encodeURIComponent(username)}/plan`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.data.status) throw new Error(response.data.error ?? 'User not found')
  return response.data.status
}

export const fetchRelays = async (): Promise<Relay[]> => {
  const { token } = auth.value
  const response = await axios.get<RelaysResponse>(`${API_URL}/admin/relays`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.relays ?? []
}

export const fetchFederationDeliveryFailures = async (): Promise<FederationDeliveryFailure[]> => {
  const { token } = auth.value
  const response = await axios.get<FederationDeliveryFailuresResponse>(
    `${API_URL}/admin/federation/delivery-failures`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.failures ?? []
}

export const addRelay = async (body: AddRelayBody): Promise<Relay> => {
  const { token } = auth.value
  const response = await axios.post<RelayResponse>(`${API_URL}/admin/relays`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.data.relay) throw new Error(response.data.error ?? 'Could not add the relay')
  return response.data.relay
}

export const removeRelay = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete<BaseResponse>(`${API_URL}/admin/relays/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

const authHeaders = () => ({ headers: { Authorization: `Bearer ${auth.value.token}` } })

export const hidePublicTagPost = async (postId: string): Promise<void> => {
  await axios.delete<BaseResponse>(
    `${API_URL}/admin/public-tag-posts/${encodeURIComponent(postId)}`,
    authHeaders(),
  )
}

export const fetchHiddenPublicTagPosts = async (): Promise<PublicTagHiddenPost[]> => {
  const response = await axios.get<PublicTagHiddenPostsResponse>(
    `${API_URL}/admin/public-tag-hidden`,
    authHeaders(),
  )
  return response.data.hidden ?? []
}

export const unhidePublicTagPost = async (id: string): Promise<void> => {
  await axios.delete<BaseResponse>(
    `${API_URL}/admin/public-tag-hidden/${encodeURIComponent(id)}`,
    authHeaders(),
  )
}

export const fetchPublicTagBlocks = async (): Promise<PublicTagBlock[]> => {
  const response = await axios.get<PublicTagBlocksResponse>(
    `${API_URL}/admin/public-tag-blocks`,
    authHeaders(),
  )
  return response.data.blocks ?? []
}

export const addPublicTagBlock = async (
  body: AddPublicTagBlockBody,
): Promise<{ block: PublicTagBlock; removed_posts: number }> => {
  const response = await axios.post<PublicTagBlockResponse>(
    `${API_URL}/admin/public-tag-blocks`,
    body,
    authHeaders(),
  )
  if (!response.data.block) throw new Error(response.data.error ?? 'Could not add the block')
  return { block: response.data.block, removed_posts: response.data.removed_posts ?? 0 }
}

export const removePublicTagBlock = async (id: string): Promise<void> => {
  await axios.delete<BaseResponse>(
    `${API_URL}/admin/public-tag-blocks/${encodeURIComponent(id)}`,
    authHeaders(),
  )
}

export const sendAdminTestEmail = async (body: AdminTestEmailBody): Promise<AdminTestEmailResponse> => {
  const { token } = auth.value
  const response = await axios.post<AdminTestEmailResponse>(`${API_URL}/admin/email/test`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}
