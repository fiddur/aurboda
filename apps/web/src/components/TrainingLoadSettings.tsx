import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'

import { fetchUserSettings, updateUserSettings } from '../state/api'
import { auth } from '../state/auth'
import { parseTimeConstant, type TimeConstantKey, withTimeConstant } from '../utils/trainingLoad'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'

const SECTION_ID = 'training-load'

const FIELDS: { key: TimeConstantKey; label: string; fallback: number; help: string }[] = [
  {
    fallback: 7,
    help: 'How quickly fatigue (ATL) follows your training. Lower reacts faster.',
    key: 'tau_acute',
    label: 'Fatigue (ATL) time constant',
  },
  {
    fallback: 42,
    help: 'How slowly fitness (CTL) builds and fades. Lower reacts faster.',
    key: 'tau_chronic',
    label: 'Fitness (CTL) time constant',
  },
]

export function TrainingLoadSettings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })
  const [drafts, setDrafts] = useState<Partial<Record<TimeConstantKey, string>>>({})
  const [status, setStatus] = useState<SaveStatus>({ status: 'idle' })
  const scrolled = useRef(false)

  useEffect(() => {
    if (scrolled.current || settings === undefined || window.location.hash !== `#${SECTION_ID}`) return
    scrolled.current = true
    document.getElementById(SECTION_ID)?.scrollIntoView({ block: 'start' })
  }, [settings])

  const stored = (key: TimeConstantKey) => settings?.training_load?.[key]?.toString() ?? ''

  const save = async (key: TimeConstantKey) => {
    const value = drafts[key]
    if (value === undefined || value === stored(key)) return
    const days = parseTimeConstant(value)
    if (days === 'invalid') {
      setStatus({ error: 'A time constant is a positive number of days', status: 'error' })
      return
    }
    setStatus({ status: 'saving' })
    try {
      const result = await updateUserSettings({
        training_load: withTimeConstant(settings?.training_load, key, days),
      })
      queryClient.setQueryData(['userSettings'], result)
      void queryClient.invalidateQueries({ queryKey: ['trainingLoadPage'] })
      setDrafts(({ [key]: _saved, ...rest }) => rest)
      setStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setStatus({ error: err instanceof Error ? err.message : 'Failed to save', status: 'error' })
    }
  }

  return (
    <SettingsSection
      id={SECTION_ID}
      title="Training load"
      description="Time constants of the Banister model behind the Training load page. Leave a field empty for the default. Changes save automatically."
      headerExtra={<SaveStatusIndicator state={status} />}
      isLoading={isLoading}
    >
      {FIELDS.map((field) => (
        <div class="form-field" key={field.key}>
          <label for={`training-load-${field.key}`}>{field.label}</label>
          <div class="input-with-unit">
            <input
              id={`training-load-${field.key}`}
              type="number"
              min="1"
              step="any"
              placeholder={field.fallback.toString()}
              value={drafts[field.key] ?? stored(field.key)}
              onInput={(e) => {
                const value = (e.target as HTMLInputElement).value
                setDrafts((current) => ({ ...current, [field.key]: value }))
              }}
              onBlur={() => void save(field.key)}
            />
            <span class="unit">days</span>
          </div>
          <p class="field-description">
            {field.help} Default {field.fallback} days.
          </p>
        </div>
      ))}
      <p class="field-description">
        See the result on the <a href="/training-load">Training load</a> page.
      </p>
    </SettingsSection>
  )
}
