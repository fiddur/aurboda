import type { ProgrammaticTag } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'
import { fetchProgrammaticTags, fetchTagMappings, setTagMapping } from '../state/api'
import { isEmoji, isUrl, suggestEmoji } from '../utils/emojiLookup'

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

type RowStatus = 'idle' | 'saving' | 'saved' | 'error'

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
  const [status, setStatus] = useState<RowStatus>('idle')
  const [suggestedEmoji, setSuggestedEmoji] = useState<string | undefined>(undefined)

  // Clear saved indicator after 3 seconds
  useEffect(() => {
    if (status !== 'saved') return
    const timer = setTimeout(() => setStatus('idle'), 3000)
    return () => clearTimeout(timer)
  }, [status])

  const displayValue = localValue ?? tag.current_name ?? ''
  const displayIcon = localIcon ?? currentIcon ?? ''
  const isUnmapped = !tag.current_name

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
    if (localValue === undefined && localIcon === undefined) return

    const serverName = tag.current_name ?? ''
    const nameChanged = localValue !== undefined && localValue !== serverName
    const iconChanged = localIcon !== undefined && localIcon !== (currentIcon ?? '')

    if (!nameChanged && !iconChanged) {
      setLocalValue(undefined)
      setLocalIcon(undefined)
      return
    }

    const name = (localValue ?? tag.current_name ?? '').trim()
    if (!name) {
      setLocalValue(undefined)
      setLocalIcon(undefined)
      return
    }

    setStatus('saving')
    try {
      await onSave(tag.tag_key, name, iconChanged ? localIcon : undefined)
      setLocalValue(undefined)
      setLocalIcon(undefined)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  const handleAcceptSuggestion = async () => {
    if (!suggestedEmoji) return

    const name = (localValue ?? tag.current_name ?? '').trim()
    if (!name) return

    setSuggestedEmoji(undefined)
    setStatus('saving')
    try {
      await onSave(tag.tag_key, name, suggestedEmoji)
      setLocalValue(undefined)
      setLocalIcon(undefined)
      setStatus('saved')
    } catch {
      setLocalIcon(suggestedEmoji)
      setStatus('error')
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
          {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div class="tag-name-field">
        <input
          type="text"
          value={displayValue}
          onInput={(e) => setLocalValue((e.target as HTMLInputElement).value)}
          onBlur={() => void handleBlur()}
          placeholder="Enter display name..."
          class={isUnmapped ? 'unmapped' : ''}
          disabled={status === 'saving'}
        />
        <span class="row-status">
          {status === 'saving' && <span class="status-saving" title="Saving..." />}
          {status === 'saved' && (
            <span class="status-saved" title="Saved">
              &#10003;
            </span>
          )}
          {status === 'error' && (
            <span class="status-error" title="Failed to save">
              !
            </span>
          )}
        </span>
      </div>

      <div class="tag-icon-field">
        <input
          type="text"
          value={displayIcon}
          onInput={(e) => setLocalIcon((e.target as HTMLInputElement).value)}
          onBlur={() => void handleBlur()}
          placeholder="Icon"
          title="Emoji character or image URL"
          class="tag-icon-input"
          disabled={status === 'saving'}
        />
        {displayIcon && (isEmoji(displayIcon) || isUrl(displayIcon)) && (
          <span class="tag-icon-preview">
            {isEmoji(displayIcon) ? displayIcon : <img src={displayIcon} alt="icon" width="16" height="16" />}
          </span>
        )}
        {suggestedEmoji && !displayIcon && (
          <button
            type="button"
            class="tag-icon-suggestion"
            onClick={handleAcceptSuggestion}
            title={`Suggested: ${suggestedEmoji}`}
          >
            {suggestedEmoji}?
          </button>
        )}
      </div>

      <div class="tag-uuid" title={tag.tag_key}>
        {formatTagKey(tag.tag_key)}
      </div>
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

  if (isLoading) {
    return (
      <section class="settings-section tag-mappings-section">
        <h2>Tag Mappings</h2>
        <p class="loading">Loading tags...</p>
      </section>
    )
  }

  const unmappedCount = tags?.filter((t) => !t.current_name).length ?? 0
  const icons = mappingsData?.icons ?? {}

  return (
    <section class="settings-section tag-mappings-section">
      <div class="section-header">
        <h2>Tag Mappings</h2>
        {unmappedCount > 0 && <span class="unmapped-badge">{unmappedCount} unnamed</span>}
      </div>

      <p class="section-description">
        Set display names and icons for programmatic tags. Icons can be emoji characters or image URLs.
        Changes save automatically when you leave the field.
      </p>

      {!tags || tags.length === 0 ?
        <p class="no-tags">No programmatic tags found. Tags will appear here after syncing data.</p>
      : <div class="tag-mappings-list">
          {tags.map((tag) => (
            <TagMappingRow
              key={tag.tag_key}
              tag={tag}
              currentIcon={icons[tag.current_name ?? ''] ?? icons[tag.tag_key]}
              onSave={handleSave}
            />
          ))}
        </div>
      }
    </section>
  )
}
