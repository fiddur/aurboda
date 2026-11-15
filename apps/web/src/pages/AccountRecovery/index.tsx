import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import {
  apiErrorMessage,
  completeAccountRecovery,
  requestAccountRecovery,
  verifyEmailToken,
} from '../../state/api'
import { auth, emailEnabled, ensureStatusLoaded, statusFailed } from '../../state/auth'
import { linkToken, newPasswordProblem, PASSKEY_RECOVERY_PATH } from '../../utils/accountRecovery'
import '../Login/style.css'
import './style.css'

const MissingToken = ({ title }: { title: string }) => (
  <div class="login-page recovery-page">
    <h1>{title}</h1>
    <p class="recovery-message">This page needs the link from the mail. Open the link from the mail again.</p>
  </div>
)

/** `/verify-email?token=…`: posts the token from the verification mail and shows the outcome. */
export function VerifyEmail() {
  const { query } = useLocation()
  const token = linkToken(query)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!token) return
    verifyEmailToken(token)
      .then(() => setOutcome({ message: 'Your email address is confirmed.', ok: true }))
      .catch((err: unknown) =>
        setOutcome({ message: apiErrorMessage(err, 'The address could not be confirmed.'), ok: false }),
      )
  }, [token])

  if (!token) return <MissingToken title="Confirm email" />

  return (
    <div class="login-page recovery-page">
      <h1>Confirm email</h1>
      {outcome === null ? (
        <p class="recovery-message">Confirming…</p>
      ) : (
        <>
          <p class={outcome.ok ? 'recovery-message' : 'recovery-message error'}>{outcome.message}</p>
          {!outcome.ok && (
            <p class="recovery-message">
              Ask for a new link under Email in <a href="/settings">Settings</a>.
            </p>
          )}
          {outcome.ok && (
            <p class="signup-link">
              <a href={auth.value.token ? '/settings' : '/login'}>
                {auth.value.token ? 'Back to Settings' : 'Sign in'}
              </a>
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** `/recover-request`: asks for a password reset or passkey recovery link by username or email. */
export function RecoverRequest() {
  const [identifier, setIdentifier] = useState('')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  const onSubmit = async (e: Event) => {
    e.preventDefault()
    setError(null)
    setSending(true)
    try {
      setMessage((await requestAccountRecovery(identifier.trim())).message)
    } catch (err) {
      setError(apiErrorMessage(err, 'The request could not be sent. Try again later.'))
    }
    setSending(false)
  }

  if (!emailEnabled.value && !statusFailed.value) {
    return (
      <div class="login-page recovery-page">
        <h1>Recover your account</h1>
        <p class="recovery-message">
          This server does not send email, so a lost password or passkey cannot be recovered here. Ask the
          server admin for help.
        </p>
      </div>
    )
  }

  return (
    <div class="login-page recovery-page">
      <h1>Recover your account</h1>
      {message ? (
        <p class="recovery-message">{message}</p>
      ) : (
        <form class="login-form" onSubmit={onSubmit}>
          <p class="recovery-message">
            Enter your username or your email address. If the account has a confirmed email address, a link is
            sent to it: with it you can set a new password, or sign in and add a new passkey.
          </p>
          <div class="form-field">
            <label for="identifier">Username or email</label>
            <input
              id="identifier"
              type="text"
              required
              maxLength={254}
              autoComplete="username"
              value={identifier}
              onInput={(e) => setIdentifier((e.target as HTMLInputElement).value)}
            />
          </div>
          {error && <p class="error">{error}</p>}
          <button type="submit" class="primary" disabled={sending || !identifier.trim()}>
            {sending ? 'Sending…' : 'Send me a link'}
          </button>
        </form>
      )}
      <p class="signup-link">
        <a href="/login">Back to sign in</a>
      </p>
    </div>
  )
}

/** `/recover?token=…`: set a new password, or sign in without one to add a new passkey. */
export function Recover() {
  const { query, route } = useLocation()
  const token = linkToken(query)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState<'password' | 'passkey' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!token) return <MissingToken title="Recover your account" />

  const complete = async (newPassword: string | undefined, next: string) => {
    setError(null)
    setBusy(newPassword === undefined ? 'passkey' : 'password')
    try {
      const result = await completeAccountRecovery({ new_password: newPassword, token })
      auth.value = { is_admin: result.is_admin, token: result.token, user: result.username }
      route(next)
    } catch (err) {
      setError(apiErrorMessage(err, 'The account could not be recovered.'))
      setBusy(null)
    }
  }

  const onSetPassword = (e: Event) => {
    e.preventDefault()
    const problem = newPasswordProblem(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    void complete(password, '/')
  }

  return (
    <div class="login-page recovery-page">
      <h1>Recover your account</h1>
      <p class="recovery-message">
        The link works once. Choose one: set a new password, or sign in now and add a new passkey.
      </p>

      <form class="login-form" onSubmit={onSetPassword}>
        <h2>Set a new password</h2>
        <div class="form-field">
          <label for="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-field">
          <label for="confirm-password">New password again</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
          />
        </div>
        <button type="submit" class="primary" disabled={busy !== null}>
          {busy === 'password' ? 'Saving…' : 'Set the password and sign in'}
        </button>
      </form>

      <div class="login-form">
        <h2>Lost your passkey?</h2>
        <p class="recovery-message">
          Sign in without changing the password, then add a new passkey in Settings.
        </p>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void complete(undefined, PASSKEY_RECOVERY_PATH)}
        >
          {busy === 'passkey' ? 'Signing in…' : 'Sign in and add a new passkey'}
        </button>
      </div>

      {error && <p class="error recovery-message">{error}</p>}
    </div>
  )
}
