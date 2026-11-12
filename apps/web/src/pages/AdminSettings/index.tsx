import type { PublicTagFollow, RelayStyle } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useLocation } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'

import type { AdminSettings, InvitationResult, SignupMode } from '../../state/api'

import { formatTagsInput, parseTagFilterInput } from '../../components/hashtags'
import { ImportPanel } from '../../components/ImportPanel'
import {
  formatHandlesInput,
  formatUsernamesInput,
  listsAuthors,
  officialFeedSummary,
  parseHandlesInput,
  parseUsernamesInput,
} from '../../components/official-feed'
import {
  hasTagsPubRelay,
  relayStateLabel,
  relayStateTitle,
  relayStyleLabel,
  TAGS_PUB_RELAY,
} from '../../components/relays'
import { type SaveStatus, SaveStatusIndicator } from '../../components/SaveStatusIndicator'
import { TagsInput } from '../../components/TagsInput'
import '../../components/ShareActivityDialog.css'
import {
  addRelay,
  apiErrorMessage,
  fetchAdminSettings,
  fetchRelays,
  generateInvitation,
  officialFeedPath,
  publicTagPath,
  removeRelay,
  updateAdminSettings,
} from '../../state/api'
import { auth, contactFediverse, contactReddit, officialFeedEnabled, publicTagPages } from '../../state/auth'
import { apiErrorText } from '../../utils/profile'
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
function GravlApiSection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryFn: fetchAdminSettings,
    queryKey: ['adminSettings'],
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const idSet = settings?.gravl_client_id_set ?? false
  const secretSet = settings?.gravl_client_secret_set ?? false
  const redirectUri = settings?.gravl_redirect_uri

  const saveGravl = useCallback(
    async (params: { gravl_client_id?: string | null; gravl_client_secret?: string | null }) => {
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
    saveGravl({
      ...(clientId ? { gravl_client_id: clientId } : {}),
      ...(clientSecret ? { gravl_client_secret: clientSecret } : {}),
    })
  }, [clientId, clientSecret, saveGravl])

  const handleClear = useCallback(
    () => saveGravl({ gravl_client_id: null, gravl_client_secret: null }),
    [saveGravl],
  )

  return (
    <div class="form-field">
      <div class="section-header-row">
        <label>Gravl API</label>
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
          placeholder={idSet ? 'Enter new client ID to update' : 'Client ID (gci_…)'}
        />
      </div>
      <div class="api-key-input-row">
        <input
          type="password"
          value={clientSecret}
          onInput={(e) => setClientSecret((e.target as HTMLInputElement).value)}
          placeholder={secretSet ? 'Enter new client secret to update' : 'Client Secret (gcs_…)'}
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
        Save Gravl Credentials
      </button>
      <p class="field-description">
        Optional: lets users connect Gravl with OAuth instead of pasting a personal token. Registration is by
        email to developers@gravl.ai (see{' '}
        <a href="https://gravl.ai/developers/oauth" target="_blank" rel="noopener noreferrer">
          gravl.ai/developers/oauth
        </a>
        ); register the redirect URI <code>{redirectUri ?? '…'}</code> and request the{' '}
        <code>workouts:read</code> scope.
      </p>
    </div>
  )
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

      <GravlApiSection />
    </section>
  )
}

interface BillingForm {
  billing_enabled: boolean
  trial_days: string
  grace_days: string
  price_text: string
  payment_url: string
}

const billingForm = (settings: AdminSettings): BillingForm => ({
  billing_enabled: settings.billing_enabled,
  grace_days: String(settings.grace_days),
  payment_url: settings.payment_url,
  price_text: settings.price_text,
  trial_days: String(settings.trial_days),
})

function BillingSection() {
  const { data: settings } = useQuery({ queryFn: fetchAdminSettings, queryKey: ['adminSettings'] })
  return settings ? <BillingSettingsForm settings={settings} /> : null
}

