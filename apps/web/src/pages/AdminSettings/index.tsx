import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'

import type { InvitationResult, SignupMode } from '../../state/api'

import { ImportPanel } from '../../components/ImportPanel'
import { type SaveStatus, SaveStatusIndicator } from '../../components/SaveStatusIndicator'
import { fetchAdminSettings, generateInvitation, updateAdminSettings } from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

const signupModeDescriptions: Record<SignupMode, string> = {
  closed: 'No new users can sign up. Only existing accounts can log in.',
  invite_only: 'New users need a valid invitation link to sign up. Generate invitation links below.',
  open: 'Anyone visiting the site can create an account.',
}

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'Failed to save')

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

// eslint-disable-next-line complexity -- simple form with save/clear handlers
function StravaApiSection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryFn: fetchAdminSettings,
    queryKey: ['adminSettings'],
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const idSet = settings?.strava_client_id_set ?? false
  const secretSet = settings?.strava_client_secret_set ?? false

  const saveStrava = useCallback(
    async (params: { strava_client_id?: string | null; strava_client_secret?: string | null }) => {
      setSaveStatus({ status: 'saving' })
      try {
        const result = await updateAdminSettings(params)
        queryClient.setQueryData(['adminSettings'], result)
        setClientId('')
        setClientSecret('')
        setSaveStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setSaveStatus({ error: getErrorMessage(err), status: 'error' })
      }
    },
    [queryClient],
  )

  const handleSave = useCallback(() => {
    if (!clientId && !clientSecret) return
    saveStrava({
      ...(clientId ? { strava_client_id: clientId } : {}),
      ...(clientSecret ? { strava_client_secret: clientSecret } : {}),
    })
  }, [clientId, clientSecret, saveStrava])

  const handleClear = useCallback(
    () => saveStrava({ strava_client_id: null, strava_client_secret: null }),
    [saveStrava],
  )

  return (
    <div class="form-field">
      <div class="section-header-row">
        <label>Strava API</label>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      {(idSet || secretSet) && (
        <p class={`connected-status${idSet && secretSet ? '' : ' warning'}`}>
          {idSet && secretSet ? 'Configured' : 'Partially configured'}
        </p>
      )}
      <div class="api-key-input-row">
        <input
          type="text"
          value={clientId}
          onInput={(e) => setClientId((e.target as HTMLInputElement).value)}
          placeholder={idSet ? 'Enter new client ID to update' : 'Client ID'}
        />
      </div>
      <div class="api-key-input-row">
        <input
          type="password"
          value={clientSecret}
          onInput={(e) => setClientSecret((e.target as HTMLInputElement).value)}
          placeholder={secretSet ? 'Enter new client secret to update' : 'Client Secret'}
        />
        {(idSet || secretSet) && (
          <button type="button" class="clear-button" onClick={handleClear}>
            Clear
          </button>
        )}
      </div>
      <button
        type="button"
        class="generate-button"
        onClick={handleSave}
        disabled={!clientId && !clientSecret}
      >
        Save Strava Credentials
      </button>
      <p class="field-description">
        Strava OAuth credentials for activity syncing.{' '}
        <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener noreferrer">
          Register a Strava API application
        </a>
        . Only the Client ID and Client Secret are needed.
      </p>
    </div>
  )
}

// eslint-disable-next-line complexity -- simple form with save/clear handlers
function OuraApiSection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryFn: fetchAdminSettings,
    queryKey: ['adminSettings'],
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const idSet = settings?.oura_client_id_set ?? false
  const secretSet = settings?.oura_client_secret_set ?? false

  const saveOura = useCallback(
    async (params: { oura_client_id?: string | null; oura_client_secret?: string | null }) => {
      setSaveStatus({ status: 'saving' })
      try {
        const result = await updateAdminSettings(params)
        queryClient.setQueryData(['adminSettings'], result)
        setClientId('')
        setClientSecret('')
        setSaveStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setSaveStatus({ error: getErrorMessage(err), status: 'error' })
      }
    },
    [queryClient],
  )

  const handleSave = useCallback(() => {
    if (!clientId && !clientSecret) return
    saveOura({
      ...(clientId ? { oura_client_id: clientId } : {}),
      ...(clientSecret ? { oura_client_secret: clientSecret } : {}),
    })
  }, [clientId, clientSecret, saveOura])

  const handleClear = useCallback(
    () => saveOura({ oura_client_id: null, oura_client_secret: null }),
    [saveOura],
  )

  return (
    <div class="form-field">
      <div class="section-header-row">
        <label>Oura API</label>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      {(idSet || secretSet) && (
        <p class={`connected-status${idSet && secretSet ? '' : ' warning'}`}>
          {idSet && secretSet ? 'Configured' : 'Partially configured'}
        </p>
      )}
      <div class="api-key-input-row">
        <input
          type="text"
          value={clientId}
          onInput={(e) => setClientId((e.target as HTMLInputElement).value)}
          placeholder={idSet ? 'Enter new client ID to update' : 'Client ID'}
        />
      </div>
      <div class="api-key-input-row">
        <input
          type="password"
          value={clientSecret}
          onInput={(e) => setClientSecret((e.target as HTMLInputElement).value)}
          placeholder={secretSet ? 'Enter new client secret to update' : 'Client Secret'}
        />
        {(idSet || secretSet) && (
          <button type="button" class="clear-button" onClick={handleClear}>
            Clear
          </button>
        )}
      </div>
      <button
        type="button"
        class="generate-button"
        onClick={handleSave}
        disabled={!clientId && !clientSecret}
      >
        Save Oura Credentials
      </button>
      <p class="field-description">
        Oura OAuth credentials for ring data syncing.{' '}
        <a href="https://cloud.ouraring.com/oauth/applications" target="_blank" rel="noopener noreferrer">
          Register an Oura API application
        </a>
        . Only the Client ID and Client Secret are needed.
      </p>
    </div>
  )
}

