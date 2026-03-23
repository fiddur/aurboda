import type { ProgrammaticTag } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { fetchProgrammaticTags, fetchTagMappings, setTagMapping } from '../state/api'
import { suggestEmoji } from '../utils/emojiLookup'
import { IconInput } from './IconInput'
import { SaveStatusIndicator, useSaveStatus } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'
import './TagMappingsSettings.css'

// Helper to check if a string is a UUID
const isUuid = (str: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)

// Format tag key for display - show truncated UUID or the key itself
const formatTagKey = (tagKey: string): string => {
  if (isUuid(tagKey)) {
    return `${tagKey.slice(0, 8)}...`
  }
  return tagKey
}

/** Determine what changed vs server state and return the name to save, or null if no save needed. */
function getBlurSavePayload(
  localValue: string | undefined,
  localIcon: string | undefined,
  currentName: string | null | undefined,
  currentIcon: string | null | undefined,
): { name: string; iconChanged: boolean } | null {
  if (localValue === undefined && localIcon === undefined) return null

  const serverName = currentName ?? ''
  const nameChanged = localValue !== undefined && localValue !== serverName
  const iconChanged = localIcon !== undefined && localIcon !== (currentIcon ?? '')
  if (!nameChanged && !iconChanged) return null

  const name = (localValue ?? currentName ?? '').trim()
  if (!name) return null

  return { iconChanged, name }
}

function TagMappingRow({
  currentIcon,
  onSave,
  tag,
}: {
  tag: ProgrammaticTag
  currentIcon?: string
  onSave: (tagKey: string, name: string, icon?: string) => Promise<void>
}) {
  const [localValue, setLocalValue] = useState<string | undefined>(undefined)
  const [localIcon, setLocalIcon] = useState<string | undefined>(undefined)
  const [status, setStatus] = useSaveStatus(3000)
  const [suggestedEmoji, setSuggestedEmoji] = useState<string | undefined>(undefined)

  const isProgrammatic = tag.is_programmatic

  const displayValue = localValue ?? tag.current_name ?? ''
  const displayIcon = localIcon ?? currentIcon ?? ''
  const isUnmapped = isProgrammatic && !tag.current_name

  // Auto-suggest emoji when name changes
  useEffect(() => {
    const name = localValue ?? tag.current_name
    if (name && !currentIcon && localIcon === undefined) {
      const suggestion = suggestEmoji(name)
      setSuggestedEmoji(suggestion)
    } else {
      setSuggestedEmoji(undefined)
    }
  }, [localValue, tag.current_name, currentIcon, localIcon])

  const handleBlur = async () => {
    const payload = getBlurSavePayload(localValue, localIcon, tag.current_name, currentIcon)
    if (!payload) {
      setLocalValue(undefined)
      setLocalIcon(undefined)
      return
    }

    setStatus({ status: 'saving' })
    try {
      await onSave(tag.tag_key, payload.name, payload.iconChanged ? localIcon : undefined)
      setLocalValue(undefined)
      setLocalIcon(undefined)
      setStatus({ status: 'saved' })
    } catch {
      setStatus({ status: 'error' })
    }
  }

  const handleAcceptSuggestion = async () => {
    if (!suggestedEmoji) return

    const name = (localValue ?? tag.current_name ?? '').trim()
    if (!name) return

    setSuggestedEmoji(undefined)
    setStatus({ status: 'saving' })
    try {
      await onSave(tag.tag_key, name, suggestedEmoji)
      setLocalValue(undefined)
      setLocalIcon(undefined)
      setStatus({ status: 'saved' })
    } catch {
      setLocalIcon(suggestedEmoji)
      setStatus({ status: 'error' })
    }
  }

  const date = new Date(tag.latest_time)

  return (
    <div class={`tag-mapping-row ${isUnmapped ? 'unmapped' : ''}`}>
      <div class="tag-info">
        <span class="tag-count" title={`Used ${tag.count} time${tag.count !== 1 ? 's' : ''}`}>
          {tag.count} uses
        </span>
        <span class="tag-latest">
          Last: {date.toLocaleDateString()}{' '}
          {date.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      <div class="tag-name-field">
        <input
          type="text"
          value={displayValue}
          onInput={(e) => setLocalValue((e.target as HTMLInputElement).value)}
          onBlur={() => void handleBlur()}
          placeholder={isProgrammatic ? 'Enter display name...' : undefined}
          class={isUnmapped ? 'unmapped' : ''}
          disabled={status.status === 'saving' || !isProgrammatic}
          readOnly={!isProgrammatic}
        />
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
          suggestedEmoji={suggestedEmoji}
          onAcceptSuggestion={() => void handleAcceptSuggestion()}
          disabled={status.status === 'saving'}
        />
      </div>

      {isProgrammatic && (
        <div class="tag-uuid" title={tag.tag_key}>
          {formatTagKey(tag.tag_key)}
        </div>
      )}
    </div>
  )
}

export function TagMappingsSettings() {
  const queryClient = useQueryClient()

  const { data: tags, isLoading } = useQuery({
    queryFn: fetchProgrammaticTags,
    queryKey: ['programmaticTags'],
  })

  const { data: mappingsData } = useQuery({
    queryFn: fetchTagMappings,
    queryKey: ['tag-mappings'],
    staleTime: 30 * 60 * 1000,
  })

  const mutation = useMutation({
    mutationFn: ({ tagKey, name, icon }: { tagKey: string; name: string; icon?: string }) =>
      setTagMapping(tagKey, name, icon),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programmaticTags'] })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      queryClient.invalidateQueries({ queryKey: ['tag-mappings'] })
    },
  })

  const handleSave = async (tagKey: string, name: string, icon?: string): Promise<void> => {
    await mutation.mutateAsync({ icon, name, tagKey })
  }

  const unmappedCount = tags?.filter((t) => t.is_programmatic && !t.current_name).length ?? 0
  const icons = mappingsData?.icons ?? {}

  return (
    <SettingsSection
      title="Tag Mappings"
      class="tag-mappings-section"
      description="Set display names for programmatic tags and icons for any tag. Icons can be emoji characters or image URLs. Changes save automatically when you leave the field."
      headerExtra={unmappedCount > 0 && <span class="unmapped-badge">{unmappedCount} unnamed</span>}
      isLoading={isLoading}
      loadingMessage="Loading tags..."
      isEmpty={!tags || tags.length === 0}
      emptyMessage="No tags found. Tags will appear here after syncing data."
    >
      <div class="tag-mappings-list">
        {(tags ?? []).map((tag) => (
          <TagMappingRow
            key={tag.tag_key}
            tag={tag}
            currentIcon={icons[tag.current_name ?? ''] ?? icons[tag.tag_key]}
            onSave={handleSave}
          />
        ))}
      </div>
    </SettingsSection>
  )
}
