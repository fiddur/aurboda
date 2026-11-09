import { useLocation } from 'preact-iso'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import {
  auth,
  ensureStatusLoaded,
  serverBilling,
  signup,
  type SignupMode,
  signupMode,
  signupWithPasskey,
  statusFailed,
} from '../../state/auth'
import { signupBillingLine } from '../../utils/plan'
import { signupProfileFields } from '../../utils/profile'
import './style.css'

/** Why this visitor cannot sign up here, or null when the form applies (also while the status loads). */
const signupUnavailableReason = (
  mode: SignupMode | undefined,
  failed: boolean,
  invitation: string | undefined,
): string | null => {
  if (mode === undefined) return failed ? "Couldn't reach the server, try again." : null
  if (mode === 'closed') return 'Signup is currently closed on this server.'
  if (mode === 'invite_only' && !invitation) {
    return 'This server requires an invitation to sign up. Please ask an administrator for an invitation link.'
  }
  return null
}

export function Signup() {
  const { route, query } = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [usePassword, setUsePassword] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const emailInput = useRef<HTMLInputElement>(null)

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

  const billingLine = signupBillingLine(serverBilling.value)

  const unavailable = signupUnavailableReason(signupMode.value, statusFailed.value, invitation)
  if (unavailable) {
    return (
      <div class="signup-page">
        <h1>Sign Up</h1>
        <p class="not-available">{unavailable}</p>
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
    // The email field sits outside any form, so nothing checks it before the passkey prompt; a bad
    // one would be refused only after a passkey was already made for the account.
    if (emailInput.current && !emailInput.current.reportValidity()) return
    setPasskeyLoading(true)
    const result = await signupWithPasskey(username, invitation, signupProfileFields({ displayName, email }))
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
    if (emailInput.current && !emailInput.current.reportValidity()) return
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

      const result = await signup(username, password, invitation, signupProfileFields({ displayName, email }))
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
      {billingLine && <p class="billing-notice">{billingLine}</p>}

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

      <div class="form-field">
        <label for="email">Email (optional)</label>
        <input
          ref={emailInput}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
        <p class="field-hint">Private: only you and the server's admins see it.</p>
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
