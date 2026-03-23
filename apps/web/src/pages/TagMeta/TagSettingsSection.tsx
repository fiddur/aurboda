/**
 * Tag settings section — edit display name, icon, and save.
 */
import type { ProgrammaticTag } from '@aurboda/api-spec'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { IconInput } from '../../components/IconInput'
import { setTagMapping } from '../../state/api'
import { suggestEmoji } from '../../utils/emojiLookup'

interface TagSettingsSectionProps {
  tagInfo: ProgrammaticTag | undefined
  effectiveTagKey: string
  currentName: string
  currentIcon: string
}

// eslint-disable-next-line complexity -- settings form with icon/name editing
export function TagSettingsSection({
  tagInfo,
  effectiveTagKey,
  currentName,
  currentIcon,
}: TagSettingsSectionProps) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState<string | undefined>(undefined)
  const [iconValue, setIconValue] = useState<string | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const saveMutation = useMutation({
    mutationFn: ({ name, icon }: { name: string; icon?: string }) =>
      setTagMapping(effectiveTagKey, name, icon),
    onError: () => setSaveStatus('error'),
    onSuccess: () => {
      setSaveStatus('saved')
      queryClient.invalidateQueries({ queryKey: ['programmaticTags'] })
      queryClient.invalidateQueries({ queryKey: ['tag-mappings'] })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      setDisplayName(undefined)
      setIconValue(undefined)
    },
  })

  // Clear saved indicator
  useEffect(() => {
    if (saveStatus !== 'saved') return
    const timer = setTimeout(() => setSaveStatus('idle'), 3000)
    return () => clearTimeout(timer)
  }, [saveStatus])

  const suggested = suggestEmoji(currentName)
  const shownIcon = iconValue ?? currentIcon
  const shownName = displayName ?? currentName

  const handleSave = () => {
    const name = (displayName ?? currentName).trim()
    if (!name) return
    setSaveStatus('saving')
    const iconChanged = iconValue !== undefined && iconValue !== currentIcon
    saveMutation.mutate({ icon: iconChanged ? iconValue : undefined, name })
  }

  const hasChanges =
    (displayName !== undefined && displayName !== currentName) ||
    (iconValue !== undefined && iconValue !== currentIcon)

  return (
    <section class="tag-meta-section">
      <h2>Settings</h2>
      <div class="tag-meta-settings-grid">
        <label>
          <span class="tag-meta-field-label">Display Name</span>
          <input
            type="text"
            value={shownName}
            onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
            placeholder="Display name..."
            disabled={tagInfo ? !tagInfo.is_programmatic : false}
            readOnly={tagInfo ? !tagInfo.is_programmatic : false}
          />
          {tagInfo && !tagInfo.is_programmatic && (
            <span class="tag-meta-field-hint">Non-programmatic tags use their name directly</span>
          )}
        </label>
        <label>
          <span class="tag-meta-field-label">Icon</span>
          <div class="tag-meta-icon-row">
            <IconInput
              value={shownIcon}
              onChange={setIconValue}
              suggestedEmoji={suggested}
              previewClass="tag-meta-icon-preview"
            />
          </div>
        </label>
        {tagInfo?.is_programmatic && effectiveTagKey !== currentName && (
          <div class="tag-meta-key-display">
            <span class="tag-meta-field-label">Tag Key</span>
            <code>{effectiveTagKey}</code>
          </div>
        )}
      </div>
      {hasChanges && (
        <div class="tag-meta-save-row">
          <button type="button" class="btn-primary" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            class="btn-secondary"
            onClick={() => {
              setDisplayName(undefined)
              setIconValue(undefined)
            }}
          >
            Cancel
          </button>
          {saveStatus === 'saved' && <span class="tag-meta-status-saved">Saved</span>}
          {saveStatus === 'error' && <span class="tag-meta-status-error">Failed to save</span>}
        </div>
      )}
    </section>
  )
}
