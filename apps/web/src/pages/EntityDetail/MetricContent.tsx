/**
 * Metric entity content with edit/delete support.
 *
 * Editing works by deleting the old data point and adding a new one,
 * since metric measurements are keyed by (metric, time, source).
 */
import { useMutation } from '@tanstack/react-query'
import { type ComponentType } from 'preact'
import { useCallback, useState } from 'preact/hooks'
import { addMetric, deleteMetricPoint } from '../../state/api'
import type { EntityActionsProps } from './EntityActions'
import { formatDateTimeLocal } from './format-utils'
import { MetricDetail, type MetricDraft, parseMetricEntityId } from './MetricDetail'
import { NotesSection } from './NotesSection'

export const MetricContent = ({
  entityId,
  EntityActions,
}: {
  entityId: string
  EntityActions: ComponentType<EntityActionsProps>
}) => {
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!parsed) return
      const newTime = new Date(draft.time).toISOString()
      const newValue = parseFloat(draft.value)
      if (isNaN(newValue)) throw new Error('Invalid value')

      // Delete old point, then add new one
      await deleteMetricPoint(parsed.metric, parsed.time)
      await addMetric({ metric: parsed.metric, time: newTime, value: newValue })
    },
    onSuccess: () => {
      setIsEditing(false)
      // Navigate to the new entity ID since time may have changed
      const newTime = new Date(draft.time).toISOString()
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
        onDraftInit={(d) => {
          if (isEditing) setDraft((prev) => ({ ...prev, ...d }))
        }}
      />
      <NotesSection entityType="metric" entityId={entityId} />
    </>
  )
}
