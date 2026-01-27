import { signal } from '@preact/signals'
import axios, { AxiosError } from 'axios'
import { API_URL } from '../config'

const savedAuth = localStorage.getItem('auth')
export const auth = signal<{ user?: string; token?: string }>(savedAuth ? JSON.parse(savedAuth) : {})
auth.subscribe((value) => localStorage.setItem('auth', JSON.stringify(value)))

export const signupAllowed = signal<boolean | undefined>(undefined)

let statusFetchPromise: Promise<void> | null = null

export const fetchStatus = async () => {
  if (signupAllowed.value !== undefined) return
  if (statusFetchPromise) return statusFetchPromise

  statusFetchPromise = (async () => {
    try {
      const response = await axios.get<{ signupAllowed: boolean }>(`${API_URL}/status`)
      signupAllowed.value = response.data.signupAllowed
    } catch (error) {
      console.error('Status fetch error:', error)
      signupAllowed.value = false
    }
  })()

  return statusFetchPromise
}

export const ensureStatusLoaded = () => fetchStatus()

export const login = async (user: string, pass: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await axios.post<{ token: string }>(`${API_URL}/login`, {
      password: pass,
      username: user,
    })

    if (response.data.token) {
      auth.value = { token: response.data.token, user }
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

export const signup = async (user: string, pass: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await axios.post<{ token: string }>(`${API_URL}/signup`, {
      password: pass,
      username: user,
    })

    if (response.data.token) {
      auth.value = { token: response.data.token, user }
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
