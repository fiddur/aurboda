import type { GarminOAuthStatus } from '@aurboda/api-spec'

import { useCallback, useState } from 'preact/hooks'

import { completeOAuth, disconnectGarminOAuth, getGarminOAuthConnectUrl } from '../../state/api'
import { garminLastReceivedText, garminPermissionLabel } from './garminConnection'
import { callbackErrorText, useOAuthCompletion } from './oauthReturn'
import { OAuthFinishLines } from './shared'

const completeGarmin = (code: string, state: string) => completeOAuth('garmin', code, state)

const NotConnectedText = ({ hasLogin }: { hasLogin: boolean }) => (
  <>
    <p class="field-description">
      You sign in at Garmin and choose what to share. Garmin then sends new data to Aurboda each time your
      watch syncs with Garmin Connect. Aurboda never sees your password.
    </p>
    <p class="field-description">
      Not included: data from before you connect, training readiness and strength sets.
      {hasLogin ? ' Your Garmin login below keeps adding those.' : ' Add the Garmin login below for those.'}
    </p>
  </>
)

const ConnectedLines = ({ status, hasLogin }: { status: GarminOAuthStatus; hasLogin: boolean }) => (
  <>
    <p class="connected-status">Connected</p>
    <p class="field-description">
      {status.permissions.length > 0
        ? `You share: ${status.permissions.map(garminPermissionLabel).join(', ')}`
        : status.last_received_at
          ? 'Garmin has not told Aurboda what you share, but your data is arriving.'
          : 'Garmin reported no shared data. Change what you share in your Garmin Connect account, under connected apps.'}
    </p>
    <p class="field-description">{garminLastReceivedText(status.last_received_at)}</p>
    {!hasLogin && (
      <p class="field-description">
        Not included: data from before you connected, training readiness and strength sets. Add the Garmin
        login below for those.
      </p>
    )}
  </>
)

export function GarminOAuth({
  status,
  onChanged,
  hasLogin = false,
}: {
  status: GarminOAuthStatus
  onChanged: () => Promise<void>
  hasLogin?: boolean
}) {
  const [error, setError] = useState<string | null>(() => callbackErrorText('Garmin'))
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const finishing = useOAuthCompletion({
    complete: completeGarmin,
    onChanged,
    provider: 'garmin',
    providerName: 'Garmin',
    setError,
  })

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

  if (!status.available && !status.connected) {
    if (!finishing && !error) return null
    return (
      <section class="settings-section">
        <h2>Connect with Garmin</h2>
        <OAuthFinishLines error={error} finishing={finishing} providerName="Garmin" />
      </section>
    )
  }

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
      <h2>
        Connect with Garmin
        {!status.connected && <span class="garmin-recommended">Recommended</span>}
      </h2>
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
          <ConnectedLines status={status} hasLogin={hasLogin} />
          <div class="garmin-button-row">{disconnectButton}</div>
        </div>
      ) : (
        <>
          {connectButton}
          <NotConnectedText hasLogin={hasLogin} />
        </>
      )}
      <OAuthFinishLines error={error} finishing={finishing} providerName="Garmin" />
    </section>
  )
}
