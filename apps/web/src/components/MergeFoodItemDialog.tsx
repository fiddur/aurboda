/**
 * Merge two food items into one.
 *
 * Flow: user picks a target via the autocomplete → we call the preview
 * endpoint to surface counts and fill candidates → user confirms with
 * options for fill-empty (per-user target only) and discard-ingredients
 * (when source is a composite recipe) → we POST the merge.
 *
 * Past meal_food_items snapshots are NOT touched by the merge — the
 * dialog says so explicitly so the user knows old days remain intact.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import {
  type FoodItemEntity,
  mergeFoodItemsApi,
  type MergeFoodItemsPreview,
  previewMergeFoodItemsApi,
} from '../state/api'
import { FoodItemAutocomplete } from './FoodItemAutocomplete'
import './MergeFoodItemDialog.css'

interface Props {
  /** The food item being merged AWAY (source). */
  source: { id: string; name: string }
  onClose: () => void
  /** Called after a successful merge — caller refreshes its list. */
  onMerged?: (preview: MergeFoodItemsPreview) => void
}

function PreviewBlock({
  preview,
  sourceName,
  confirmDiscard,
  onConfirmDiscardChange,
  fillEmpty,
  onFillEmptyChange,
}: {
  preview: MergeFoodItemsPreview
  sourceName: string
  confirmDiscard: boolean
  onConfirmDiscardChange: (v: boolean) => void
  fillEmpty: boolean
  onFillEmptyChange: (v: boolean) => void
}) {
  return (
    <div class="merge-dialog-preview">
      <p>
        <strong>{preview.meals_repointed}</strong> past meals will re-point to{' '}
        <strong>{preview.target_name}</strong> (their nutrient values stay unchanged).
      </p>
      <p>
        <strong>{preview.ingredients_repointed}</strong> recipes will use{' '}
        <strong>{preview.target_name}</strong> from now on.
      </p>

      {preview.source_is_composite && (
        <div class="merge-dialog-warning">
          <p>
            ⚠ <strong>{sourceName}</strong> is itself a recipe. Its ingredient list will be discarded.
          </p>
          <label class="merge-dialog-checkbox">
            <input
              type="checkbox"
              checked={confirmDiscard}
              onChange={(e) => onConfirmDiscardChange((e.target as HTMLInputElement).checked)}
            />
            Yes, discard the source's ingredients
          </label>
        </div>
      )}

      {preview.target_is_central && (
        <p class="merge-dialog-note">
          The target lives in the central shared library. Its fields will not be modified.
        </p>
      )}

      {!preview.target_is_central && preview.fill_candidates.length > 0 && (
        <label class="merge-dialog-checkbox">
          <input
            type="checkbox"
            checked={fillEmpty}
            onChange={(e) => onFillEmptyChange((e.target as HTMLInputElement).checked)}
          />
          Fill empty target fields from source ({preview.fill_candidates.length}:{' '}
          {preview.fill_candidates.map((c) => c.field).join(', ')})
        </label>
      )}

      {!preview.target_is_central && preview.fill_candidates.length === 0 && (
        <p class="merge-dialog-note">
          Source has no field values that the target lacks — nothing to copy over.
        </p>
      )}
    </div>
  )
}

export function MergeFoodItemDialog({ source, onClose, onMerged }: Props) {
  const queryClient = useQueryClient()
  const [pickerValue, setPickerValue] = useState('')
  const [target, setTarget] = useState<FoodItemEntity | null>(null)
  const [fillEmpty, setFillEmpty] = useState(true)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const { data: preview, error: previewError } = useQuery({
    enabled: !!target,
    queryFn: () => previewMergeFoodItemsApi(target!.id, source.id),
    queryKey: ['mergeFoodItemPreview', source.id, target?.id],
  })

  const mergeMutation = useMutation({
    mutationFn: () =>
      mergeFoodItemsApi(target!.id, {
        confirm_discard_ingredients: confirmDiscard,
        fill_empty: fillEmpty && !preview?.target_is_central,
        source_id: source.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodItems'] })
      queryClient.invalidateQueries({ queryKey: ['meals'] })
      onMerged?.(preview!)
      onClose()
    },
  })

  const sourceCompositeNeedsConfirm = preview?.source_is_composite && !confirmDiscard
  const canMerge = !!preview && !sourceCompositeNeedsConfirm && !mergeMutation.isPending

  return (
    <div class="merge-dialog-backdrop" onClick={onClose}>
      <div class="merge-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="merge-dialog-header">
          <h2>Merge food item</h2>
          <button type="button" class="merge-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p class="merge-dialog-source">
          Merging <strong>{source.name}</strong> into…
        </p>

        <FoodItemAutocomplete
          value={pickerValue}
          onChange={setPickerValue}
          onSelect={(item) => {
            setTarget(item)
            setPickerValue(item.name)
          }}
          placeholder="Search for the target food item…"
        />

        {previewError && (
          <p class="merge-dialog-error">
            {previewError instanceof Error ? previewError.message : 'Preview failed'}
          </p>
        )}

        {target && preview && (
          <PreviewBlock
            preview={preview}
            sourceName={source.name}
            confirmDiscard={confirmDiscard}
            onConfirmDiscardChange={setConfirmDiscard}
            fillEmpty={fillEmpty}
            onFillEmptyChange={setFillEmpty}
          />
        )}

        {mergeMutation.error && (
          <p class="merge-dialog-error">
            {mergeMutation.error instanceof Error ? mergeMutation.error.message : 'Merge failed'}
          </p>
        )}

        <div class="merge-dialog-actions">
          <button type="button" class="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={!canMerge}
            onClick={() => mergeMutation.mutate()}
          >
            {mergeMutation.isPending ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}
