import type { GarminOAuthStatus } from '@aurboda/api-spec'

import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { completeGarminOAuth, disconnectGarminOAuth, getGarminOAuthConnectUrl } from '../../state/api'
import {
  garminLastReceivedText,
  garminOAuthReturn,
  garminPermissionLabel,
  oauthErrorText,
  withoutGarminOAuthReturn,
} from './garminConnection'

const callbackErrorCode = (): string | null =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('error')

/** Finishes a Connect with Garmin sign-in the callback handed to this page, once. */
function useGarminOAuthCompletion(
  onChanged: () => Promise<void>,
  setError: (error: string | null) => void,
): boolean {
  const [finishing, setFinishing] = useState(false)
  const finishStarted = useRef(false)

  useEffect(() => {
    if (finishStarted.current) return
    const handedOver = garminOAuthReturn(window.location.search)
    if (!handedOver) return
    finishStarted.current = true
    setFinishing(true)
    setError(null)
    // A code works once: drop it from the address before anything can fail, so a reload does not replay it.
    const { hash, pathname, search } = window.location
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${withoutGarminOAuthReturn(search)}${hash}`,
    )
    void (async () => {
      try {
        const answer = await completeGarminOAuth(handedOver.code, handedOver.state)
        if (answer.success) await onChanged()
        else setError(answer.error ?? oauthErrorText('auth_failed'))
      } catch (err) {
        setError(err instanceof Error ? err.message : oauthErrorText('auth_failed'))
      } finally {
        setFinishing(false)
      }
    })()
  }, [onChanged])

  return finishing
}

const StatusLines = ({ error, finishing }: { error: string | null; finishing: boolean }) => (
  <>
    {finishing && <p class="field-description">Finishing the Garmin connection…</p>}
    {error && <p class="garmin-login-error">{error}</p>}
  </>
)

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
  const [error, setError] = useState<string | null>(() => oauthErrorText(callbackErrorCode()))
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const finishing = useGarminOAuthCompletion(onChanged, setError)

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
        <StatusLines error={error} finishing={finishing} />
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
      <StatusLines error={error} finishing={finishing} />
    </section>
  )
}
