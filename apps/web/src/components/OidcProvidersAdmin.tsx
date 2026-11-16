import type { OidcPreset, OidcProvider } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'preact/hooks'

import {
  addOidcProvider,
  apiErrorMessage,
  deleteOidcProvider,
  fetchAdminOidcProviders,
  updateOidcProvider,
} from '../state/api'
import { OIDC_PRESETS, parseEmailDomains } from '../utils/oidc'
import { apiErrorText } from '../utils/profile'

const DOCS_URL = 'https://github.com/fiddur/aurboda/blob/develop/docs/sso.md'

interface ProviderForm {
  preset: OidcPreset | ''
  id: string
  display_name: string
  issuer: string
  client_id: string
  client_secret: string
  domains: string
  allow_signup: boolean
  enabled: boolean
}

const emptyForm = (preset: OidcPreset | ''): ProviderForm => ({
  allow_signup: false,
  client_id: '',
  client_secret: '',
  display_name: preset ? OIDC_PRESETS[preset].display_name : '',
  domains: '',
  enabled: true,
  id: preset ? OIDC_PRESETS[preset].id : '',
  issuer: preset ? OIDC_PRESETS[preset].issuer : '',
  preset,
})

const formOf = (provider: OidcProvider): ProviderForm => ({
  allow_signup: provider.allow_signup,
  client_id: provider.client_id,
  client_secret: '',
  display_name: provider.display_name,
  domains: provider.allowed_email_domains.join(', '),
  enabled: provider.enabled,
  id: provider.id,
  issuer: provider.issuer,
  preset: provider.preset ?? '',
})

const errorText = (err: unknown, fallback: string): string =>
  axios.isAxiosError(err)
    ? apiErrorText((err.response?.data as { error?: unknown })?.error, fallback)
    : fallback

function ProviderRow({
  provider,
  onEdit,
  onDelete,
}: {
  provider: OidcProvider
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li class="relay-row">
      <span class="relay-url">
        <strong>{provider.display_name}</strong> ({provider.id}) · {provider.issuer}
      </span>
      <span class={provider.enabled ? 'relay-state relay-state-accepted' : 'relay-state'}>
        {provider.enabled ? 'enabled' : 'disabled'}
      </span>
      {provider.allow_signup && <span class="relay-style">signup</span>}
      {provider.allowed_email_domains.length > 0 && (
        <span class="relay-style">{provider.allowed_email_domains.join(', ')}</span>
      )}
      {!provider.client_secret_set && <span class="relay-style">no secret</span>}
      <span class="relay-actions">
        <button type="button" onClick={onEdit}>
          Edit
        </button>
        <button type="button" onClick={onDelete}>
          Delete
        </button>
      </span>
    </li>
  )
}

interface Editing {
  id: string | null
  form: ProviderForm
}

