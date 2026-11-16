import type { CreateSegmentBody, SegmentDetail } from '@aurboda/api-spec'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { createSegment } from '../../state/api'
import { cutTooShortReason } from '../../utils/segmentCut'
import { formatDistance } from '../EntityDetail/format-utils'
import { formatElapsed } from '../Routes/format'
import './style.css'

type CreateSegmentFormProps = {
  lengthM: number
  durationS?: number
  onCancel: () => void
} & (
  | {
      /** The cut to create, without its name. */
      cut: Omit<CreateSegmentBody, 'name'>
    }
  | {
      /** Creates the segment some other way (adding a suggestion). */
      submit: (name: string | undefined) => Promise<SegmentDetail>
    }
)

/** The shared foot of the create panels: length line, name, Create and Cancel. */
export const CreateSegmentForm = (props: CreateSegmentFormProps) => {
  const { lengthM, durationS, onCancel } = props
  const queryClient = useQueryClient()
  const { route: navigate } = useLocation()
  const [name, setName] = useState('')

  const createMutation = useMutation({
    mutationFn: () => {
      const given = name.trim() || undefined
      return 'submit' in props
        ? props.submit(given)
        : createSegment({ ...props.cut, ...(given ? { name: given } : {}) })
    },
    onSuccess: (segment) => {
      queryClient.invalidateQueries({ queryKey: ['segments'] })
      queryClient.invalidateQueries({ queryKey: ['entity-detail', 'activity'] })
      navigate(`/segments/${segment.id}`)
    },
  })

  const tooShort = cutTooShortReason(lengthM)

  return (
    <div class="segment-create-form">
      <p class="segment-create-summary">
        {formatDistance(lengthM)}
        {durationS !== undefined && ` · ${formatElapsed(durationS)}`}
      </p>
      <label class="segment-create-name">
        Name
        <input
          type="text"
          value={name}
          maxLength={255}
          placeholder="Named after the nearest place if left empty"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </label>
      <div class="segment-create-actions">
        <button
          type="button"
          class="btn-primary"
          disabled={Boolean(tooShort) || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? 'Creating...' : 'Create'}
        </button>
        <button type="button" class="btn-secondary" onClick={onCancel} disabled={createMutation.isPending}>
          Cancel
        </button>
        {tooShort && <span class="segment-create-reason">{tooShort}</span>}
      </div>
      {createMutation.isError && (
        <p class="segment-create-error" role="alert">
          {createMutation.error instanceof Error
            ? createMutation.error.message
            : 'Could not create the segment'}
        </p>
      )}
    </div>
  )
}
