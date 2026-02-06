import type { ProgrammaticTag } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'
import { fetchProgrammaticTags, setTagMapping } from '../state/api'

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
  onSave,
  tag,
}: {
  tag: ProgrammaticTag
  onSave: (tagKey: string, name: string) => Promise<void>
}) {
  const [localValue, setLocalValue] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<RowStatus>('idle')

  // Clear saved indicator after 3 seconds
  useEffect(() => {
    if (status !== 'saved') return
    const timer = setTimeout(() => setStatus('idle'), 3000)
    return () => clearTimeout(timer)
  }, [status])

  const displayValue = localValue ?? tag.currentName ?? ''
  const isUnmapped = !tag.currentName

  const handleBlur = async () => {
    if (localValue === undefined) return

    const serverValue = tag.currentName ?? ''
    if (localValue === serverValue) {
      setLocalValue(undefined)
      return
    }

    if (!localValue.trim()) {
      setLocalValue(undefined)
      return
    }

    setStatus('saving')
    try {
      await onSave(tag.tagKey, localValue.trim())
      setLocalValue(undefined)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  const date = new Date(tag.latestTime)

  return (
    <div class={`tag-mapping-row ${isUnmapped ? 'unmapped' : ''}`}>
      <div class="tag-info">
        <span class="tag-count" title={`Used ${tag.count} time${tag.count !== 1 ? 's' : ''}`}>
          {tag.count} uses
        </span>
        <span class="tag-latest" title={date.toLocaleString()}>
          Last: {date.toLocaleDateString()}
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

      <div class="tag-uuid" title={tag.tagKey}>
        {formatTagKey(tag.tagKey)}
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

  const mutation = useMutation({
    mutationFn: ({ tagKey, name }: { tagKey: string; name: string }) => setTagMapping(tagKey, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programmaticTags'] })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
    },
  })

  const handleSave = async (tagKey: string, name: string): Promise<void> => {
    await mutation.mutateAsync({ name, tagKey })
  }

  if (isLoading) {
    return (
      <section class="settings-section tag-mappings-section">
        <h2>Tag Mappings</h2>
        <p class="loading">Loading tags...</p>
      </section>
    )
  }

  const unmappedCount = tags?.filter((t) => !t.currentName).length ?? 0

  return (
    <section class="settings-section tag-mappings-section">
      <div class="section-header">
        <h2>Tag Mappings</h2>
        {unmappedCount > 0 && <span class="unmapped-badge">{unmappedCount} unnamed</span>}
      </div>

      <p class="section-description">
        Set display names for programmatic tags (UUIDs, tag_* prefixes). Tags without names will show their
        raw identifier. Changes save automatically when you leave the field.
      </p>

      {!tags || tags.length === 0 ?
        <p class="no-tags">No programmatic tags found. Tags will appear here after syncing data.</p>
      : <div class="tag-mappings-list">
          {tags.map((tag) => (
            <TagMappingRow key={tag.tagKey} tag={tag} onSave={handleSave} />
          ))}
        </div>
      }
    </section>
  )
}
