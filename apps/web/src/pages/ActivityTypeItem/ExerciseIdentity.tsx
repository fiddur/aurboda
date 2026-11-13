import type { DataFieldCatalog, ItemValueIdentity } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { ExerciseCatalogPicker } from '../../components/ExerciseCatalogPicker'
import { itemPageHref } from '../../components/sessions/sessionView'
import {
  apiErrorMessage,
  clearItemValueIdentityApi,
  fetchItemValueIdentity,
  ITEM_VALUE_IDENTITY_INVALIDATED_KEYS,
  setItemValueIdentityApi,
} from '../../state/api'
import { CatalogEntry } from './CatalogEntry'
import { type IdentityActionKind, identityView, otherValuesHint } from './exerciseIdentity'

const IdentityBody = ({
  identity,
  name,
  showsMerge,
}: {
  identity: ItemValueIdentity
  name: string
  showsMerge: boolean
}) => {
  const queryClient = useQueryClient()
  const view = identityView(identity.state)
  const [pickerOpen, setPickerOpen] = useState(view.pickerInitiallyOpen)
  const { field, value } = identity

  const onSuccess = async () => {
    await Promise.all(
      ITEM_VALUE_IDENTITY_INVALIDATED_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    )
  }
  const setIdentity = useMutation({
    mutationFn: (key: string | null) => setItemValueIdentityApi(name, { field, key, value }),
    onSuccess,
  })
  const clearIdentity = useMutation({
    mutationFn: () => clearItemValueIdentityApi(name, field, value),
    onSuccess,
  })
  const pending = setIdentity.isPending || clearIdentity.isPending
  const error = setIdentity.error ?? clearIdentity.error

  const run = (kind: IdentityActionKind) => {
    if (kind === 'pick') setPickerOpen((open) => !open)
    else if (kind === 'dismiss') setIdentity.mutate(null)
    else clearIdentity.mutate()
  }

  const hint = otherValuesHint(identity.other_values.length, showsMerge)

  return (
    <>
      <p class="activity-type-item-identity-line">{view.line}</p>
      {view.showsEntry && identity.entry && <CatalogEntry entry={identity.entry} value={value} />}
      {identity.other_values.length > 0 && (
        <p class="activity-type-item-identity-others">
          Also logged as{' '}
          {identity.other_values.map((other, i) => (
            <span key={other.value}>
              {i > 0 && ', '}
              <a href={itemPageHref(name, field, other.value)}>{other.value}</a>{' '}
              <span class="activity-type-item-identity-count">({other.count}×)</span>
            </span>
          ))}
          .{hint && ` ${hint}`}
        </p>
      )}
      <div class="activity-type-item-identity-actions">
        {view.actions.map((action) => (
          <button
            key={action.kind}
            type="button"
            class="btn-secondary activity-type-item-identity-action"
            aria-expanded={action.kind === 'pick' ? pickerOpen : undefined}
            disabled={pending}
            onClick={() => run(action.kind)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {pickerOpen && (
        <div class="activity-type-item-identity-picker">
          <ExerciseCatalogPicker
            autoFocus={!view.pickerInitiallyOpen}
            disabled={pending}
            onPick={(entry) => setIdentity.mutate(entry.key)}
          />
        </div>
      )}
      {error && <p class="error">{apiErrorMessage(error, 'Saving failed. Please try again.')}</p>}
    </>
  )
}

/** What catalogue entry the exercise name stands for, and the controls to map, dismiss or undo it. */
export const ExerciseIdentity = ({
  catalog,
  name,
  field,
  value,
  showsMerge,
}: {
  catalog: DataFieldCatalog | undefined
  name: string
  field: string
  value: string
  showsMerge: boolean
}) => {
  const query = useQuery({
    enabled: catalog === 'exercises',
    queryFn: () => fetchItemValueIdentity(name, field, value),
    queryKey: ['item-value-identity', name, field, value],
    staleTime: 5 * 60 * 1000,
  })
  const identity = query.data
  if (catalog !== 'exercises' || !identity) return null

  return (
    <section class="activity-type-item-section activity-type-item-identity" aria-label="Catalogue identity">
      <IdentityBody
        key={`${identity.value}:${identity.state}:${identity.catalog_key ?? ''}`}
        identity={identity}
        name={name}
        showsMerge={showsMerge}
      />
    </section>
  )
}
