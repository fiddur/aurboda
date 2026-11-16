import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import { OidcButtons } from '../../components/OidcButtons'
import { fetchOidcProviders, startOidcLogin } from '../../state/api'
import {
  auth,
  emailEnabled,
  ensureStatusLoaded,
  login,
  loginWithPasskey,
  signupAllowed,
} from '../../state/auth'
import { oidcErrorMessage } from '../../utils/oidc'
import './style.css'

export function Login() {
  const { route, query } = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const { data: providers = [] } = useQuery({
    queryFn: fetchOidcProviders,
    queryKey: ['oidcProviders'],
    retry: false,
  })
  const oidcError = oidcErrorMessage(typeof query.oidc_error === 'string' ? query.oidc_error : undefined)

  // Where to go after login. Only allow internal paths (no open redirect).
  const next =
    typeof query.next === 'string' && query.next.startsWith('/') && !query.next.startsWith('//')
      ? query.next
      : '/'

  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  if (auth.value.token) {
    route(next)
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
        route(next)
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
      route(next)
    } else {
      setError(result.error ?? 'Passkey login failed')
    }
    setPasskeyLoading(false)
  }

  return (
    <div class="login-page">
      <h1>Login</h1>

      {oidcError && <p class="error oidc-error">{oidcError}</p>}

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

      <OidcButtons providers={providers} start={(id) => startOidcLogin(id)} />

      {emailEnabled.value && (
        <p class="signup-link">
          <a href="/recover-request">Forgot your password or lost your passkey?</a>
        </p>
      )}

      {signupAllowed.value && (
        <p class="signup-link">
          Don't have an account? <a href="/signup">Sign up</a>
        </p>
      )}
    </div>
  )
}
