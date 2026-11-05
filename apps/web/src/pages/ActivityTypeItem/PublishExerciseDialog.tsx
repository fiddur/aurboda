import type { ShareVisibility } from '@aurboda/api-spec'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { SHARE_VISIBILITY_OPTIONS, VisibilitySelector } from '../../components/VisibilitySelector'
import { apiErrorMessage, createSharedExercise } from '../../state/api'
import '../../components/ShareActivityDialog.css'

const NAME_MAX_LENGTH = 120

export function PublishExerciseDialog({
  activityType,
  field,
  value,
  onClose,
}: {
  activityType: string
  field: string
  value: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(value)
  const [visibility, setVisibility] = useState<ShareVisibility>('unlisted')
  const trimmedName = name.trim()

  const mutation = useMutation({
    mutationFn: () =>
      createSharedExercise({ activity_type: activityType, field, name: trimmedName, value, visibility }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sharedExercises'] })
      onClose()
    },
  })

  return (
    <div class="share-dialog-backdrop" onClick={onClose}>
      <div
        class="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-exercise-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="share-dialog-header">
          <h2 id="publish-exercise-title">Publish {value}</h2>
          <button type="button" class="share-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p class="share-dialog-subtitle">
          A public page with this exercise's records, trend, weekly bests and the sets of every session.
          Session titles, notes, locations and heart rate are never on it.
        </p>

        <fieldset class="share-dialog-group">
          <legend>Name</legend>
          <input
            type="text"
            class="share-dialog-message"
            aria-label="Name"
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </fieldset>

        <VisibilitySelector
          name="publish-exercise-visibility"
          options={SHARE_VISIBILITY_OPTIONS}
          value={visibility}
          onChange={setVisibility}
        />

        {mutation.error && (
          <p class="share-dialog-error">{apiErrorMessage(mutation.error, 'Failed to publish')}</p>
        )}

        <div class="share-dialog-actions">
          <button type="button" class="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={mutation.isPending || trimmedName === ''}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  )
}
