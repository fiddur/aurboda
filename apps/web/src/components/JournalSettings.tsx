import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchUserSettings, updateUserSettings } from '../state/api'
import { auth } from '../state/auth'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'

export function JournalSettings() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })
  const [status, setStatus] = useState<SaveStatus>({ status: 'idle' })
  const [saving, setSaving] = useState<boolean | null>(null)
  const strip = saving ?? settings?.journal_strip_metadata ?? false

  const save = async (next: boolean) => {
    setSaving(next)
    setStatus({ status: 'saving' })
    try {
      const result = await updateUserSettings({ journal_strip_metadata: next })
      queryClient.setQueryData(['userSettings'], result)
      setStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setStatus({ error: err instanceof Error ? err.message : 'Failed to save', status: 'error' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <SettingsSection id="journal" title="Journal" headerExtra={<SaveStatusIndicator state={status} />}>
      <div class="form-field">
        <label class="checkbox-field">
          <input
            type="checkbox"
            checked={strip}
            onChange={(e) => void save((e.target as HTMLInputElement).checked)}
          />
          <span>Remove metadata from Journal pictures</span>
        </label>
        <p class="field-description">
          Pictures you add to the Journal keep the details stored in the file, such as when and where they
          were taken. Turn this on to remove them from pictures you add from now on. Recordings are always
          stored as they are.
        </p>
      </div>
    </SettingsSection>
  )
}
