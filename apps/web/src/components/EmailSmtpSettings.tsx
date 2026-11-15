import type { SmtpSecurity } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import type { AdminSettings } from '../state/api'

import { apiErrorMessage, fetchAdminSettings, sendAdminTestEmail, updateAdminSettings } from '../state/api'
import { emailEnabled } from '../state/auth'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'

interface SmtpForm {
  host: string
  port: string
  security: SmtpSecurity
  user: string
  password: string
  from: string
}

const smtpForm = (settings: AdminSettings): SmtpForm => ({
  from: settings.smtp_from,
  host: settings.smtp_host,
  password: '',
  port: String(settings.smtp_port),
  security: settings.smtp_security,
  user: settings.smtp_user,
})

const SECURITY_LABELS: Record<SmtpSecurity, string> = {
  none: 'None (a relay on the same host or network only)',
  starttls: 'STARTTLS (usually port 587)',
  tls: 'TLS from the start (usually port 465)',
}

/** The admin's SMTP settings and the "Send test mail" button. */
export function EmailSmtpSettings() {
  const { data: settings } = useQuery({ queryFn: fetchAdminSettings, queryKey: ['adminSettings'] })
  return settings ? <EmailSmtpSettingsForm settings={settings} /> : null
}

function EmailSmtpSettingsForm({ settings }: { settings: AdminSettings }) {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [form, setForm] = useState<SmtpForm>(() => smtpForm(settings))
  const [testTo, setTestTo] = useState('')
  const [test, setTest] = useState<
    { state: 'idle' | 'sending' } | { state: 'sent'; to: string } | { state: 'error'; error: string }
  >({ state: 'idle' })

  const set = <K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const applied = (result: AdminSettings) => {
    queryClient.setQueryData(['adminSettings'], result)
    emailEnabled.value = result.email_enabled
    setForm(smtpForm(result))
  }

  const save = async (e: Event) => {
    e.preventDefault()
    setSaveStatus({ status: 'saving' })
    try {
      applied(
        await updateAdminSettings({
          smtp_from: form.from.trim(),
          smtp_host: form.host.trim(),
          ...(form.password ? { smtp_password: form.password } : {}),
          smtp_port: Number(form.port),
          smtp_security: form.security,
          smtp_user: form.user.trim(),
        }),
      )
      setSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setSaveStatus({ error: apiErrorMessage(err, 'Failed to save'), status: 'error' })
    }
  }

  const clearPassword = async () => {
    setSaveStatus({ status: 'saving' })
    try {
      applied(await updateAdminSettings({ smtp_password: null }))
      setSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setSaveStatus({ error: apiErrorMessage(err, 'Failed to save'), status: 'error' })
    }
  }

  const sendTest = async () => {
    setTest({ state: 'sending' })
    try {
      const result = await sendAdminTestEmail(testTo.trim() ? { to: testTo.trim() } : {})
      setTest({ state: 'sent', to: result.to ?? testTo.trim() })
    } catch (err) {
      setTest({ error: apiErrorMessage(err, 'The test mail could not be sent'), state: 'error' })
    }
  }

  return (
    <section class="settings-section">
      <div class="section-header-row">
        <h2>Email (SMTP)</h2>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      <p class="section-description">
        Email lets users confirm their address and then reset a forgotten password or recover a lost passkey
        by an emailed link. Off until the host and the From address are set
        {settings.email_enabled ? '; it is on.' : '.'}
      </p>
      <form onSubmit={save}>
        <div class="form-field">
          <label for="smtp-host">SMTP host</label>
          <input
            id="smtp-host"
            type="text"
            maxLength={253}
            placeholder="smtp.example.org"
            autocapitalize="off"
            spellcheck={false}
            value={form.host}
            onInput={(e) => set('host', (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-field">
          <label for="smtp-port">Port</label>
          <input
            id="smtp-port"
            type="number"
            min="1"
            max="65535"
            required
            value={form.port}
            onInput={(e) => set('port', (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-field">
          <label for="smtp-security">Security</label>
          <select
            id="smtp-security"
            value={form.security}
            onChange={(e) => set('security', (e.target as HTMLSelectElement).value as SmtpSecurity)}
          >
            {(Object.keys(SECURITY_LABELS) as SmtpSecurity[]).map((value) => (
              <option key={value} value={value}>
                {SECURITY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div class="form-field">
          <label for="smtp-user">User name</label>
          <input
            id="smtp-user"
            type="text"
            maxLength={320}
            autoComplete="off"
            autocapitalize="off"
            spellcheck={false}
            value={form.user}
            onInput={(e) => set('user', (e.target as HTMLInputElement).value)}
          />
          <p class="field-description">Leave empty when the server needs no login.</p>
        </div>
        <div class="form-field">
          <label for="smtp-password">Password</label>
          {settings.smtp_password_set && <p class="connected-status">A password is set.</p>}
          <div class="api-key-input-row">
            <input
              id="smtp-password"
              type="password"
              autoComplete="new-password"
              placeholder={settings.smtp_password_set ? 'Enter a new password to replace it' : ''}
              value={form.password}
              onInput={(e) => set('password', (e.target as HTMLInputElement).value)}
            />
            {settings.smtp_password_set && (
              <button type="button" class="clear-button" onClick={() => void clearPassword()}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div class="form-field">
          <label for="smtp-from">From</label>
          <input
            id="smtp-from"
            type="text"
            maxLength={320}
            placeholder="Aurboda <no-reply@example.org>"
            value={form.from}
            onInput={(e) => set('from', (e.target as HTMLInputElement).value)}
          />
          <p class="field-description">
            The sender of the server&apos;s mail: an address, or a name and an address.
          </p>
        </div>
        <button type="submit" class="generate-button" disabled={saveStatus.status === 'saving'}>
          Save email settings
        </button>
      </form>

      <div class="form-field">
        <label for="smtp-test-to">Send a test mail</label>
        <div class="api-key-input-row">
          <input
            id="smtp-test-to"
            type="email"
            maxLength={254}
            placeholder="Your account email, or another address"
            value={testTo}
            onInput={(e) => setTestTo((e.target as HTMLInputElement).value)}
          />
        </div>
        <button
          type="button"
          class="generate-button"
          disabled={!settings.email_enabled || test.state === 'sending'}
          onClick={() => void sendTest()}
        >
          {test.state === 'sending' ? 'Sending…' : 'Send test mail'}
        </button>
        {test.state === 'sent' && <p class="connected-status">Sent to {test.to}.</p>}
        {test.state === 'error' && <p class="error">{test.error}</p>}
      </div>
    </section>
  )
}
