import type { GarminOAuthStatus } from '@aurboda/api-spec'

import { useCallback, useState } from 'preact/hooks'

import { disconnectGarminOAuth, getGarminOAuthConnectUrl } from '../../state/api'
import { garminLastReceivedText, garminPermissionLabel, oauthErrorText } from './garminConnection'

const callbackErrorCode = (): string | null =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('error')

export function GarminOAuth({
  status,
  onChanged,
}: {
  status: GarminOAuthStatus
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(() => oauthErrorText(callbackErrorCode()))
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      window.location.href = await getGarminOAuthConnectUrl()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the Garmin connection')
      setConnecting(false)
    }
  }, [])

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true)
    setError(null)
    try {
      await disconnectGarminOAuth()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }, [onChanged])

  if (!status.available && !status.connected) return null

  const connectButton = (
    <button
      type="button"
      class="connect-button"
      disabled={!status.available || connecting}
      onClick={handleConnect}
    >
      {connecting ? 'Connecting...' : 'Connect with Garmin'}
    </button>
  )

  const disconnectButton = (
    <button
      type="button"
      class="connect-button disconnect-button"
      disabled={disconnecting}
      onClick={handleDisconnect}
    >
      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
    </button>
  )

  return (
    <section class="settings-section">
      <h2>Connect with Garmin</h2>
      {status.connected && status.needs_reconnect ? (
        <div class="garmin-connected-actions">
          <p class="garmin-login-error">Garmin no longer accepts this connection. Connect again.</p>
          <div class="garmin-button-row">
            {connectButton}
            {disconnectButton}
          </div>
        </div>
      ) : status.connected ? (
        <div class="garmin-connected-actions">
          <p class="connected-status">Connected</p>
          <p class="field-description">
            {status.permissions.length > 0
              ? `You share: ${status.permissions.map(garminPermissionLabel).join(', ')}`
              : 'Garmin reported no shared data. Change what you share in your Garmin Connect account, under connected apps.'}
          </p>
          <p class="field-description">{garminLastReceivedText(status.last_received_at)}</p>
          <div class="garmin-button-row">{disconnectButton}</div>
        </div>
      ) : (
        <>
          {connectButton}
          <p class="field-description">
            You sign in at Garmin and choose what to share. Garmin then sends new data to Aurboda each time
            your device syncs with Garmin Connect. Aurboda never sees your password. Data from before you
            connect is not included; add the login or a Personal API key below for history.
          </p>
        </>
      )}
      {error && <p class="garmin-login-error">{error}</p>}
    </section>
  )
}
