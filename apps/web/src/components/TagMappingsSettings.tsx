import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import {
  fetchActivityTypeDefinitions,
  fetchItemIcons,
  updateUserSettings,
  type ActivityTypeDefinition,
} from '../state/api'
import { suggestEmoji } from '../utils/emojiLookup'
import { IconInput } from './IconInput'
import { SaveStatusIndicator, useSaveStatus } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'
import './TagMappingsSettings.css'

function ActivityTypeMappingRow({
  def,
  currentIcon,
  onSave,
}: {
  def: ActivityTypeDefinition
  currentIcon?: string
  onSave: (name: string, icon?: string) => Promise<void>
}) {
  const [localIcon, setLocalIcon] = useState<string | undefined>(undefined)
  const [status, setStatus] = useSaveStatus(3000)

  const displayIcon = localIcon ?? currentIcon ?? ''
  const displayName = def.display_name || def.name
  const suggestion = !currentIcon && localIcon === undefined ? suggestEmoji(displayName) : undefined

  const handleBlur = async () => {
    if (localIcon === undefined || localIcon === (currentIcon ?? '')) {
      setLocalIcon(undefined)
      return
    }
    setStatus({ status: 'saving' })
    try {
      await onSave(displayName, localIcon || undefined)
      setLocalIcon(undefined)
      setStatus({ status: 'saved' })
    } catch {
      setStatus({ status: 'error' })
    }
  }

  const handleAcceptSuggestion = async () => {
    if (!suggestion) return
    setStatus({ status: 'saving' })
    try {
      await onSave(displayName, suggestion)
      setLocalIcon(undefined)
      setStatus({ status: 'saved' })
    } catch {
      setLocalIcon(suggestion)
      setStatus({ status: 'error' })
    }
  }

  return (
    <div class="tag-mapping-row">
      <div class="tag-info">
        <span class="tag-count">{def.display_category}</span>
        <span class="tag-latest">{def.is_builtin ? 'Built-in' : 'Custom'}</span>
      </div>

      <div class="tag-name-field">
        <input type="text" value={displayName} disabled readOnly class="" />
        <SaveStatusIndicator state={status} variant="compact" />
      </div>

      <div class="tag-icon-field">
        <IconInput
          value={displayIcon}
          onChange={setLocalIcon}
          onBlur={() => void handleBlur()}
          placeholder="Icon"
          inputClass="tag-icon-input"
          previewClass="tag-icon-preview"
          size={16}
          suggestedEmoji={suggestion}
          onAcceptSuggestion={() => void handleAcceptSuggestion()}
          disabled={status.status === 'saving'}
        />
      </div>

      {!def.is_builtin && (
        <div class="tag-uuid" title={def.name}>
          {def.name}
        </div>
      )}
    </div>
  )
}

export function TagMappingsSettings() {
  const queryClient = useQueryClient()

  const { data: defs, isLoading } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
  })

  const { data: icons = {} } = useQuery({
    queryFn: fetchItemIcons,
    queryKey: ['item-icons'],
    staleTime: 30 * 60 * 1000,
  })

  const mutation = useMutation({
    mutationFn: async ({ name, icon }: { name: string; icon?: string }) => {
      const currentIcons = { ...icons }
      if (icon) {
        currentIcons[name] = icon
      } else {
        delete currentIcons[name]
      }
      await updateUserSettings({ item_icons: currentIcons })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activity-type-definitions'] })
      queryClient.invalidateQueries({ queryKey: ['item-icons'] })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
    },
  })

  const handleSave = async (name: string, icon?: string): Promise<void> => {
    await mutation.mutateAsync({ icon, name })
  }

  return (
    <SettingsSection
      title="Activity Type Icons"
      class="tag-mappings-section"
      description="Set icons for activity types. Icons can be emoji characters or image URLs. Changes save automatically when you leave the field."
      isLoading={isLoading}
      loadingMessage="Loading activity types..."
      isEmpty={!defs || defs.length === 0}
      emptyMessage="No activity types found. Types will appear here after syncing data."
    >
      <div class="tag-mappings-list">
        {(defs ?? []).map((def) => (
          <ActivityTypeMappingRow
            key={def.name}
            def={def}
            currentIcon={icons[def.display_name || def.name] ?? icons[def.name]}
            onSave={handleSave}
          />
        ))}
      </div>
    </SettingsSection>
  )
}
