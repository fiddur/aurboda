import { signal } from '@preact/signals'
import axios from 'axios'

const savedAuth = localStorage.getItem('auth')
export const auth = signal<{ user?: string; token?: string }>(savedAuth ? JSON.parse(savedAuth) : {})
auth.subscribe((value) => localStorage.setItem('auth', JSON.stringify(value)))

export const login = async (user: string, pass: string) => {
  try {
    const response = await axios.post<{ token: string }>('http://valhall/api/v2/login', {
      username: user,
      password: pass,
    })

    if (response.data.token) {
      auth.value = { user, token: response.data.token }
    }
  } catch (error) {
    console.error('Login error:', error)
  }
}

export const logout = () => (auth.value = {})
