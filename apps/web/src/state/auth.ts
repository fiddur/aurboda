import { signal } from '@preact/signals'
import axios from 'axios'
import { API_URL } from '../config'

const savedAuth = localStorage.getItem('auth')
export const auth = signal<{ user?: string; token?: string }>(savedAuth ? JSON.parse(savedAuth) : {})
auth.subscribe((value) => localStorage.setItem('auth', JSON.stringify(value)))

export const login = async (user: string, pass: string) => {
  try {
    const response = await axios.post<{ token: string }>(`${API_URL}/api/login`, {
      password: pass,
      username: user,
    })

    if (response.data.token) {
      auth.value = { token: response.data.token, user }
    }
  } catch (error) {
    console.error('Login error:', error)
  }
}

export const logout = () => (auth.value = {})
