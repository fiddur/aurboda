import { useLocation } from 'preact-iso'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { auth, ensureStatusLoaded, signup, signupMode } from '../../state/auth'

import './style.css'

// eslint-disable-next-line max-lines-per-function -- TODO: refactor
export function Signup() {
  const { route, query } = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Get invitation token from URL query param
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

  // Show different messages based on signup mode
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

  const onSubmit = async (e: Event) => {
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

      const result = await signup(formData.get('user') as string, password, invitation)

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
          />
          <p class="field-hint">
            3-31 characters, start with a letter, lowercase letters, numbers, and underscores only
          </p>
        </div>

        <div class="form-field">
          <label for="pass">Password</label>
          <input id="pass" name="pass" type="password" required autoComplete="new-password" />
        </div>

        <div class="form-field">
          <label for="confirmPass">Confirm Password</label>
          <input id="confirmPass" name="confirmPass" type="password" required autoComplete="new-password" />
        </div>

        {error && <p class="error">{error}</p>}

        <button type="submit" class="primary" disabled={loading}>
          {loading ? 'Creating account...' : 'Sign Up'}
        </button>
      </form>

      <p class="login-link">
        Already have an account? <a href="/login">Login</a>
      </p>
    </div>
  )
}
