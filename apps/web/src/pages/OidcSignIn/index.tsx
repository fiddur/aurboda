import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import {
  apiErrorMessage,
  completeOidcLink,
  exchangeOidcCode,
  fetchOidcSignupInfo,
  oidcSignup,
} from '../../state/api'
import { auth } from '../../state/auth'
import { codeFromHash, takeOidcVerifier } from '../../utils/oidc'
import { apiErrorText } from '../../utils/profile'
import '../Login/style.css'
import '../Signup/style.css'

const signedIn = (data: { token?: string; is_admin?: boolean; username?: string }): boolean => {
  if (!data.token || !data.username) return false
  auth.value = { is_admin: data.is_admin, token: data.token, user: data.username }
  return true
}

/** Reads the code once and drops the fragment, so a reload or the back button does not reuse it. */
const useFragmentCode = (): string | null => {
  const [code] = useState(() => codeFromHash(window.location.hash))
  useEffect(() => {
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])
  return code
}

/** The verifier this browser kept when it started the sign-in; read once, as the page loads. */
const useVerifier = (): string | null => {
  const [verifier] = useState(() => takeOidcVerifier())
  return verifier
}

const notStartedHere = (page: string) =>
  `This sign-in was not started in this browser. Start again from the ${page} page.`

/** `/login/oidc#code=…`: where a provider login lands; trades the code for a session. */
export function LoginOidc() {
  const { route } = useLocation()
  const code = useFragmentCode()
  const verifier = useVerifier()
  const [error, setError] = useState<string | null>(
    !code ? 'This page needs the sign-in from your provider.' : !verifier ? notStartedHere('login') : null,
  )

  useEffect(() => {
    if (!code || !verifier) return
    exchangeOidcCode(code, verifier)
      .then((data) => {
        if (signedIn(data)) route('/', true)
        else setError(data.error ?? 'The sign-in did not succeed.')
      })
      .catch((err: unknown) => setError(apiErrorMessage(err, 'The sign-in did not succeed.')))
  }, [code])

  return (
    <div class="login-page">
      <h1>Signing in</h1>
      {error ? (
        <>
          <p class="oidc-error">{error}</p>
          <p class="signup-link">
            <a href="/login">Back to login</a>
          </p>
        </>
      ) : (
        <p class="signup-link">Signing you in…</p>
      )}
    </div>
  )
}

/** `/signup/oidc#code=…`: a new user from a provider picks a username. */
export function SignupOidc() {
  const { route } = useLocation()
  const code = useFragmentCode()
  const verifier = useVerifier()
  const [info, setInfo] = useState<{ provider: string; email: string } | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(
    !code ? 'This page needs the sign-up from your provider.' : !verifier ? notStartedHere('sign-up') : null,
  )
  const [expired, setExpired] = useState(!code || !verifier)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!code || !verifier) return
    fetchOidcSignupInfo(code)
      .then((data) => {
        setInfo({ email: data.email ?? '', provider: data.provider_display_name ?? '' })
        setUsername(data.suggested_username ?? '')
        setDisplayName(data.display_name ?? '')
      })
      .catch((err: unknown) => {
        setExpired(true)
        setError(apiErrorMessage(err, 'This sign-up has expired. Start again from the sign-up page.'))
      })
  }, [code])

  const onSubmit = async (e: Event) => {
    e.preventDefault()
    if (!code || !verifier) return
    setError(null)
    setSaving(true)
    try {
      const data = await oidcSignup({
        code,
        display_name: displayName.trim() || undefined,
        username: username.trim(),
        verifier,
      })
      if (signedIn(data)) {
        route('/', true)
        return
      }
      setError(data.error ?? 'Signup failed')
    } catch (err) {
      const body = (err as { response?: { data?: { error?: unknown } } }).response?.data
      setError(apiErrorText(body?.error, 'Signup failed'))
    }
    setSaving(false)
  }

  if (expired) {
    return (
      <div class="signup-page">
        <h1>Sign Up</h1>
        <p class="error">{error}</p>
        <p class="login-link">
          <a href="/signup">Back to sign up</a>
        </p>
      </div>
    )
  }

  if (!info) {
    return (
      <div class="signup-page">
        <h1>Sign Up</h1>
        <p class="not-available">Loading…</p>
      </div>
    )
  }

  return (
    <div class="signup-page">
      <h1>Sign Up</h1>
      <p class="invitation-notice">
        Signing up with {info.provider}
        {info.email && (
          <>
            {' '}
            as <strong>{info.email}</strong>
          </>
        )}
      </p>

      <form onSubmit={onSubmit} class="signup-form">
        <div class="form-field">
          <label for="user">Username</label>
          <input
            id="user"
            name="user"
            type="text"
            required
            autoComplete="username"
            pattern="^[a-z][a-z0-9_]{2,30}$"
            value={username}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
          />
          <p class="field-hint">
            3-31 characters, start with a letter, lowercase letters, numbers, and underscores only
          </p>
        </div>

        <div class="form-field">
          <label for="display-name">Display name (optional)</label>
          <input
            id="display-name"
            name="display-name"
            type="text"
            autoComplete="name"
            maxLength={100}
            value={displayName}
            onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
          />
          <p class="field-hint">Shown in the feed. You can change it later.</p>
        </div>

        {error && <p class="error">{error}</p>}

        <button type="submit" class="primary" disabled={saving || !username}>
          {saving ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p class="login-link">
        Already have an account? <a href="/login">Login</a>
      </p>
    </div>
  )
}

/** `/settings/oidc-link#code=…`: where a link flow lands; the signed-in account completes the link. */
export function LinkOidc() {
  const { route } = useLocation()
  const code = useFragmentCode()
  const verifier = useVerifier()
  const [error, setError] = useState<string | null>(
    !code ? 'This page needs the sign-in from your provider.' : !verifier ? notStartedHere('Settings') : null,
  )

  useEffect(() => {
    if (!code || !verifier) return
    completeOidcLink(code, verifier)
      .then(() => route('/settings?oidc=linked#sign-in-providers', true))
      .catch((err: unknown) => setError(apiErrorMessage(err, 'The provider could not be linked.')))
  }, [code])

  return (
    <div class="login-page">
      <h1>Linking a sign-in provider</h1>
      {error ? (
        <>
          <p class="oidc-error">{error}</p>
          <p class="signup-link">
            <a href="/settings#sign-in-providers">Back to Settings</a>
          </p>
        </>
      ) : (
        <p class="signup-link">Linking…</p>
      )}
    </div>
  )
}
