/**
 * Activity type settings section — edit icon and save.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { IconInput } from '../../components/IconInput'
import { SaveCancelRow } from '../../components/SaveCancelRow'
import { useSaveStatus } from '../../components/SaveStatusIndicator'
import { fetchItemIcons, updateUserSettings } from '../../state/api'
import { suggestEmoji } from '../../utils/emojiLookup'

interface TagSettingsSectionProps {
  effectiveTagKey: string
  currentName: string
  currentIcon: string
}

export function TagSettingsSection({ effectiveTagKey, currentName, currentIcon }: TagSettingsSectionProps) {
  const queryClient = useQueryClient()
  const [iconValue, setIconValue] = useState<string | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  const saveMutation = useMutation({
    mutationFn: async ({ icon }: { icon?: string }) => {
      const icons = await fetchItemIcons()
      const newIcons = { ...icons }
      if (icon) {
        newIcons[currentName] = icon
      } else {
        delete newIcons[currentName]
        delete newIcons[effectiveTagKey]
      }
      await updateUserSettings({ item_icons: newIcons })
    },
    onError: () => setSaveStatus({ status: 'error' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['activity-type-definitions'] })
      queryClient.invalidateQueries({ queryKey: ['item-icons'] })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      setIconValue(undefined)
    },
  })

  const suggested = suggestEmoji(currentName)
  const shownIcon = iconValue ?? currentIcon

  const handleSave = () => {
    setSaveStatus({ status: 'saving' })
    const iconChanged = iconValue !== undefined && iconValue !== currentIcon
    saveMutation.mutate({ icon: iconChanged ? iconValue : undefined })
  }

  const hasChanges = iconValue !== undefined && iconValue !== currentIcon

  return (
    <section class="tag-meta-section">
      <h2>Settings</h2>
      <div class="tag-meta-settings-grid">
        <label>
          <span class="tag-meta-field-label">Display Name</span>
          <input type="text" value={currentName} disabled readOnly />
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
        {effectiveTagKey !== currentName && (
          <div class="tag-meta-key-display">
            <span class="tag-meta-field-label">Type Key</span>
            <code>{effectiveTagKey}</code>
          </div>
        )}
      </div>
      {hasChanges && (
        <SaveCancelRow
          onSave={handleSave}
          onCancel={() => setIconValue(undefined)}
          isPending={saveMutation.isPending}
          saveStatus={saveStatus}
          saveStatusVariant="compact"
        />
      )}
    </section>
  )
}