function IntegrationsSection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryFn: fetchAdminSettings,
    queryKey: ['adminSettings'],
  })

  const [lastfmSaveStatus, setLastfmSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [lastfmApiKey, setLastfmApiKey] = useState('')
  const [ouraWebhookSaveStatus, setOuraWebhookSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  const handleLastfmApiKeyBlur = useCallback(async () => {
    if (!lastfmApiKey) return
    setLastfmSaveStatus({ status: 'saving' })
    try {
      const result = await updateAdminSettings({ lastfm_api_key: lastfmApiKey })
      queryClient.setQueryData(['adminSettings'], result)
      setLastfmApiKey('')
      setLastfmSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setLastfmSaveStatus({ error: getErrorMessage(err), status: 'error' })
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
      setLastfmSaveStatus({ error: getErrorMessage(err), status: 'error' })
    }
  }, [queryClient])

  const handleOuraWebhookToggle = useCallback(async () => {
    const newValue = !settings?.oura_webhook_enabled
    setOuraWebhookSaveStatus({ status: 'saving' })
    try {
      const result = await updateAdminSettings({ oura_webhook_enabled: newValue })
      queryClient.setQueryData(['adminSettings'], result)
      setOuraWebhookSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setOuraWebhookSaveStatus({ error: getErrorMessage(err), status: 'error' })
    }
  }, [settings?.oura_webhook_enabled, queryClient])

  return (
    <section class="settings-section">
      <h2>Integrations</h2>

      <div class="form-field">
        <div class="section-header-row">
          <label for="lastfm-api-key">Last.fm API Key</label>
          <SaveStatusIndicator state={lastfmSaveStatus} />
        </div>
        {settings?.lastfm_api_key_set ? <p class="connected-status">Configured</p> : null}
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

      <OuraApiSection />

      {settings?.oura_webhook_available && (
        <div class="form-field">
          <div class="section-header-row">
            <label for="oura-webhook-toggle">Oura Webhook Push</label>
            <SaveStatusIndicator state={ouraWebhookSaveStatus} />
          </div>
          <label class="toggle-row">
            <input
              id="oura-webhook-toggle"
              type="checkbox"
              checked={settings?.oura_webhook_enabled ?? false}
              onChange={handleOuraWebhookToggle}
            />
            <span>Enable Oura webhook push notifications</span>
          </label>
          <p class="field-description">
            Enable near-real-time data sync from Oura via webhook push notifications.
          </p>
        </div>
      )}

      <StravaApiSection />
    </section>
  )
}

function InvitationsSection() {
  const [invitation, setInvitation] = useState<InvitationResult | null>(null)
  const [invitationLoading, setInvitationLoading] = useState(false)
  const [copied, setCopied] = useState(false)

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

  return (
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
  )
}

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

  const handleSignupModeChange = useCallback(
    async (e: Event) => {
      const newMode = (e.target as HTMLSelectElement).value as SignupMode
      setSaveStatus({ status: 'saving' })
      try {
        const result = await updateAdminSettings({ signup_mode: newMode })
        queryClient.setQueryData(['adminSettings'], result)
        setSaveStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setSaveStatus({ error: getErrorMessage(err), status: 'error' })
      }
    },
    [queryClient],
  )

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
          <SaveStatusIndicator state={saveStatus} />
        </div>

        <div class="form-field">
          <label for="signup-mode">Signup Mode</label>
          <select id="signup-mode" value={settings?.signup_mode ?? 'open'} onChange={handleSignupModeChange}>
            <option value="open">Open - Anyone can sign up</option>
            <option value="invite_only">Invite Only - Requires invitation link</option>
            <option value="closed">Closed - No new signups allowed</option>
          </select>
          <p class="field-description">{signupModeDescriptions[settings?.signup_mode ?? 'open']}</p>
        </div>

        <div class="form-field">
          <label>Admin Count</label>
          <p class="stat-value">{settings?.admin_count ?? 0}</p>
          <p class="field-description">Number of users with admin privileges.</p>
        </div>
      </section>

      <IntegrationsSection />

      <section class="settings-section">
        <h2>Shared Food Library</h2>
        <ImportPanel />
      </section>

      {settings?.signup_mode === 'invite_only' && <InvitationsSection />}
    </div>
  )
}
