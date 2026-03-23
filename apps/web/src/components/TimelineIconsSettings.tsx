/**
 * Settings component for managing timeline item icons.
 * Allows configuring emojis for activity types, exercise types, and tags.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'

import { fetchUserSettings, updateUserSettings } from '../state/api'
import { DEFAULT_ITEM_ICONS } from '../utils/emojiLookup'
import { IconInput } from './IconInput'
import { SettingsSection } from './SettingsSection'
import './TimelineIconsSettings.css'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface IconRowProps {
  iconKey: string
  label: string
  currentIcon: string | undefined
  defaultIcon: string | undefined
  onSave: (key: string, icon: string) => Promise<void>
}

function IconRow({ iconKey, label, currentIcon, defaultIcon, onSave }: IconRowProps) {
  const [localValue, setLocalValue] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    if (status !== 'saved') return
    const timer = setTimeout(() => setStatus('idle'), 3000)
    return () => clearTimeout(timer)
  }, [status])

  const displayValue = localValue ?? currentIcon ?? ''
  const isDefault = currentIcon === undefined
  const effectiveIcon = displayValue || defaultIcon || ''

  const handleBlur = async () => {
    if (localValue === undefined) return
    const trimmed = localValue.trim()

    // No change from what's saved
    if (trimmed === (currentIcon ?? '')) {
      setLocalValue(undefined)
      return
    }

    setStatus('saving')
    try {
      await onSave(iconKey, trimmed)
      setLocalValue(undefined)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  const handleIconChange = async (value: string) => {
    // If it's an uploaded icon path, save immediately
    if (value.startsWith('/api/icons/')) {
      setStatus('saving')
      try {
        await onSave(iconKey, value)
        setLocalValue(undefined)
        setStatus('saved')
      } catch {
        setStatus('error')
      }
    } else {
      setLocalValue(value)
    }
  }

  const handleReset = async () => {
    if (isDefault) return
    setStatus('saving')
    try {
      await onSave(iconKey, '')
      setLocalValue(undefined)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div class="icon-row">
      <span class="icon-row-label">{label}</span>
      <div class="icon-row-field">
        <IconInput
          value={effectiveIcon}
          onChange={(v) => void handleIconChange(v)}
          onBlur={() => void handleBlur()}
          placeholder={defaultIcon || 'none'}
          inputClass="icon-input"
          previewClass="icon-preview"
          size={16}
          disabled={status === 'saving'}
        />
        {!isDefault && (
          <button
            type="button"
            class="icon-reset-btn"
            onClick={() => void handleReset()}
            title="Reset to default"
          >
            x
          </button>
        )}
        {status === 'saving' && <span class="icon-status-saving" />}
        {status === 'saved' && <span class="icon-status-saved">&#10003;</span>}
        {status === 'error' && <span class="icon-status-error">!</span>}
      </div>
    </div>
  )
}

interface IconGroupProps {
  title: string
  items: { key: string; label: string }[]
  userIcons: Record<string, string>
  onSave: (key: string, icon: string) => Promise<void>
}

function IconGroup({ title, items, userIcons, onSave }: IconGroupProps) {
  return (
    <div class="icon-group">
      <h3>{title}</h3>
      <div class="icon-group-list">
        {items.map(({ key, label }) => (
          <IconRow
            key={key}
            iconKey={key}
            label={label}
            currentIcon={userIcons[key]}
            defaultIcon={DEFAULT_ITEM_ICONS[key]}
            onSave={onSave}
          />
        ))}
      </div>
    </div>
  )
}

const ACTIVITY_ITEMS = [
  { key: 'activity:sleep', label: 'Sleep' },
  { key: 'activity:nap', label: 'Nap' },
  { key: 'activity:meditation', label: 'Meditation' },
]

const EXERCISE_ITEMS = [
  { key: 'exercise:Biking', label: 'Biking' },
  { key: 'exercise:Boot Camp', label: 'Boot Camp' },
  { key: 'exercise:Calisthenics', label: 'Calisthenics' },
  { key: 'exercise:Dancing', label: 'Dancing' },
  { key: 'exercise:Elliptical', label: 'Elliptical' },
  { key: 'exercise:HIIT', label: 'HIIT' },
  { key: 'exercise:Hiking', label: 'Hiking' },
  { key: 'exercise:Ice Skating', label: 'Ice Skating' },
  { key: 'exercise:Pilates', label: 'Pilates' },
  { key: 'exercise:Rock Climbing', label: 'Rock Climbing' },
  { key: 'exercise:Rowing', label: 'Rowing' },
  { key: 'exercise:Running', label: 'Running' },
  { key: 'exercise:Soccer', label: 'Soccer' },
  { key: 'exercise:Stair Climbing', label: 'Stair Climbing' },
  { key: 'exercise:Strength Training', label: 'Strength Training' },
  { key: 'exercise:Stretching', label: 'Stretching' },
  { key: 'exercise:Swimming (Open Water)', label: 'Swimming (Open Water)' },
  { key: 'exercise:Swimming (Pool)', label: 'Swimming (Pool)' },
  { key: 'exercise:Treadmill', label: 'Treadmill' },
  { key: 'exercise:Walking', label: 'Walking' },
  { key: 'exercise:Weightlifting', label: 'Weightlifting' },
  { key: 'exercise:Workout', label: 'Workout (default)' },
  { key: 'exercise:Yoga', label: 'Yoga' },
]

export function TimelineIconsSettings() {
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    enabled: true,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const userIcons = useMemo(() => settings?.item_icons ?? {}, [settings])

  const handleSave = useCallback(
    async (key: string, icon: string) => {
      const current = settings?.item_icons ?? {}
      let newIcons: Record<string, string>
      if (icon === '') {
        // Remove the key to revert to default
        newIcons = Object.fromEntries(Object.entries(current).filter(([k]) => k !== key))
      } else {
        newIcons = { ...current, [key]: icon }
      }
      const result = await updateUserSettings({ item_icons: newIcons })
      queryClient.setQueryData(['userSettings'], result)
      // Also invalidate tag-mappings since icons come from there too
      queryClient.invalidateQueries({ queryKey: ['tag-mappings'] })
    },
    [settings, queryClient],
  )

  return (
    <SettingsSection
      title="Timeline Icons"
      class="timeline-icons-section"
      description="Customize the icons shown on the timeline for activities and exercise types. Icons can be emoji characters, image URLs, or uploaded images. Default emojis are shown as placeholders."
      isLoading={isLoading}
    >
      <IconGroup title="Activities" items={ACTIVITY_ITEMS} userIcons={userIcons} onSave={handleSave} />
      <IconGroup title="Exercise Types" items={EXERCISE_ITEMS} userIcons={userIcons} onSave={handleSave} />
    </SettingsSection>
  )
}
