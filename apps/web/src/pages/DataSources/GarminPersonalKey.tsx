import type { GarminPersonalKeyStatus } from '@aurboda/api-spec'

import { useCallback, useState } from 'preact/hooks'

import { connectGarminPersonalKey, disconnectGarminPersonalKey } from '../../state/api'
import {
  addDaysToIsoDate,
  connectErrorText,
  KEY_EXPIRY_CHOICES,
  keyExpiryState,
  localIsoDate,
} from './garminConnection'

const CREATE_KEY_URL = 'https://connect.garmin.com/app/settings/personalApiToken'

function GarminPersonalKeyForm({ onCancel, onSuccess }: { onCancel?: () => void; onSuccess: () => void }) {
  const today = localIsoDate(new Date())
  const [apiKey, setApiKey] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault()
      if (!apiKey.trim() || !expiresAt) return

      setLoading(true)
      setError('')
      try {
        const result = await connectGarminPersonalKey(apiKey.trim(), expiresAt)
        if (result.success) {
          setApiKey('')
          onSuccess()
        } else {
          setError(connectErrorText(result.error))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connecting the key failed')
      } finally {
        setLoading(false)
      }
    },
    [apiKey, expiresAt, onSuccess],
  )

  return (
    <form class="garmin-login-form" onSubmit={handleSubmit}>
      <p class="field-description">
        <a href={CREATE_KEY_URL} target="_blank" rel="noopener noreferrer">
          Create a key in Garmin Connect
        </a>
        , choose how long it lasts (a year at most), and paste it here.
      </p>
      <div class="form-field">
        <label for="garmin-personal-key">Personal API key</label>
        <input
          id="garmin-personal-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
          required
          disabled={loading}
        />
      </div>
      <div class="form-field">
        <label for="garmin-personal-key-expiry">Expires</label>
        <div class="garmin-expiry-choices">
          {KEY_EXPIRY_CHOICES.map((choice) => (
            <button
              key={choice.days}
              type="button"
              disabled={loading}
              onClick={() => setExpiresAt(addDaysToIsoDate(today, choice.days))}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <input
          id="garmin-personal-key-expiry"
          type="date"
          min={today}
          value={expiresAt}
          onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
          required
          disabled={loading}
        />
      </div>
      <div class="garmin-button-row">
        <button type="submit" class="connect-button" disabled={loading || !apiKey.trim() || !expiresAt}>
          {loading ? 'Connecting...' : 'Connect key'}
        </button>
        {onCancel && (
          <button type="button" class="connect-button disconnect-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <p class="field-description">
        Garmin's terms restrict a Personal API key to tools you run for your own use. On a shared server you
        are sharing the key with its operator.
      </p>
      {error && <p class="garmin-login-error">{error}</p>}
    </form>
  )
}

function GarminPersonalKeyStatusView({
  status,
  onReplace,
  onDisconnected,
}: {
  status: GarminPersonalKeyStatus
  onReplace?: () => void
  onDisconnected: () => Promise<void>
}) {
  const [disconnecting, setDisconnecting] = useState(false)
  const state = keyExpiryState(status, localIsoDate(new Date()))

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true)
    try {
      await disconnectGarminPersonalKey()
      await onDisconnected()
    } catch {
      // The user can try again
    } finally {
      setDisconnecting(false)
    }
  }, [onDisconnected])

  return (
    <div class="garmin-connected-actions">
      {!status.refused && <p class="connected-status">Connected</p>}
      {status.refused ? (
        <p class="garmin-login-error">Garmin refused this key. Create a new one and paste it here.</p>
      ) : (
        status.expires_at && (
          <p
            class={
              state === 'error'
                ? 'garmin-login-error'
                : state === 'warning'
                  ? 'field-description warning'
                  : 'field-description'
            }
          >
            Key expires {status.expires_at}
          </p>
        )
      )}
      <div class="garmin-button-row">
        {onReplace && (
          <button type="button" class="connect-button" onClick={onReplace}>
            Replace key
          </button>
        )}
        <button
          type="button"
          class="connect-button disconnect-button"
          disabled={disconnecting}
          onClick={handleDisconnect}
        >
          {disconnecting ? 'Disconnecting...' : 'Disconnect key'}
        </button>
      </div>
    </div>
  )
}

export function GarminPersonalKey({
  status,
  onChanged,
}: {
  status: GarminPersonalKeyStatus
  onChanged: () => Promise<void>
}) {
  const [replacing, setReplacing] = useState(false)

  const handleSuccess = useCallback(async () => {
    setReplacing(false)
    await onChanged()
  }, [onChanged])

  if (!status.available && !status.connected) return null

  return (
    <section class="settings-section">
      <h2>Personal API key</h2>
      <p class="field-description">
        Garmin's official Personal API. It serves daily summary, heart rate, HRV, sleep, Body Battery, SpO2,
        respiration, intensity minutes and activities; stress, training readiness, the sleep stage timeline
        and per-activity detail still need the login above.
      </p>
      {status.connected && !replacing ? (
        <GarminPersonalKeyStatusView
          status={status}
          onReplace={status.available ? () => setReplacing(true) : undefined}
          onDisconnected={onChanged}
        />
      ) : status.available ? (
        <GarminPersonalKeyForm
          onCancel={status.connected ? () => setReplacing(false) : undefined}
          onSuccess={handleSuccess}
        />
      ) : (
        <p class="field-description">Connecting a new key is turned off on this server.</p>
      )}
    </section>
  )
}
