import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'
import { fetchOuraTagCodes, setTagMapping, type OuraTagTypeCode } from '../state/api'

import './TagMappingsSettings.css'

export function TagMappingsSettings() {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<{ status: 'idle' | 'saving' | 'saved'; time?: Date }>({
    status: 'idle',
  })

  const { data: tagCodes, isLoading } = useQuery({
    queryFn: fetchOuraTagCodes,
    queryKey: ['ouraTagCodes'],
  })

  // Local state for editing
  const [localMappings, setLocalMappings] = useState<Map<string, string>>(new Map())

  const mutation = useMutation({
    mutationFn: ({ tagTypeCode, name }: { tagTypeCode: string; name: string }) =>
      setTagMapping(tagTypeCode, name),
    onError: () => {
      setSaveStatus({ status: 'idle' })
    },
    onMutate: () => {
      setSaveStatus({ status: 'saving' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ouraTagCodes'] })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      setSaveStatus({ status: 'saved', time: new Date() })
    },
  })

  const handleNameChange = (tagTypeCode: string, value: string) => {
    setLocalMappings((prev) => {
      const next = new Map(prev)
      next.set(tagTypeCode, value)
      return next
    })
  }

  const handleNameBlur = (tagCode: OuraTagTypeCode) => {
    const localValue = localMappings.get(tagCode.tagTypeCode)
    const serverValue = tagCode.currentName ?? ''

    // If no local changes or value is the same, skip
    if (localValue === undefined || localValue === serverValue) {
      return
    }

    // Don't save empty values
    if (!localValue.trim()) {
      return
    }

    mutation.mutate({ name: localValue.trim(), tagTypeCode: tagCode.tagTypeCode })

    // Clear local state after save
    setLocalMappings((prev) => {
      const next = new Map(prev)
      next.delete(tagCode.tagTypeCode)
      return next
    })
  }

  const getValue = (tagCode: OuraTagTypeCode): string => {
    return localMappings.get(tagCode.tagTypeCode) ?? tagCode.currentName ?? ''
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

  const unmappedCount = tagCodes?.filter((t) => !t.currentName).length ?? 0

  return (
    <section class="settings-section tag-mappings-section">
      <div class="section-header">
        <h2>Tag Mappings</h2>
        {unmappedCount > 0 && <span class="unmapped-badge">{unmappedCount} unnamed</span>}
      </div>

      <p class="section-description">
        Set display names for Oura tags. Tags without names will show as their UUID. Changes save
        automatically.
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

      {!tagCodes || tagCodes.length === 0 ?
        <p class="no-tags">
          No Oura tags found. Tags will appear here after you sync data from your Oura ring.
        </p>
      : <div class="tag-mappings-list">
          {tagCodes.map((tagCode) => {
            const isUnmapped = !tagCode.currentName
            return (
              <div class={`tag-mapping-row ${isUnmapped ? 'unmapped' : ''}`} key={tagCode.tagTypeCode}>
                <div class="tag-info">
                  <span
                    class="tag-count"
                    title={`Used ${tagCode.count} time${tagCode.count !== 1 ? 's' : ''}`}
                  >
                    {tagCode.count}x
                  </span>
                  <span
                    class="tag-latest"
                    title={`Last used: ${new Date(tagCode.latestTime).toLocaleString()}`}
                  >
                    {formatLatestTime(tagCode.latestTime)}
                  </span>
                </div>

                <div class="tag-name-field">
                  <input
                    type="text"
                    value={getValue(tagCode)}
                    onInput={(e) =>
                      handleNameChange(tagCode.tagTypeCode, (e.target as HTMLInputElement).value)
                    }
                    onBlur={() => handleNameBlur(tagCode)}
                    placeholder="Enter tag name..."
                    class={isUnmapped ? 'unmapped' : ''}
                  />
                </div>

                <div class="tag-uuid" title={tagCode.tagTypeCode}>
                  {tagCode.tagTypeCode.slice(0, 8)}...
                </div>
              </div>
            )
          })}
        </div>
      }
    </section>
  )
}
