/**
 * Entity action buttons (edit, delete, restore) shared across all entity detail views.
 */
import { useMutation } from '@tanstack/react-query'

import {
  deleteMetricPoint,
  restoreActivity,
  restoreProductivity,
  softDeleteActivity,
  softDeleteProductivity,
} from '../../state/api'
import { parseMetricEntityId } from './MetricDetail'

export type EntityType = 'activity' | 'tag' | 'productivity' | 'metric' | 'report'

export interface EntityActionsProps {
  entityType: EntityType
  entityId: string
  isDeleted: boolean
  onMutationSuccess: () => void
  canEdit: boolean
  isMerged: boolean
  isEditing: boolean
  onStartEditing: () => void
  onCancelEditing: () => void
  onSave: () => void
  isSaving: boolean
  onStartMerging?: () => void
}

const deleteEntity = (entityType: EntityType, entityId: string): Promise<void> => {
  if (entityType === 'activity' || entityType === 'tag') return softDeleteActivity(entityId)
  if (entityType === 'productivity') return softDeleteProductivity(entityId)
  if (entityType === 'metric') {
    const parsed = parseMetricEntityId(entityId)
    if (!parsed) return Promise.reject(new Error('Invalid metric entity ID'))
    if (!parsed.source) return Promise.reject(new Error('Cannot delete metric without source'))
    return deleteMetricPoint(parsed.metric, parsed.time, parsed.source)
  }
  return Promise.reject(new Error('Unsupported entity type for delete'))
}

const restoreEntity = (entityType: EntityType, entityId: string): Promise<void> => {
  if (entityType === 'activity' || entityType === 'tag') return restoreActivity(entityId)
  if (entityType === 'productivity') return restoreProductivity(entityId)
  return Promise.reject(new Error('Unsupported entity type for restore'))
}

const PencilIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)

export const EntityActions = ({
  entityType,
  entityId,
  isDeleted,
  onMutationSuccess,
  canEdit,
  isMerged,
  isEditing,
  onStartEditing,
  onCancelEditing,
  onSave,
  isSaving,
  onStartMerging,
}: EntityActionsProps) => {
  const deleteMutation = useMutation({
    mutationFn: () => deleteEntity(entityType, entityId),
    onSuccess: onMutationSuccess,
  })

  const restoreMutation = useMutation({
    mutationFn: () => restoreEntity(entityType, entityId),
    onSuccess: onMutationSuccess,
  })

  if (isDeleted) {
    return (
      <div class="deleted-banner">
        This {entityType} has been deleted.
        <button
          class="btn-restore"
          onClick={() => restoreMutation.mutate()}
          disabled={restoreMutation.isPending}
          type="button"
        >
          {restoreMutation.isPending ? 'Restoring...' : 'Restore'}
        </button>
      </div>
    )
  }

  return (
    <div class="entity-actions">
      {canEdit && !isEditing && (
        <button
          class="btn-edit"
          onClick={onStartEditing}
          disabled={isMerged}
          title={isMerged ? 'Edit individual sources' : `Edit ${entityType}`}
          type="button"
        >
          <PencilIcon />
        </button>
      )}
      {isEditing && (
        <>
          <button class="btn-primary" onClick={onSave} disabled={isSaving} type="button">
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button class="btn-secondary" onClick={onCancelEditing} type="button">
            Cancel
          </button>
        </>
      )}
      {!isEditing && onStartMerging && (
        <button
          class="btn-secondary"
          onClick={onStartMerging}
          disabled={isMerged}
          title={isMerged ? 'Cannot merge display-merged activities' : 'Merge with nearby activity'}
          type="button"
        >
          Merge
        </button>
      )}
      {!isEditing && (
        <button
          class="btn-danger"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          type="button"
        >
          {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        </button>
      )}
    </div>
  )
}
