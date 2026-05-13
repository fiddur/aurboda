import type { WebAuthnCredential } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const listPasskeys = async (): Promise<WebAuthnCredential[]> => {
  const response = await axios.get<{ credentials: WebAuthnCredential[] }>(`${API_URL}/webauthn/credentials`, {
    headers: authHeaders(),
  })
  return response.data.credentials
}

export const registerPasskey = async (
  nickname?: string,
): Promise<{ verified: boolean; credentialId?: string; error?: string }> => {
  const { startRegistration } = await import('@simplewebauthn/browser')

  try {
    const optionsResp = await axios.post<{ options_json: string }>(
      `${API_URL}/webauthn/register/options`,
      {},
      { headers: authHeaders() },
    )
    const optionsJSON = JSON.parse(optionsResp.data.options_json) as Parameters<
      typeof startRegistration
    >[0]['optionsJSON']
    const attestation = await startRegistration({ optionsJSON })

    const verifyResp = await axios.post<{
      verified: boolean
      credential_id?: string
      error?: string
    }>(
      `${API_URL}/webauthn/register/verify`,
      { nickname, response_json: JSON.stringify(attestation) },
      { headers: authHeaders() },
    )
    return {
      credentialId: verifyResp.data.credential_id,
      error: verifyResp.data.error,
      verified: verifyResp.data.verified,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed'
    return { error: message, verified: false }
  }
}

export const renamePasskey = async (credentialId: string, nickname: string): Promise<void> => {
  await axios.patch(
    `${API_URL}/webauthn/credentials/${encodeURIComponent(credentialId)}`,
    { nickname },
    { headers: authHeaders() },
  )
}

export const deletePasskey = async (credentialId: string): Promise<void> => {
  await axios.delete(`${API_URL}/webauthn/credentials/${encodeURIComponent(credentialId)}`, {
    headers: authHeaders(),
  })
}
