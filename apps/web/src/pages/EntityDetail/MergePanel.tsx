/**
 * Panel for selecting nearby activities to merge with the current activity.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import type { Activity } from '../../state/api'

import { fetchNearbyActivities, mergeActivities } from '../../state/api'
import { formatDateTimeLocal } from './format-utils'

const formatDuration = (start: Date, end?: Date): string => {
  if (!end) return ''
  const mins = Math.round((end.getTime() - start.getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

interface MergePanelProps {
  activityId: string
  onCancel: () => void
}

export const MergePanel = ({ activityId, onCancel }: MergePanelProps) => {
  const { route } = useLocation()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const nearbyQuery = useQuery({
    queryFn: () => fetchNearbyActivities(activityId),
    queryKey: ['nearbyActivities', activityId],
  })

  const mergeMutation = useMutation({
    mutationFn: () => mergeActivities([activityId, ...selected]),
    onSuccess: (merged) => {
      if (merged.id) {
        route(`/detail/activity/${merged.id}`)
      }
    },
  })

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const nearby = nearbyQuery.data ?? []

  return (
    <div class="merge-panel">
      <h3>Merge with nearby activity</h3>

      {nearbyQuery.isLoading && <p class="merge-loading">Loading nearby activities...</p>}

      {nearbyQuery.isSuccess && nearby.length === 0 && (
        <p class="merge-empty">No nearby activities of the same type found.</p>
      )}

      {nearby.length > 0 && (
        <ul class="merge-list">
          {nearby.map((a: Activity) => (
            <li key={a.id} class="merge-item">
              <label class="merge-label">
                <input type="checkbox" checked={selected.has(a.id!)} onChange={() => toggle(a.id!)} />
                <span class="merge-item-info">
                  <span class="merge-item-title">{a.title ?? a.activity_type}</span>
                  <span class="merge-item-time">
                    {formatDateTimeLocal(a.start_time)}
                    {a.end_time ? ` – ${formatDateTimeLocal(a.end_time)}` : ''}
                  </span>
                  <span class="merge-item-meta">
                    {a.source} · {formatDuration(a.start_time, a.end_time)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {mergeMutation.isError && (
        <p class="merge-error">
          {mergeMutation.error instanceof Error ? mergeMutation.error.message : 'Merge failed'}
        </p>
      )}

      <div class="merge-actions">
        <button
          class="btn-primary"
          onClick={() => mergeMutation.mutate()}
          disabled={selected.size === 0 || mergeMutation.isPending}
          type="button"
        >
          {mergeMutation.isPending ? 'Merging...' : `Merge ${selected.size + 1} activities`}
        </button>
        <button class="btn-secondary" onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  )
}
