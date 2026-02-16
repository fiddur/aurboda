import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'
import {
  fetchAdminSettings,
  generateInvitation,
  InvitationResult,
  SignupMode,
  updateAdminSettings,
} from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

type SaveStatus = { status: 'idle' | 'saving' | 'saved' | 'error'; time?: Date; error?: string }

const formatSavedTime = (time: Date): string => {
  const now = new Date()
  const diffSec = Math.floor((now.getTime() - time.getTime()) / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec} seconds ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`
  return time.toLocaleTimeString()
}

const formatExpiryTime = (expiresAt: Date): string => {
  const now = new Date()
  const diffMs = expiresAt.getTime() - now.getTime()
  if (diffMs <= 0) return 'expired'

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ${hours}h`
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes} minute${minutes > 1 ? 's' : ''}`
}

function SaveStatusIndicator({ saveStatus }: { saveStatus: SaveStatus }) {
  if (saveStatus.status === 'idle') return null
  return (
    <span class={`save-indicator ${saveStatus.status}`}>
      {saveStatus.status === 'saving' && 'Saving...'}
      {saveStatus.status === 'saved' && saveStatus.time && `Saved ${formatSavedTime(saveStatus.time)}`}
      {saveStatus.status === 'error' && (saveStatus.error ?? 'Error saving')}
    </span>
  )
}

// eslint-disable-next-line complexity -- TODO: refactor
export function AdminSettings() {
  const { route } = useLocation()
  const isLoggedIn = auth.value.token
  const isAdmin = auth.value.is_admin
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    enabled: !!isLoggedIn && !!isAdmin,
    queryFn: fetchAdminSettings,
    queryKey: ['adminSettings'],
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [lastfmSaveStatus, setLastfmSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [lastfmApiKey, setLastfmApiKey] = useState('')
  const [ouraWebhookSaveStatus, setOuraWebhookSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [ouraWebhookUrl, setOuraWebhookUrl] = useState('')
  const [invitation, setInvitation] = useState<InvitationResult | null>(null)
  const [invitationLoading, setInvitationLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleSignupModeChange = useCallback(
    async (e: Event) => {
      const newMode = (e.target as HTMLSelectElement).value as SignupMode
      setSaveStatus({ status: 'saving' })
      try {
        const result = await updateAdminSettings({ signup_mode: newMode })
        queryClient.setQueryData(['adminSettings'], result)
        setSaveStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setSaveStatus({
          error: err instanceof Error ? err.message : 'Failed to save',
          status: 'error',
        })
      }
    },
    [queryClient],
  )

  const handleLastfmApiKeyBlur = useCallback(async () => {
    if (!lastfmApiKey) return
    setLastfmSaveStatus({ status: 'saving' })
    try {
      const result = await updateAdminSettings({ lastfm_api_key: lastfmApiKey })
      queryClient.setQueryData(['adminSettings'], result)
      setLastfmApiKey('')
      setLastfmSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setLastfmSaveStatus({
        error: err instanceof Error ? err.message : 'Failed to save',
        status: 'error',
      })
    }
  }, [lastfmApiKey, queryClient])

  const handleClearLastfmApiKey = useCallback(async () => {
    setLastfmSaveStatus({ status: 'saving' })
    try {
      const result = await updateAdminSettings({ lastfm_api_key: null })
      queryClient.setQueryData(['adminSettings'], result)
      setLastfmApiKey('')
      setLastfmSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setLastfmSaveStatus({
        error: err instanceof Error ? err.message : 'Failed to save',
        status: 'error',
      })
    }
  }, [queryClient])

  const handleOuraWebhookUrlBlur = useCallback(async () => {
    if (!ouraWebhookUrl) return
    setOuraWebhookSaveStatus({ status: 'saving' })
    try {
      const result = await updateAdminSettings({ oura_webhook_url: ouraWebhookUrl })
      queryClient.setQueryData(['adminSettings'], result)
      setOuraWebhookUrl('')
      setOuraWebhookSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setOuraWebhookSaveStatus({
        error: err instanceof Error ? err.message : 'Failed to save',
        status: 'error',
      })
    }
  }, [ouraWebhookUrl, queryClient])

  const handleClearOuraWebhookUrl = useCallback(async () => {
    setOuraWebhookSaveStatus({ status: 'saving' })
    try {
      const result = await updateAdminSettings({ oura_webhook_url: null })
      queryClient.setQueryData(['adminSettings'], result)
      setOuraWebhookUrl('')
      setOuraWebhookSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setOuraWebhookSaveStatus({
        error: err instanceof Error ? err.message : 'Failed to save',
        status: 'error',
      })
    }
  }, [queryClient])

  const handleGenerateInvitation = useCallback(async () => {
    setInvitationLoading(true)
    setCopied(false)
    try {
      const result = await generateInvitation()
      setInvitation(result)
    } catch (err) {
      console.error('Failed to generate invitation:', err)
    }
    setInvitationLoading(false)
  }, [])

  const handleCopyLink = useCallback(async () => {
    if (!invitation) return
    try {
      await navigator.clipboard.writeText(invitation.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [invitation])

  // Redirect non-admins
  if (!isLoggedIn || !isAdmin) {
    if (isLoggedIn && isAdmin === false) {
      route('/')
      return null
    }
    return (
      <div class="admin-settings-page">
        <h1>Admin Settings</h1>
        <p>You do not have permission to access this page.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div class="admin-settings-page">
        <h1>Admin Settings</h1>
        <p class="loading">Loading...</p>
      </div>
    )
  }

  return (
    <div class="admin-settings-page">
      <h1>Admin Settings</h1>

      <section class="settings-section">
        <div class="section-header-row">
          <h2>Server Settings</h2>
          <SaveStatusIndicator saveStatus={saveStatus} />
        </div>

        <div class="form-field">
          <label for="signup-mode">Signup Mode</label>
          <select id="signup-mode" value={settings?.signup_mode ?? 'open'} onChange={handleSignupModeChange}>
            <option value="open">Open - Anyone can sign up</option>
            <option value="invite_only">Invite Only - Requires invitation link</option>
            <option value="closed">Closed - No new signups allowed</option>
          </select>
          <p class="field-description">
            {settings?.signup_mode === 'open' && 'Anyone visiting the site can create an account.'}
            {settings?.signup_mode === 'invite_only' &&
              'New users need a valid invitation link to sign up. Generate invitation links below.'}
            {settings?.signup_mode === 'closed' &&
              'No new users can sign up. Only existing accounts can log in.'}
          </p>
        </div>

        <div class="form-field">
          <label>Admin Count</label>
          <p class="stat-value">{settings?.admin_count ?? 0}</p>
          <p class="field-description">Number of users with admin privileges.</p>
        </div>
      </section>

      <section class="settings-section">
        <h2>Integrations</h2>

        <div class="form-field">
          <div class="section-header-row">
            <label for="lastfm-api-key">Last.fm API Key</label>
            <SaveStatusIndicator saveStatus={lastfmSaveStatus} />
          </div>
          {settings?.lastfm_api_key_set ?
            <p class="connected-status">Configured</p>
          : null}
          <div class="api-key-input-row">
            <input
              id="lastfm-api-key"
              type="password"
              value={lastfmApiKey}
              onInput={(e) => setLastfmApiKey((e.target as HTMLInputElement).value)}
              onBlur={handleLastfmApiKeyBlur}
              placeholder={settings?.lastfm_api_key_set ? 'Enter new key to update' : 'Enter Last.fm API key'}
            />
            {settings?.lastfm_api_key_set && (
              <button type="button" class="clear-button" onClick={handleClearLastfmApiKey}>
                Clear
              </button>
            )}
          </div>
          <p class="field-description">
            Server-wide Last.fm API key used for scrobble syncing.{' '}
            <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener noreferrer">
              Register for an API key
            </a>
            . Saves automatically when you leave the field.
          </p>
        </div>

        <div class="form-field">
          <div class="section-header-row">
            <label for="oura-webhook-url">Oura Webhook URL</label>
            <SaveStatusIndicator saveStatus={ouraWebhookSaveStatus} />
          </div>
          {settings?.oura_webhook_url ?
            <p class="connected-status">Enabled</p>
          : null}
          <div class="api-key-input-row">
            <input
              id="oura-webhook-url"
              type="text"
              value={ouraWebhookUrl}
              onInput={(e) => setOuraWebhookUrl((e.target as HTMLInputElement).value)}
              onBlur={handleOuraWebhookUrlBlur}
              placeholder={
                settings?.oura_webhook_url ? 'Enter new URL to update' : (
                  'https://yourdomain.com/api/webhooks/oura'
                )
              }
            />
            {settings?.oura_webhook_url && (
              <button type="button" class="clear-button" onClick={handleClearOuraWebhookUrl}>
                Disable
              </button>
            )}
          </div>
          <p class="field-description">
            Webhook callback URL for near-real-time Oura data sync. Requires Oura client credentials to be
            configured on the server. Saves automatically when you leave the field.
          </p>
        </div>
      </section>

      {settings?.signup_mode === 'invite_only' && (
        <section class="settings-section">
          <h2>Invitations</h2>
          <p class="section-description">
            Generate invitation links to share with people you want to invite to sign up.
          </p>

          <button
            type="button"
            class="generate-button"
            onClick={handleGenerateInvitation}
            disabled={invitationLoading}
          >
            {invitationLoading ? 'Generating...' : 'Generate Invitation Link'}
          </button>

          {invitation && (
            <div class="invitation-result">
              <div class="invitation-url">
                <input type="text" value={invitation.url} readOnly />
                <button type="button" class="copy-button" onClick={handleCopyLink}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p class="invitation-expiry">Expires in: {formatExpiryTime(invitation.expires_at)}</p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
