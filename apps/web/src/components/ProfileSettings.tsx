import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'preact/hooks'

import { fetchMyEmail, fetchUserSettings, updateMyEmail, updateUserSettings } from '../state/api'
import { apiErrorText } from '../utils/profile'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'

const saveError = (err: unknown): string =>
  axios.isAxiosError(err)
    ? apiErrorText((err.response?.data as { error?: unknown } | undefined)?.error, err.message)
    : err instanceof Error
      ? err.message
      : 'Failed to save'

/** Display name (a user setting, federated) and email (private, on the account). */
export function ProfileSettings() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({ queryFn: fetchUserSettings, queryKey: ['userSettings'] })
  const { data: emailData } = useQuery({ queryFn: fetchMyEmail, queryKey: ['myEmail'] })

  const [displayName, setDisplayName] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [status, setStatus] = useState<SaveStatus>({ status: 'idle' })

  const storedName = settings?.display_name ?? ''
  const storedEmail = emailData?.email ?? ''
  const nameValue = displayName ?? storedName
  const emailValue = email ?? storedEmail

  const save = async (run: () => Promise<void>) => {
    setStatus({ status: 'saving' })
    try {
      await run()
      setStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setStatus({ error: saveError(err), status: 'error' })
    }
  }

  const onNameBlur = () => {
    const trimmed = nameValue.trim()
    if (trimmed === storedName) return
    void save(async () => {
      const result = await updateUserSettings({ display_name: trimmed || null })
      queryClient.setQueryData(['userSettings'], result)
      setDisplayName(null)
    })
  }

  const onEmailBlur = (e: Event) => {
    const trimmed = emailValue.trim()
    if (trimmed === storedEmail) return
    if (!(e.target as HTMLInputElement).checkValidity()) {
      setStatus({ error: 'Not a valid email address', status: 'error' })
      return
    }
    void save(async () => {
      const result = await updateMyEmail({ email: trimmed || null })
      queryClient.setQueryData(['myEmail'], result)
      setEmail(null)
    })
  }

  return (
    <SettingsSection title="Profile" headerExtra={<SaveStatusIndicator state={status} />}>
      <div class="form-field">
        <label for="display-name">Display name</label>
        <input
          id="display-name"
          type="text"
          autoComplete="name"
          maxLength={100}
          value={nameValue}
          onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
          onBlur={onNameBlur}
        />
        <p class="field-description">Shown on your profile and posts. Leave empty to show your username.</p>
      </div>

      <div class="form-field">
        <label for="email">Email (optional)</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={emailValue}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          onBlur={onEmailBlur}
        />
        <p class="field-description">
          Private: only you and the server&apos;s admins see it. Used for account recovery and plan reminders
          once those exist.
        </p>
      </div>
    </SettingsSection>
  )
}
