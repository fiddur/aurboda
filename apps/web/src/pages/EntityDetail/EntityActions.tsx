/**
 * Entity action buttons (edit, delete, restore) shared across all entity detail views.
 */
import { useMutation } from '@tanstack/react-query'
import {
  deleteMetricPoint,
  restoreActivity,
  restoreProductivity,
  restoreTag,
  softDeleteActivity,
  softDeleteProductivity,
  softDeleteTag,
} from '../../state/api'
import { parseMetricEntityId } from './MetricDetail'

type EntityType = 'activity' | 'tag' | 'productivity' | 'metric'

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
}

const deleteEntity = (entityType: EntityType, entityId: string): Promise<void> => {
  if (entityType === 'activity') return softDeleteActivity(entityId)
  if (entityType === 'tag') return softDeleteTag(entityId)
  if (entityType === 'productivity') return softDeleteProductivity(entityId)
  if (entityType === 'metric') {
    const parsed = parseMetricEntityId(entityId)
    if (!parsed) return Promise.reject(new Error('Invalid metric entity ID'))
    return deleteMetricPoint(parsed.metric, parsed.time)
  }
  return Promise.reject(new Error('Unsupported entity type for delete'))
}

const restoreEntity = (entityType: EntityType, entityId: string): Promise<void> => {
  if (entityType === 'activity') return restoreActivity(entityId)
  if (entityType === 'tag') return restoreTag(entityId)
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
