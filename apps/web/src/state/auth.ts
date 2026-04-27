import type { AxiosError } from 'axios'

import { signal } from '@preact/signals'
import axios from 'axios'

import { API_URL } from '../config'

export type SignupMode = 'open' | 'invite_only' | 'closed'

const savedAuth = localStorage.getItem('auth')
export const auth = signal<{ user?: string; token?: string; is_admin?: boolean }>(
  savedAuth ? JSON.parse(savedAuth) : {},
)
auth.subscribe((value) => localStorage.setItem('auth', JSON.stringify(value)))

// Keep signupAllowed for backwards compatibility
export const signupAllowed = signal<boolean | undefined>(undefined)
export const signupMode = signal<SignupMode | undefined>(undefined)

let statusFetchPromise: Promise<void> | null = null

export const fetchStatus = async () => {
  if (signupMode.value !== undefined) return
  if (statusFetchPromise) return statusFetchPromise

  statusFetchPromise = (async () => {
    try {
      const response = await axios.get<{ signup_allowed: boolean; signup_mode: SignupMode }>(
        `${API_URL}/status`,
      )
      signupAllowed.value = response.data.signup_allowed
      signupMode.value = response.data.signup_mode
    } catch (error) {
      console.error('Status fetch error:', error)
      signupAllowed.value = false
      signupMode.value = 'closed'
    }
  })()

  return statusFetchPromise
}

export const ensureStatusLoaded = () => fetchStatus()

export const login = async (user: string, pass: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await axios.post<{ token: string; is_admin?: boolean }>(`${API_URL}/login`, {
      password: pass,
      username: user,
    })

    if (response.data.token) {
      auth.value = { is_admin: response.data.is_admin, token: response.data.token, user }
      return { success: true }
    }
    return { error: 'No token received', success: false }
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: string }>
    const message = axiosError.response?.data?.error ?? 'Login failed'
    console.error('Login error:', error)
    return { error: message, success: false }
  }
}

export const signup = async (
  user: string,
  pass: string,
  invitation?: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await axios.post<{ token: string; is_admin?: boolean }>(`${API_URL}/signup`, {
      invitation,
      password: pass,
      username: user,
    })

    if (response.data.token) {
      auth.value = { is_admin: response.data.is_admin, token: response.data.token, user }
      return { success: true }
    }
    return { error: 'No token received', success: false }
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: string }>
    const message = axiosError.response?.data?.error ?? 'Signup failed'
    console.error('Signup error:', error)
    return { error: message, success: false }
  }
}

export const logout = () => (auth.value = {})

export const signupWithPasskey = async (
  user: string,
  invitation?: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { startRegistration } = await import('@simplewebauthn/browser')

    const optionsResp = await axios.post<{ options_json: string; success: boolean; error?: string }>(
      `${API_URL}/webauthn/signup/options`,
      { invitation, username: user },
    )
    const optionsJSON = JSON.parse(optionsResp.data.options_json) as Parameters<
      typeof startRegistration
    >[0]['optionsJSON']
    const attestation = await startRegistration({ optionsJSON })

    const verifyResp = await axios.post<{
      token?: string
      is_admin?: boolean
      username?: string
      verified: boolean
      error?: string
    }>(`${API_URL}/webauthn/signup/verify`, {
      response_json: JSON.stringify(attestation),
      username: user,
    })

    if (verifyResp.data.verified && verifyResp.data.token && verifyResp.data.username) {
      auth.value = {
        is_admin: verifyResp.data.is_admin,
        token: verifyResp.data.token,
        user: verifyResp.data.username,
      }
      return { success: true }
    }
    return { error: verifyResp.data.error ?? 'Signup failed', success: false }
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: string }>
    const message = axiosError.response?.data?.error ?? (error as Error).message ?? 'Passkey signup failed'
    console.error('Passkey signup error:', error)
    return { error: message, success: false }
  }
}

export const loginWithPasskey = async (): Promise<{ success: boolean; error?: string }> => {
  try {
    // Lazy-import to keep the WebAuthn dep out of the bundle for users who never use passkeys.
    const { startAuthentication } = await import('@simplewebauthn/browser')

    const optionsResp = await axios.post<{ options_json: string; success: boolean; error?: string }>(
      `${API_URL}/webauthn/auth/options`,
      {},
    )
    const optionsJSON = JSON.parse(optionsResp.data.options_json) as Parameters<
      typeof startAuthentication
    >[0]['optionsJSON']
    const assertion = await startAuthentication({ optionsJSON })

    const verifyResp = await axios.post<{
      token?: string
      is_admin?: boolean
      username?: string
      verified: boolean
      error?: string
    }>(`${API_URL}/webauthn/auth/verify`, { response_json: JSON.stringify(assertion) })

    if (verifyResp.data.verified && verifyResp.data.token && verifyResp.data.username) {
      auth.value = {
        is_admin: verifyResp.data.is_admin,
        token: verifyResp.data.token,
        user: verifyResp.data.username,
      }
      return { success: true }
    }
    return { error: verifyResp.data.error ?? 'Verification failed', success: false }
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: string }>
    const message = axiosError.response?.data?.error ?? (error as Error).message ?? 'Passkey login failed'
    console.error('Passkey login error:', error)
    return { error: message, success: false }
  }
}