function ProviderEditor({
  editing,
  error,
  saving,
  set,
  setEditing,
  onSubmit,
  onCancel,
}: {
  editing: Editing
  error: string | null
  saving: boolean
  set: <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) => void
  setEditing: (editing: Editing) => void
  onSubmit: (e: Event) => void
  onCancel: () => void
}) {
  const { form } = editing
  return (
    <form onSubmit={onSubmit}>
      <h3>{editing.id === null ? 'Add a provider' : `Edit ${editing.id}`}</h3>
      {editing.id === null && (
        <div class="form-field">
          <label for="oidc-preset">Kind</label>
          <select
            id="oidc-preset"
            value={form.preset}
            onChange={(e) =>
              setEditing({
                form: emptyForm((e.target as HTMLSelectElement).value as OidcPreset | ''),
                id: null,
              })
            }
          >
            <option value="google">Google</option>
            <option value="">Other OpenID Connect provider</option>
          </select>
        </div>
      )}
      {editing.id === null && (
        <div class="form-field">
          <label for="oidc-id">Id</label>
          <div class="api-key-input-row">
            <input
              id="oidc-id"
              type="text"
              required
              pattern="^[a-z][a-z0-9_\-]{1,30}$"
              placeholder="e.g. work"
              value={form.id}
              onInput={(e) => set('id', (e.target as HTMLInputElement).value)}
            />
          </div>
          <p class="field-description">
            Used in URLs; lowercase letters, digits, - and _. It cannot change later.
          </p>
        </div>
      )}
      <div class="form-field">
        <label for="oidc-display-name">Display name</label>
        <div class="api-key-input-row">
          <input
            id="oidc-display-name"
            type="text"
            required
            maxLength={60}
            value={form.display_name}
            onInput={(e) => set('display_name', (e.target as HTMLInputElement).value)}
          />
        </div>
        <p class="field-description">On the buttons: “Continue with …”.</p>
      </div>
      <div class="form-field">
        <label for="oidc-issuer">Issuer URL</label>
        <div class="api-key-input-row">
          <input
            id="oidc-issuer"
            type="url"
            required
            placeholder="https://sso.example.com/realms/main"
            value={form.issuer}
            onInput={(e) => set('issuer', (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div class="form-field">
        <label for="oidc-client-id">Client id</label>
        <div class="api-key-input-row">
          <input
            id="oidc-client-id"
            type="text"
            required
            autoComplete="off"
            value={form.client_id}
            onInput={(e) => set('client_id', (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div class="form-field">
        <label for="oidc-client-secret">Client secret</label>
        {editing.id !== null && <p class="connected-status">A secret is set.</p>}
        <div class="api-key-input-row">
          <input
            id="oidc-client-secret"
            type="password"
            autoComplete="new-password"
            required={editing.id === null}
            placeholder={editing.id !== null ? 'Enter a new secret to replace it' : ''}
            value={form.client_secret}
            onInput={(e) => set('client_secret', (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div class="form-field">
        <label for="oidc-domains">Allowed email domains</label>
        <div class="api-key-input-row">
          <input
            id="oidc-domains"
            type="text"
            placeholder="example.com, example.org"
            value={form.domains}
            onInput={(e) => set('domains', (e.target as HTMLInputElement).value)}
          />
        </div>
        <p class="field-description">
          Empty allows anyone. Otherwise only a verified email in one of these domains may log in, link or
          sign up.
        </p>
      </div>
      <div class="form-field">
        <label class="toggle-row">
          <input
            type="checkbox"
            checked={form.allow_signup}
            onChange={(e) => set('allow_signup', (e.target as HTMLInputElement).checked)}
          />
          Allow new accounts through this provider (within the signup mode)
        </label>
        <label class="toggle-row">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', (e.target as HTMLInputElement).checked)}
          />
          Enabled
        </label>
      </div>
      {error && <p class="error">{error}</p>}
      <div class="relay-actions">
        <button type="submit" class="generate-button" disabled={saving}>
          {saving ? 'Checking the issuer…' : 'Save provider'}
        </button>
        <button type="button" class="generate-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** The admin's single sign-on (OpenID Connect) providers: list, add, edit, delete. */
export function OidcProvidersAdmin() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryFn: fetchAdminOidcProviders, queryKey: ['adminOidcProviders'] })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['adminOidcProviders'] })
    void queryClient.invalidateQueries({ queryKey: ['oidcProviders'] })
  }

  const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) =>
    setEditing((current) => current && { ...current, form: { ...current.form, [key]: value } })

  const save = async (e: Event) => {
    e.preventDefault()
    if (!editing) return
    const { form, id } = editing
    setError(null)
    setSaving(true)
    const common = {
      allow_signup: form.allow_signup,
      allowed_email_domains: parseEmailDomains(form.domains),
      client_id: form.client_id.trim(),
      display_name: form.display_name.trim(),
      enabled: form.enabled,
      issuer: form.issuer.trim(),
      preset: form.preset || null,
      ...(form.client_secret ? { client_secret: form.client_secret } : {}),
    }
    try {
      if (id === null) {
        await addOidcProvider({ ...common, client_secret: form.client_secret, id: form.id.trim() })
      } else await updateOidcProvider(id, common)
      setEditing(null)
      refresh()
    } catch (err) {
      setError(errorText(err, 'The provider could not be saved'))
    }
    setSaving(false)
  }

  const remove = async (provider: OidcProvider) => {
    if (!window.confirm(`Delete ${provider.display_name}? Every account's link to it is removed too.`)) return
    setError(null)
    try {
      await deleteOidcProvider(provider.id)
      refresh()
    } catch (err) {
      const stranded = axios.isAxiosError(err) && err.response?.status === 409
      if (!stranded) return setError(apiErrorMessage(err, 'The provider could not be deleted'))
      const message = `${apiErrorMessage(err, 'Some users would be locked out')}. Delete anyway?`
      if (!window.confirm(message)) return
      try {
        await deleteOidcProvider(provider.id, true)
        refresh()
      } catch (forced) {
        setError(apiErrorMessage(forced, 'The provider could not be deleted'))
      }
    }
  }

  const copyRedirect = async () => {
    if (!data?.redirect_uri) return
    await navigator.clipboard.writeText(data.redirect_uri)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const providers = data?.providers ?? []

  return (
    <section class="settings-section oidc-providers-admin">
      <h2>SSO providers (OpenID Connect)</h2>
      <p class="section-description">
        Let people log in, link their account and, if you allow it, sign up with an account they have
        elsewhere (Google, Microsoft, GitLab, Keycloak…). Register the redirect URI below with the provider,
        then add its client id and secret here.{' '}
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
          Setup per provider
        </a>
      </p>

      {data && (
        <div class="form-field">
          <label for="oidc-redirect-uri">Redirect URI</label>
          <div class="invitation-url">
            <input id="oidc-redirect-uri" type="text" readOnly value={data.redirect_uri} />
            <button type="button" class="copy-button" onClick={() => void copyRedirect()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {providers.length > 0 ? (
        <ul class="relay-list">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              onEdit={() => setEditing({ form: formOf(provider), id: provider.id })}
              onDelete={() => void remove(provider)}
            />
          ))}
        </ul>
      ) : (
        <p class="field-description">No providers yet.</p>
      )}

      {!editing && (
        <div class="relay-actions">
          <button
            type="button"
            class="generate-button"
            onClick={() => setEditing({ form: emptyForm('google'), id: null })}
          >
            Add Google
          </button>
          <button
            type="button"
            class="generate-button"
            onClick={() => setEditing({ form: emptyForm(''), id: null })}
          >
            Add other provider
          </button>
        </div>
      )}

      {editing && (
        <ProviderEditor
          editing={editing}
          error={error}
          saving={saving}
          set={set}
          setEditing={setEditing}
          onSubmit={(e) => void save(e)}
          onCancel={() => {
            setEditing(null)
            setError(null)
          }}
        />
      )}

      {!editing && error && <p class="error">{error}</p>}
    </section>
  )
}
