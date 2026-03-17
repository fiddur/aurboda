/**
 * Metric entity content with edit/delete support.
 *
 * Editing works via upsert (add) then conditional delete:
 * - If only value changed: addMetric upserts (backend uses ON CONFLICT DO UPDATE)
 * - If time changed: addMetric creates new point, then old point is deleted
 * This ensures data is never lost on partial failure.
 */
import { useMutation } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'

import { addMetric, deleteMetricPoint } from '../../state/api'
import { EntityActions } from './EntityActions'
import { formatDateTimeLocal } from './format-utils'
import { MetricDetail, type MetricDraft, parseMetricEntityId } from './MetricDetail'
import { NotesSection } from './NotesSection'

export const MetricContent = ({ entityId }: { entityId: string }) => {
  const parsed = parseMetricEntityId(entityId)
  const isDeletable = parsed?.source === 'manual' || parsed?.source === 'aurboda'

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState<MetricDraft>({ time: '', value: '' })

  const startEditing = useCallback(() => {
    if (!parsed) return
    setDraft({
      time: formatDateTimeLocal(new Date(parsed.time)),
      value: '', // will be populated by MetricDetail via onDraftInit
    })
    setIsEditing(true)
  }, [parsed])

  const handleDraftInit = useCallback(
    (d: Partial<MetricDraft>) => {
      if (isEditing) setDraft((prev) => ({ ...prev, ...d }))
    },
    [isEditing],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!parsed) return
      const newTime = new Date(draft.time).toISOString()
      const newValue = parseFloat(draft.value)
      if (isNaN(newValue)) throw new Error('Invalid value')

      // Add/upsert the new point first so data is never lost on partial failure.
      // Backend uses ON CONFLICT (time, metric, source) DO UPDATE, so if time
      // hasn't changed this just updates the value in place.
      await addMetric({ metric: parsed.metric, time: newTime, value: newValue })

      // Only delete the old point if the time actually changed, otherwise
      // we'd delete the point we just upserted.
      if (newTime !== parsed.time) {
        await deleteMetricPoint(parsed.metric, parsed.time)
      }
    },
    onSuccess: () => {
      setIsEditing(false)
      const newTime = new Date(draft.time).toISOString()
      // addMetric always stores with source='aurboda', regardless of original source
      const newEntityId = `${newTime}|${parsed!.metric}|aurboda`
      window.location.href = `/detail/metric/${encodeURIComponent(newEntityId)}`
    },
  })

  return (
    <>
      {isDeletable && (
        <EntityActions
          entityType="metric"
          entityId={entityId}
          isDeleted={false}
          onMutationSuccess={() => history.back()}
          canEdit={true}
          isMerged={false}
          isEditing={isEditing}
          onStartEditing={startEditing}
          onCancelEditing={() => {
            setIsEditing(false)
            setDraft({ time: '', value: '' })
          }}
          onSave={() => saveMutation.mutate()}
          isSaving={saveMutation.isPending}
        />
      )}
      <MetricDetail
        entityId={entityId}
        isEditing={isEditing}
        draft={draft}
        onDraftChange={setDraft}
        onDraftInit={handleDraftInit}
      />
      <NotesSection entityType="metric" entityId={entityId} />
    </>
  )
}
