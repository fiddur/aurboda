import type { ProgrammaticTag } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'
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

export function TagMappingsSettings() {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<{ status: 'idle' | 'saving' | 'saved'; time?: Date }>({
    status: 'idle',
  })

  const { data: tags, isLoading } = useQuery({
    queryFn: fetchProgrammaticTags,
    queryKey: ['programmaticTags'],
  })

  // Local state for editing
  const [localMappings, setLocalMappings] = useState<Map<string, string>>(new Map())

  const mutation = useMutation({
    mutationFn: ({ tagKey, name }: { tagKey: string; name: string }) => setTagMapping(tagKey, name),
    onError: () => {
      setSaveStatus({ status: 'idle' })
    },
    onMutate: () => {
      setSaveStatus({ status: 'saving' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programmaticTags'] })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      setSaveStatus({ status: 'saved', time: new Date() })
    },
  })

  const handleNameChange = (tagKey: string, value: string) => {
    setLocalMappings((prev) => {
      const next = new Map(prev)
      next.set(tagKey, value)
      return next
    })
  }

  const handleNameBlur = (tag: ProgrammaticTag) => {
    const localValue = localMappings.get(tag.tagKey)
    const serverValue = tag.currentName ?? ''

    // If no local changes or value is the same, skip
    if (localValue === undefined || localValue === serverValue) {
      return
    }

    // Don't save empty values
    if (!localValue.trim()) {
      return
    }

    mutation.mutate({ name: localValue.trim(), tagKey: tag.tagKey })

    // Clear local state after save
    setLocalMappings((prev) => {
      const next = new Map(prev)
      next.delete(tag.tagKey)
      return next
    })
  }

  const getValue = (tag: ProgrammaticTag): string => {
    return localMappings.get(tag.tagKey) ?? tag.currentName ?? ''
  }

  const formatLatestTime = (isoTime: string): string => {
    const date = new Date(isoTime)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString()
  }

  const formatSavedTime = (time: Date): string => {
    const now = new Date()
    const diffSec = Math.floor((now.getTime() - time.getTime()) / 1000)
    if (diffSec < 5) return 'just now'
    if (diffSec < 60) return `${diffSec} seconds ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`
    return time.toLocaleTimeString()
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
        raw identifier. Changes save automatically.
      </p>

      {saveStatus.status === 'saving' && <p class="save-status saving">Saving...</p>}
      {saveStatus.status === 'saved' && saveStatus.time && (
        <p class="save-status saved">Saved {formatSavedTime(saveStatus.time)}</p>
      )}
      {mutation.isError && (
        <p class="save-status error">
          Error: {mutation.error instanceof Error ? mutation.error.message : 'Failed to save'}
        </p>
      )}

      {!tags || tags.length === 0 ?
        <p class="no-tags">No programmatic tags found. Tags will appear here after syncing data.</p>
      : <div class="tag-mappings-list">
          {tags.map((tag) => {
            const isUnmapped = !tag.currentName
            return (
              <div class={`tag-mapping-row ${isUnmapped ? 'unmapped' : ''}`} key={tag.tagKey}>
                <div class="tag-info">
                  <span class="tag-count" title={`Used ${tag.count} time${tag.count !== 1 ? 's' : ''}`}>
                    {tag.count}x
                  </span>
                  <span class="tag-latest" title={`Last used: ${new Date(tag.latestTime).toLocaleString()}`}>
                    {formatLatestTime(tag.latestTime)}
                  </span>
                </div>

                <div class="tag-name-field">
                  <input
                    type="text"
                    value={getValue(tag)}
                    onInput={(e) => handleNameChange(tag.tagKey, (e.target as HTMLInputElement).value)}
                    onBlur={() => handleNameBlur(tag)}
                    placeholder="Enter tag name..."
                    class={isUnmapped ? 'unmapped' : ''}
                  />
                </div>

                <div class="tag-uuid" title={tag.tagKey}>
                  {formatTagKey(tag.tagKey)}
                </div>
              </div>
            )
          })}
        </div>
      }
    </section>
  )
}
