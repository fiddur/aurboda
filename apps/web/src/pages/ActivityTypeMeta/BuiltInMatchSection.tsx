import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import {
  catalogRelation,
  type CatalogRelation,
  variantDataSummary,
} from '../../components/activityTypeCatalog'
import {
  addCatalogFieldsToActivityType,
  type ActivityTypeDefinition,
  fetchActivityTypeCatalog,
  mergeActivityTypeApi,
} from '../../state/api'

const serverError = (err: unknown): string | undefined =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error

function CatalogFieldsBlock({
  name,
  relation,
}: {
  name: string
  relation: CatalogRelation & { kind: 'fields' }
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => addCatalogFieldsToActivityType(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeCatalog'] })
    },
  })

  return (
    <section class="activity-type-meta-section">
      <h2>Built-in fields</h2>
      <p class="activity-type-meta-merge-desc">
        This type matches the built-in type <strong>{relation.entry.display_name}</strong>. Fields it does not
        have yet: {relation.missing.map((f) => f.name.replaceAll('_', ' ')).join(', ')}.
      </p>
      <button
        type="button"
        class="btn-secondary"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Adding...' : 'Add built-in fields'}
      </button>
      {mutation.error && (
        <p class="error">{serverError(mutation.error) ?? 'Adding the fields failed. Please try again.'}</p>
      )}
    </section>
  )
}

function CatalogMergeBlock({
  name,
  relation,
}: {
  name: string
  relation: CatalogRelation & { kind: 'alias' | 'variant' }
}) {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [confirming, setConfirming] = useState(false)
  const { entry } = relation
  const variant = relation.kind === 'variant' ? relation.variant : undefined
  const summary = variant ? variantDataSummary(entry, variant) : ''

  const mutation = useMutation({
    mutationFn: () => mergeActivityTypeApi(name, entry.name, variant?.data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeCatalog'] })
      queryClient.invalidateQueries({ queryKey: ['activity-sessions'] })
      route(`/activity-type/${encodeURIComponent(entry.name)}`)
      alert(
        `Merged ${result.activities_reassigned ?? 0} activities into "${entry.display_name}"` +
          (result.activities_data_set ? ` (${summary} set on ${result.activities_data_set})` : ''),
      )
    },
  })

  return (
    <section class="activity-type-meta-section">
      <h2>Built-in type</h2>
      <p class="activity-type-meta-merge-desc">
        Aurboda has this built in as <strong>{entry.display_name}</strong>
        {variant ? ` with ${summary}` : ''}.{' '}
        {variant
          ? `Merging moves this type's activities to ${entry.display_name}, sets ${summary} on each one that has no ${Object.keys(
              variant.data,
            )
              .map((k) => k.replaceAll('_', ' '))
              .join(' or ')}, and removes this type.`
          : "Merging moves this type's activities there and removes this type."}
      </p>
      {confirming ? (
        <div class="activity-type-meta-merge-actions activity-type-meta-builtin-confirm">
          <button
            type="button"
            class="btn-danger"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Merging...' : `Merge into ${entry.display_name}`}
          </button>
          <button type="button" class="btn-secondary" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" class="btn-secondary" onClick={() => setConfirming(true)}>
          Merge into {entry.display_name}...
        </button>
      )}
      {mutation.error && (
        <p class="error">{serverError(mutation.error) ?? 'Merge failed. Please try again.'}</p>
      )}
    </section>
  )
}

/** Offers the built-in catalogue's fields, or a merge into the built-in type, for a type that matches one. */
export function BuiltInMatchSection({ typeDef }: { typeDef: ActivityTypeDefinition }) {
  const { data: catalog } = useQuery({
    queryFn: fetchActivityTypeCatalog,
    queryKey: ['activityTypeCatalog'],
    staleTime: 30 * 60 * 1000,
  })
  const relation = catalog ? catalogRelation(typeDef, catalog.entries) : undefined
  if (!relation) return null
  if (relation.kind === 'fields') return <CatalogFieldsBlock name={typeDef.name} relation={relation} />
  return <CatalogMergeBlock key={typeDef.name} name={typeDef.name} relation={relation} />
}