function BillingSettingsForm({ settings }: { settings: AdminSettings }) {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [form, setForm] = useState<BillingForm>(() => billingForm(settings))

  const set = <K extends keyof BillingForm>(key: K, value: BillingForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = async (e: Event) => {
    e.preventDefault()
    setSaveStatus({ status: 'saving' })
    try {
      const result = await updateAdminSettings({
        billing_enabled: form.billing_enabled,
        grace_days: Number(form.grace_days),
        payment_url: form.payment_url.trim(),
        price_text: form.price_text.trim(),
        trial_days: Number(form.trial_days),
      })
      queryClient.setQueryData(['adminSettings'], result)
      void queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
      void queryClient.invalidateQueries({ queryKey: ['myPlan'] })
      setForm(billingForm(result))
      setSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setSaveStatus({ error: apiErrorMessage(err, 'Failed to save'), status: 'error' })
    }
  }

  return (
    <section class="settings-section">
      <div class="section-header-row">
        <h2>Plans and billing</h2>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      <p class="section-description">
        Charge for accounts after a free trial. New accounts start on the trial; when it (or a paid period)
        ends and the grace period has passed, the account becomes read-only until you record a payment on its
        page under <a href="/admin/users">Users</a>. Off by default.
      </p>
      <form onSubmit={save}>
        <div class="form-field">
          <label class="toggle-row">
            <input
              type="checkbox"
              checked={form.billing_enabled}
              onChange={(e) => set('billing_enabled', (e.target as HTMLInputElement).checked)}
            />
            <span>Enable billing</span>
          </label>
          <p class="field-description">
            Enabling marks every account that exists now as exempt: only accounts created afterwards are
            billed. Admins are never restricted.
          </p>
        </div>
        <div class="form-field">
          <label for="trial-days">Free trial (days)</label>
          <input
            id="trial-days"
            type="number"
            min="0"
            max="3650"
            required
            value={form.trial_days}
            onInput={(e) => set('trial_days', (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-field">
          <label for="grace-days">Grace period (days)</label>
          <input
            id="grace-days"
            type="number"
            min="0"
            max="365"
            required
            value={form.grace_days}
            onInput={(e) => set('grace_days', (e.target as HTMLInputElement).value)}
          />
          <p class="field-description">
            How long after a trial or paid period ends before the account turns read-only.
          </p>
        </div>
        <div class="form-field">
          <label for="price-text">Price</label>
          <input
            id="price-text"
            type="text"
            maxLength={200}
            placeholder="3 € / month"
            value={form.price_text}
            onInput={(e) => set('price_text', (e.target as HTMLInputElement).value)}
          />
          <p class="field-description">Shown on the signup page and to users whose plan is ending.</p>
        </div>
        <div class="form-field">
          <label for="payment-url">Payment link</label>
          <input
            id="payment-url"
            type="url"
            pattern="https://.*"
            placeholder="https://www.patreon.com/…"
            value={form.payment_url}
            onInput={(e) => set('payment_url', (e.target as HTMLInputElement).value)}
          />
          <p class="field-description">Where users pay, e.g. a Patreon page (https).</p>
        </div>
        <button type="submit" class="generate-button" disabled={saveStatus.status === 'saving'}>
          Save billing settings
        </button>
      </form>
    </section>
  )
}

function SentrySection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryFn: fetchAdminSettings,
    queryKey: ['adminSettings'],
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [dsn, setDsn] = useState('')

  const configuredDsn = settings?.sentry_dsn ?? null

  const saveDsn = useCallback(
    async (value: string | null) => {
      setSaveStatus({ status: 'saving' })
      try {
        const result = await updateAdminSettings({ sentry_dsn: value })
        queryClient.setQueryData(['adminSettings'], result)
        setDsn('')
        setSaveStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setSaveStatus({ error: getErrorMessage(err), status: 'error' })
      }
    },
    [queryClient],
  )

  return (
    <section class="settings-section">
      <h2>Error Reporting</h2>
      <div class="form-field">
        <div class="section-header-row">
          <label for="sentry-dsn">Sentry DSN</label>
          <SaveStatusIndicator state={saveStatus} />
        </div>
        {configuredDsn && (
          <p class="connected-status" style={{ wordBreak: 'break-all' }}>
            {configuredDsn}
          </p>
        )}
        <div class="api-key-input-row">
          <input
            id="sentry-dsn"
            type="text"
            value={dsn}
            onInput={(e) => setDsn((e.target as HTMLInputElement).value)}
            placeholder={configuredDsn ? 'Enter new DSN to update' : 'https://<key>@<host>/<project>'}
          />
          {configuredDsn && (
            <button type="button" class="clear-button" onClick={() => saveDsn(null)}>
              Clear
            </button>
          )}
        </div>
        <button type="button" class="generate-button" onClick={() => dsn && saveDsn(dsn)} disabled={!dsn}>
          Save DSN
        </button>
        <p class="field-description">
          Sentry DSN for backend error reporting. When set, uncaught errors from the API are reported to
          Sentry. Changes take effect after the next backend restart/redeploy.
        </p>
      </div>
    </section>
  )
}

interface SupportContactsForm {
  fediverse: string
  reddit: string
}

const supportContactsForm = (settings: AdminSettings): SupportContactsForm => ({
  fediverse: settings.contact_fediverse ? `@${settings.contact_fediverse}` : '',
  reddit: settings.contact_reddit ? `u/${settings.contact_reddit}` : '',
})

const saveErrorText = (err: unknown): string =>
  apiErrorText(
    axios.isAxiosError(err) ? (err.response?.data as { error?: unknown } | undefined)?.error : undefined,
    getErrorMessage(err),
  )

function SupportContactsSection() {
  const { data: settings } = useQuery({ queryFn: fetchAdminSettings, queryKey: ['adminSettings'] })
  return settings ? <SupportContactsSettingsForm settings={settings} /> : null
}

function SupportContactsSettingsForm({ settings }: { settings: AdminSettings }) {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [form, setForm] = useState<SupportContactsForm>(() => supportContactsForm(settings))

  const save = async (e: Event) => {
    e.preventDefault()
    setSaveStatus({ status: 'saving' })
    try {
      const result = await updateAdminSettings({
        contact_fediverse: form.fediverse.trim(),
        contact_reddit: form.reddit.trim(),
      })
      queryClient.setQueryData(['adminSettings'], result)
      contactFediverse.value = result.contact_fediverse || null
      contactReddit.value = result.contact_reddit || null
      setForm(supportContactsForm(result))
      setSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setSaveStatus({ error: saveErrorText(err), status: 'error' })
    }
  }

  return (
    <section class="settings-section">
      <div class="section-header-row">
        <h2>Support contacts</h2>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      <p class="section-description">
        Shown on the Help, Privacy and Terms pages so users can reach you outside GitHub. Leave empty to hide.
      </p>
      <form onSubmit={save}>
        <div class="form-field">
          <label for="contact-fediverse">Fediverse handle</label>
          <input
            id="contact-fediverse"
            type="text"
            maxLength={255}
            placeholder="@name@example.social"
            autocapitalize="off"
            spellcheck={false}
            value={form.fediverse}
            onInput={(e) =>
              setForm((current) => ({ ...current, fediverse: (e.target as HTMLInputElement).value }))
            }
          />
          <p class="field-description">
            Users can mention or message you from Mastodon or any fediverse app.
          </p>
        </div>
        <div class="form-field">
          <label for="contact-reddit">Reddit username</label>
          <input
            id="contact-reddit"
            type="text"
            maxLength={255}
            placeholder="u/name"
            autocapitalize="off"
            spellcheck={false}
            value={form.reddit}
            onInput={(e) =>
              setForm((current) => ({ ...current, reddit: (e.target as HTMLInputElement).value }))
            }
          />
          <p class="field-description">Users are offered a private message to you on Reddit.</p>
        </div>
        <button type="submit" class="generate-button" disabled={saveStatus.status === 'saving'}>
          Save contacts
        </button>
      </form>
    </section>
  )
}

function OfficialFeedSection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryFn: fetchAdminSettings,
    queryKey: ['adminSettings'],
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [usersText, setUsersText] = useState<string | null>(null)
  const [remoteText, setRemoteText] = useState<string | null>(null)
  const [tagsText, setTagsText] = useState<string | null>(null)

  const configured = settings?.official_feed ?? { remote_authors: [], tags: [], users: [] }
  const configuredOn = listsAuthors(configured)
  const usersValue = usersText ?? formatUsernamesInput(configured.users)
  const remoteValue = remoteText ?? formatHandlesInput(configured.remote_authors)
  const tagsValue = tagsText ?? formatTagsInput(configured.tags)

  const save = useCallback(
    async (users: string[], remoteAuthors: string[], tags: string[]) => {
      setSaveStatus({ status: 'saving' })
      try {
        const result = await updateAdminSettings({
          official_feed: { remote_authors: remoteAuthors, tags, users },
        })
        queryClient.setQueryData(['adminSettings'], result)
        officialFeedEnabled.value = listsAuthors(result.official_feed)
        setUsersText(null)
        setRemoteText(null)
        setTagsText(null)
        setSaveStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setSaveStatus({ error: apiErrorMessage(err, getErrorMessage(err)), status: 'error' })
      }
    },
    [queryClient],
  )

  return (
    <section class="settings-section">
      <h2>Official Feed</h2>
      <div class="form-field">
        <div class="section-header-row">
          <label for="official-feed-users">Users</label>
          <SaveStatusIndicator state={saveStatus} />
        </div>
        {configuredOn && (
          <p class="connected-status">
            <a href={officialFeedPath}>{officialFeedSummary(configured)}</a>
          </p>
        )}
        <input
          id="official-feed-users"
          type="text"
          value={usersValue}
          onInput={(e) => setUsersText((e.target as HTMLInputElement).value)}
          placeholder="username, another"
          autocapitalize="off"
          spellcheck={false}
        />
        <p class="field-description">Usernames separated by commas or spaces.</p>
        <label for="official-feed-remote-authors">Authors on other servers</label>
        <input
          id="official-feed-remote-authors"
          type="text"
          value={remoteValue}
          onInput={(e) => setRemoteText((e.target as HTMLInputElement).value)}
          placeholder="@name@example.social"
          autocapitalize="off"
          spellcheck={false}
        />
        <p class="field-description">
          Fediverse handles, e.g. @fiddur@aurboda.net. Their public posts with one of the tags reach this
          server through the tag actor host (Federation → tag actor host). Needs at least one tag.
        </p>
        <TagsInput
          id="official-feed-tags"
          legend="Tags"
          note="Only posts with at least one of these hashtags are listed. Leave empty to list every public post of the users."
          value={tagsValue}
          onInput={setTagsText}
        />
        <div class="api-key-input-row">
          <button
            type="button"
            class="generate-button"
            onClick={() =>
              save(
                parseUsernamesInput(usersValue),
                parseHandlesInput(remoteValue),
                parseTagFilterInput(tagsValue),
              )
            }
          >
            Save
          </button>
          {configuredOn && (
            <button type="button" class="clear-button" onClick={() => save([], [], [])}>
              Clear
            </button>
          )}
        </div>
        <p class="field-description">
          Public posts by these authors are the instance blog at <a href={officialFeedPath}>/blog</a>, with an
          Atom feed, linked from the front page and footer. No users and no authors on other servers turns it
          off.
        </p>
      </div>
    </section>
  )
}

const tagFollowTitle: Record<PublicTagFollow['state'], string> = {
  accepted: 'The tag actor accepted the follow; its posts are arriving.',
  pending: 'Followed, not yet accepted. Saving again re-sends the follow.',
  unresolved: 'The tag actor could not be found on the tag actor host.',
}

function PublicTagPagesSection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryFn: fetchAdminSettings,
    queryKey: ['adminSettings'],
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [tagsText, setTagsText] = useState<string | null>(null)
  const [daysText, setDaysText] = useState<string | null>(null)

  const configured = settings?.public_tag_pages ?? []
  const followStates = new Map((settings?.public_tag_follows ?? []).map((f) => [f.tag, f.state]))
  const tagsValue = tagsText ?? formatTagsInput(configured)
  const daysValue = daysText ?? String(settings?.public_tag_retention_days ?? 30)
  const host = settings?.tag_actor_host ?? 'tags.pub'

  const save = useCallback(
    async (tags: string[], days: number) => {
      setSaveStatus({ status: 'saving' })
      try {
        const result = await updateAdminSettings({ public_tag_pages: tags, public_tag_retention_days: days })
        queryClient.setQueryData(['adminSettings'], result)
        publicTagPages.value = result.public_tag_pages
        setTagsText(null)
        setDaysText(null)
        setSaveStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setSaveStatus({ error: apiErrorMessage(err, getErrorMessage(err)), status: 'error' })
      }
    },
    [queryClient],
  )

  return (
    <section class="settings-section">
      <h2>Public tag pages</h2>
      <div class="form-field">
        <div class="section-header-row">
          <span>Tags</span>
          <SaveStatusIndicator state={saveStatus} />
        </div>
        {configured.length > 0 && (
          <p class="connected-status">
            {configured.map((tag, i) => (
              <span key={tag}>
                {i > 0 && ', '}
                <a href={publicTagPath(tag)}>#{tag}</a>
                {followStates.has(tag) && (
                  <span
                    class={`tag-follow-badge tag-follow-${followStates.get(tag)}`}
                    title={tagFollowTitle[followStates.get(tag) ?? 'unresolved']}
                  >
                    {followStates.get(tag)}
                  </span>
                )}
              </span>
            ))}
          </p>
        )}
        <TagsInput
          id="public-tag-pages"
          legend="Tags"
          note={`Each tag gets a public page at /tags/<tag> with posts from every server that ${host} sees. The server follows <tag>@${host} for each.`}
          value={tagsValue}
          onInput={setTagsText}
        />
        <label for="public-tag-retention">Keep posts for (days)</label>
        <input
          id="public-tag-retention"
          type="number"
          min="1"
          max="365"
          value={daysValue}
          onInput={(e) => setDaysText((e.target as HTMLInputElement).value)}
        />
        <div class="api-key-input-row">
          <button
            type="button"
            class="generate-button"
            onClick={() => save(parseTagFilterInput(tagsValue), Number(daysValue))}
          >
            Save
          </button>
          {configured.length > 0 && (
            <button type="button" class="clear-button" onClick={() => save([], Number(daysValue))}>
              Clear
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function FederationSection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryFn: fetchAdminSettings,
    queryKey: ['adminSettings'],
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [hostText, setHostText] = useState<string | null>(null)
  const configured = settings?.tag_actor_host ?? 'tags.pub'
  const value = hostText ?? configured

  const save = useCallback(
    async (host: string) => {
      setSaveStatus({ status: 'saving' })
      try {
        const result = await updateAdminSettings({ tag_actor_host: host })
        queryClient.setQueryData(['adminSettings'], result)
        setHostText(null)
        setSaveStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setSaveStatus({ error: apiErrorMessage(err, getErrorMessage(err)), status: 'error' })
      }
    },
    [queryClient],
  )

  return (
    <section class="settings-section">
      <h2>Federation</h2>
      <div class="form-field">
        <div class="section-header-row">
          <label for="tag-actor-host">Tag actor host</label>
          <SaveStatusIndicator state={saveStatus} />
        </div>
        <div class="api-key-input-row">
          <input
            id="tag-actor-host"
            type="text"
            value={value}
            onInput={(e) => setHostText((e.target as HTMLInputElement).value)}
            placeholder="tags.pub"
            autocapitalize="off"
            spellcheck={false}
          />
        </div>
        <button type="button" class="generate-button" onClick={() => save(value)}>
          Save
        </button>
        <p class="field-description">
          Users who follow a hashtag follow <code>&lt;tag&gt;@{configured}</code>; tags.pub is the public tag
          relay run by the Social Web Foundation. Empty resets it to tags.pub.
        </p>
      </div>
      <RelaysField />
    </section>
  )
}

function RelaysField() {
  const queryClient = useQueryClient()
  const { data: relays = [] } = useQuery({ queryFn: fetchRelays, queryKey: ['adminRelays'] })
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [url, setUrl] = useState('')
  const [style, setStyle] = useState<RelayStyle>('mastodon')

  const run = useCallback(
    async (action: () => Promise<unknown>, after?: () => void) => {
      setSaveStatus({ status: 'saving' })
      try {
        await action()
        await queryClient.invalidateQueries({ queryKey: ['adminRelays'] })
        after?.()
        setSaveStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setSaveStatus({ error: apiErrorMessage(err, getErrorMessage(err)), status: 'error' })
      }
    },
    [queryClient],
  )

  const add = (body: { url: string; style: RelayStyle }) =>
    run(
      () => addRelay(body),
      () => setUrl(''),
    )

  return (
    <div class="form-field">
      <div class="section-header-row">
        <label for="relay-url">Relays</label>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      {relays.length > 0 && (
        <ul class="relay-list">
          {relays.map((relay) => (
            <li key={relay.id} class="relay-row">
              <span class="relay-url">{relay.url}</span>
              <span class="relay-style">{relayStyleLabel(relay.style)}</span>
              <span class={`relay-state relay-state-${relay.state}`} title={relayStateTitle(relay)}>
                {relayStateLabel(relay.state)}
                {relay.last_error != null && ' ⚠'}
              </span>
              <button type="button" class="clear-button" onClick={() => run(() => removeRelay(relay.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="api-key-input-row">
        <input
          id="relay-url"
          type="url"
          value={url}
          onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          placeholder="https://relay.example/inbox"
          autocapitalize="off"
          spellcheck={false}
        />
        <select
          aria-label="Relay style"
          value={style}
          onChange={(e) => setStyle((e.target as HTMLSelectElement).value as RelayStyle)}
        >
          <option value="mastodon">Mastodon</option>
          <option value="litepub">LitePub</option>
        </select>
      </div>
      <div class="relay-actions">
        <button
          type="button"
          class="generate-button"
          disabled={url.trim() === ''}
          onClick={() => add({ style, url: url.trim() })}
        >
          Add relay
        </button>
        {!hasTagsPubRelay(relays) && (
          <button type="button" class="generate-button" onClick={() => add(TAGS_PUB_RELAY)}>
            Add the tags.pub relay
          </button>
        )}
      </div>
      <p class="field-description">
        Public posts of every user on this server are pushed to accepted relays. A Mastodon-style relay takes
        its inbox URL, a LitePub relay its actor URL. tags.pub is one-way: it takes posts and sends none back.
      </p>
    </div>
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
      <p>
        <a href="/admin/users">Users</a>: storage, incoming data and use per user.
      </p>

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

      <BillingSection />

      <IntegrationsSection />

      <SentrySection />

      <SupportContactsSection />

      <OfficialFeedSection />

      <PublicTagPagesSection />

      <FederationSection />

      <section class="settings-section">
        <h2>Shared Food Library</h2>
        <ImportPanel />
      </section>

      {settings?.signup_mode === 'invite_only' && <InvitationsSection />}
    </div>
  )
}
