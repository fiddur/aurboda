import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import { auth, ensureStatusLoaded, login, loginWithPasskey, signupAllowed } from '../../state/auth'
import './style.css'

export function Login() {
  const { route } = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)

  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  if (auth.value.token) {
    route('/')
    return null
  }

  const onSubmit = async (e: Event) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (e.currentTarget instanceof HTMLFormElement) {
      const formData = new FormData(e.currentTarget)
      const result = await login(formData.get('user') as string, formData.get('pass') as string)

      if (result.success) {
        route('/')
      } else {
        setError(result.error ?? 'Login failed')
      }
    }
    setLoading(false)
  }

  const onPasskey = async () => {
    setError(null)
    setPasskeyLoading(true)
    const result = await loginWithPasskey()
    if (result.success) {
      route('/')
    } else {
      setError(result.error ?? 'Passkey login failed')
    }
    setPasskeyLoading(false)
  }

  return (
    <div class="login-page">
      <h1>Login</h1>

      <button type="button" class="primary" onClick={onPasskey} disabled={passkeyLoading || loading}>
        {passkeyLoading ? 'Waiting for passkey…' : 'Sign in with passkey'}
      </button>

      <form onSubmit={onSubmit} class="login-form">
        <div class="form-field">
          <label for="user">Username</label>
          <input id="user" name="user" type="text" required autoComplete="username webauthn" />
        </div>

        <div class="form-field">
          <label for="pass">Password</label>
          <input id="pass" name="pass" type="password" required autoComplete="current-password webauthn" />
        </div>

        {error && <p class="error">{error}</p>}

        <button type="submit" class="primary" disabled={loading || passkeyLoading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>

      {signupAllowed.value && (
        <p class="signup-link">
          Don't have an account? <a href="/signup">Sign up</a>
        </p>
      )}
    </div>
  )
}
