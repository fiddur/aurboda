import { signal } from '@preact/signals'
import axios, { AxiosError } from 'axios'
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
