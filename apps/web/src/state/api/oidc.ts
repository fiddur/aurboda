import type {
  AddOidcProviderBody,
  DeleteOidcProviderResponse,
  BaseResponse,
  OidcLinksResponse,
  OidcLoginResponse,
  OidcProvider,
  OidcProviderResponse,
  OidcProvidersResponse,
  OidcPublicProvider,
  OidcPublicProvidersResponse,
  OidcSignupBody,
  OidcSignupInfoResponse,
  OidcStartResponse,
  UpdateOidcProviderBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { rememberOidcVerifier } from '../../utils/oidc'
import { auth } from '../auth'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const fetchOidcProviders = async (): Promise<OidcPublicProvider[]> => {
  const response = await axios.get<OidcPublicProvidersResponse>(`${API_URL}/auth/oidc/providers`)
  return response.data.providers
}

/** The provider's sign-in URL, after keeping the verifier the return page will need. */
const authorizationUrl = (data: OidcStartResponse): string => {
  if (!data.authorization_url || !data.verifier) {
    throw new Error(data.error ?? 'The sign-in could not be started')
  }
  rememberOidcVerifier(data.verifier)
  return data.authorization_url
}

export const startOidcLogin = async (providerId: string, invitation?: string): Promise<string> => {
  const response = await axios.post<OidcStartResponse>(
    `${API_URL}/auth/oidc/${encodeURIComponent(providerId)}/start`,
    invitation ? { invitation } : {},
  )
  return authorizationUrl(response.data)
}

export const startOidcLink = async (providerId: string): Promise<string> => {
  const response = await axios.post<OidcStartResponse>(
    `${API_URL}/account/oidc/${encodeURIComponent(providerId)}/link/start`,
    {},
    { headers: authHeaders() },
  )
  return authorizationUrl(response.data)
}

export const exchangeOidcCode = async (code: string, verifier: string): Promise<OidcLoginResponse> => {
  const response = await axios.post<OidcLoginResponse>(`${API_URL}/auth/oidc/exchange`, { code, verifier })
  return response.data
}

export const completeOidcLink = async (code: string, verifier: string): Promise<BaseResponse> => {
  const response = await axios.post<BaseResponse>(
    `${API_URL}/account/oidc/link/complete`,
    { code, verifier },
    { headers: authHeaders() },
  )
  return response.data
}

export const fetchOidcSignupInfo = async (code: string): Promise<OidcSignupInfoResponse> => {
  const response = await axios.get<OidcSignupInfoResponse>(`${API_URL}/auth/oidc/signup-info`, {
    params: { code },
  })
  return response.data
}

export const oidcSignup = async (body: OidcSignupBody): Promise<OidcLoginResponse> => {
  const response = await axios.post<OidcLoginResponse>(`${API_URL}/auth/oidc/signup`, body)
  return response.data
}

export const fetchOidcLinks = async (): Promise<OidcLinksResponse> => {
  const response = await axios.get<OidcLinksResponse>(`${API_URL}/account/oidc/links`, {
    headers: authHeaders(),
  })
  return response.data
}

export const unlinkOidc = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/account/oidc/links/${encodeURIComponent(id)}`, { headers: authHeaders() })
}

export const fetchAdminOidcProviders = async (): Promise<OidcProvidersResponse> => {
  const response = await axios.get<OidcProvidersResponse>(`${API_URL}/admin/oidc-providers`, {
    headers: authHeaders(),
  })
  return response.data
}

export const addOidcProvider = async (body: AddOidcProviderBody): Promise<OidcProvider> => {
  const response = await axios.post<OidcProviderResponse>(`${API_URL}/admin/oidc-providers`, body, {
    headers: authHeaders(),
  })
  return response.data.provider
}

export const updateOidcProvider = async (id: string, body: UpdateOidcProviderBody): Promise<OidcProvider> => {
  const response = await axios.put<OidcProviderResponse>(
    `${API_URL}/admin/oidc-providers/${encodeURIComponent(id)}`,
    body,
    { headers: authHeaders() },
  )
  return response.data.provider
}

export const deleteOidcProvider = async (id: string, force = false): Promise<DeleteOidcProviderResponse> => {
  const response = await axios.delete<DeleteOidcProviderResponse>(
    `${API_URL}/admin/oidc-providers/${encodeURIComponent(id)}`,
    { headers: authHeaders(), params: force ? { force: 'true' } : {} },
  )
  return response.data
}
