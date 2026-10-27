import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { itemPageHref } from '../../components/sessions/sessionView'
import { apiErrorMessage, fetchActivityFieldValues, mergeItemValuesApi } from '../../state/api'
import { canMergeInto, mergeTargets } from './itemMerge'

const DATALIST_ID = 'activity-type-item-merge-targets'

const INVALIDATED_KEYS = [
  'activity-sessions',
  'chart-data',
  'activity-item-history',
  'activity-field-values',
  'item-value-aliases',
]

/** Merges this item value into another: its sets are renamed and it becomes an alias of the target. */
export const MergeItemValue = ({
  name,
  field,
  value,
  sessionCount,
}: {
  name: string
  field: string
  value: string
  sessionCount: number
}) => {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('')

  const values = useQuery({
    enabled: open,
    queryFn: () => fetchActivityFieldValues(name, field),
    queryKey: ['activity-field-values', name, field],
    staleTime: 5 * 60 * 1000,
  })
  const options = mergeTargets(
    (values.data?.values ?? []).map((v) => v.value),
    value,
  )

  const merge = useMutation({
    mutationFn: (to: string) => mergeItemValuesApi(name, { field, source: value, target: to }),
    onSuccess: (_result, to) => {
      route(itemPageHref(name, field, to))
      for (const key of INVALIDATED_KEYS) void queryClient.invalidateQueries({ queryKey: [key] })
    },
  })

  if (!open) {
    return (
      <button type="button" class="activity-type-item-merge-open" onClick={() => setOpen(true)}>
        Merge into…
      </button>
    )
  }

  const trimmed = target.trim()
  const ready = canMergeInto(target, value)

  return (
    <div class="activity-type-item-merge">
      <label>
        <span class="activity-type-item-merge-label">Merge {value} into</span>
        <input
          type="text"
          list={DATALIST_ID}
          value={target}
          placeholder="Exercise name"
          onInput={(e) => setTarget((e.target as HTMLInputElement).value)}
        />
        <datalist id={DATALIST_ID}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </label>
      <p class="activity-type-item-merge-note">
        Every set named {value} is renamed, and later imports of {value} are stored under the new name.
      </p>
      <div class="activity-type-item-merge-actions">
        <button
          type="button"
          class="activity-type-item-merge-confirm"
          disabled={!ready || merge.isPending}
          onClick={() => merge.mutate(trimmed)}
        >
          {merge.isPending
            ? 'Merging…'
            : `Merge ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}${ready ? ` into ${trimmed}` : ''}`}
        </button>
        <button
          type="button"
          class="activity-type-item-merge-cancel"
          onClick={() => {
            setOpen(false)
            setTarget('')
            merge.reset()
          }}
        >
          Cancel
        </button>
      </div>
      {merge.error && <p class="error">{apiErrorMessage(merge.error, 'Merge failed. Please try again.')}</p>}
    </div>
  )
}
