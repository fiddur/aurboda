import { useLocation } from 'preact-iso'
import { useEffect, useMemo, useState } from 'preact/hooks'

import { auth, ensureStatusLoaded, signup, signupMode, signupWithPasskey } from '../../state/auth'
import './style.css'

export function Signup() {
  const { route, query } = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [usePassword, setUsePassword] = useState(false)
  const [username, setUsername] = useState('')

  const invitation = useMemo(() => {
    const params = new URLSearchParams(query)
    return params.get('invite') ?? undefined
  }, [query])

  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  if (auth.value.token) {
    route('/')
    return null
  }

  if (signupMode.value === 'closed') {
    return (
      <div class="signup-page">
        <h1>Sign Up</h1>
        <p class="not-available">Signup is currently closed on this server.</p>
        <p class="login-link">
          Already have an account? <a href="/login">Login</a>
        </p>
      </div>
    )
  }

  if (signupMode.value === 'invite_only' && !invitation) {
    return (
      <div class="signup-page">
        <h1>Sign Up</h1>
        <p class="not-available">
          This server requires an invitation to sign up. Please ask an administrator for an invitation link.
        </p>
        <p class="login-link">
          Already have an account? <a href="/login">Login</a>
        </p>
      </div>
    )
  }

  const onPasskeySignup = async () => {
    setError(null)
    if (!username) {
      setError('Please enter a username')
      return
    }
    setPasskeyLoading(true)
    const result = await signupWithPasskey(username, invitation)
    setPasskeyLoading(false)
    if (result.success) {
      route('/')
    } else {
      setError(result.error ?? 'Signup failed')
    }
  }

  const onPasswordSubmit = async (e: Event) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (e.currentTarget instanceof HTMLFormElement) {
      const formData = new FormData(e.currentTarget)
      const password = formData.get('pass') as string
      const confirmPassword = formData.get('confirmPass') as string

      if (password !== confirmPassword) {
        setError('Passwords do not match')
        setLoading(false)
        return
      }

      const result = await signup(username, password, invitation)
      if (result.success) {
        route('/')
      } else {
        setError(result.error ?? 'Signup failed')
      }
    }
    setLoading(false)
  }

  return (
    <div class="signup-page">
      <h1>Sign Up</h1>

      {invitation && <p class="invitation-notice">You have been invited to create an account.</p>}

      <div class="form-field">
        <label for="user">Username</label>
        <input
          id="user"
          name="user"
          type="text"
          required
          autoComplete="username webauthn"
          pattern="^[a-z][a-z0-9_]{2,30}$"
          value={username}
          onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
        />
        <p class="field-hint">
          3-31 characters, start with a letter, lowercase letters, numbers, and underscores only
        </p>
      </div>

      {!usePassword ? (
        <>
          <button
            type="button"
            class="primary"
            disabled={passkeyLoading || !username}
            onClick={onPasskeySignup}
          >
            {passkeyLoading ? 'Waiting for passkey…' : 'Sign up with passkey'}
          </button>

          {error && <p class="error">{error}</p>}

          <p class="alt-mode-link">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setUsePassword(true)
                setError(null)
              }}
            >
              Use a password instead
            </a>
          </p>
        </>
      ) : (
        <form onSubmit={onPasswordSubmit} class="signup-form">
          <div class="form-field">
            <label for="pass">Password</label>
            <input id="pass" name="pass" type="password" required autoComplete="new-password" />
          </div>

          <div class="form-field">
            <label for="confirmPass">Confirm Password</label>
            <input id="confirmPass" name="confirmPass" type="password" required autoComplete="new-password" />
          </div>

          {error && <p class="error">{error}</p>}

          <button type="submit" class="primary" disabled={loading || !username}>
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>

          <p class="alt-mode-link">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setUsePassword(false)
                setError(null)
              }}
            >
              Sign up with a passkey instead
            </a>
          </p>
        </form>
      )}

      <p class="login-link">
        Already have an account? <a href="/login">Login</a>
      </p>
    </div>
  )
}
