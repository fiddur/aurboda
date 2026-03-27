import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { deleteMealApi, fetchMeal, type Meal, updateMealApi } from '../../state/api'
import './MealDetail.css'

interface EditState {
  name?: string
  time?: string
  notes?: string
}

function EditableField({
  label,
  value,
  editing,
  editValue,
  onEdit,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  editing: boolean
  editValue: string
  onEdit: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div class="detail-row">
      <label>{label}</label>
      {editing ? (
        <input
          type={type}
          value={editValue}
          placeholder={placeholder}
          onInput={(e) => onEdit((e.target as HTMLInputElement).value)}
        />
      ) : (
        <span class="detail-value">{value || '—'}</span>
      )}
    </div>
  )
}

function MealInfoRows({ meal }: { meal: Meal }) {
  return (
    <>
      {meal.food_items && meal.food_items.length > 0 && (
        <div class="detail-row">
          <label>Food Items</label>
          <div class="detail-food-items">
            {meal.food_items.map((item, i) => (
              <span key={i} class="detail-food-chip">
                {item.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {meal.sensitivities && meal.sensitivities.length > 0 && (
        <div class="detail-row">
          <label>Flags</label>
          <div class="detail-sensitivities">
            {meal.sensitivities.map((s) => (
              <span key={s} class="detail-sensitivity-chip">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {meal.calories !== undefined && (
        <div class="detail-row">
          <label>Calories</label>
          <span class="detail-value">{meal.calories} kcal</span>
        </div>
      )}

      {meal.source && (
        <div class="detail-row">
          <label>Source</label>
          <span class="detail-value">{meal.source}</span>
        </div>
      )}
    </>
  )
}

// eslint-disable-next-line complexity -- detail page with edit mode and multiple data sections
export function MealDetail() {
  const { params } = useRoute()
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const id = params.id

  const { data: meal, isLoading } = useQuery({
    queryFn: () => fetchMeal(id),
    queryKey: ['meal', id],
  })

  const [editing, setEditing] = useState<EditState | null>(null)

  const updateMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateMealApi>[1]) => updateMealApi(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal', id] })
      queryClient.invalidateQueries({ queryKey: ['meals'] })
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteMealApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meals'] })
      route('/meals')
    },
  })

  if (isLoading) {
    return (
      <div class="meal-detail-page">
        <p class="loading">Loading...</p>
      </div>
    )
  }
  if (!meal) {
    return (
      <div class="meal-detail-page">
        <p>Meal not found.</p>
      </div>
    )
  }

  const isEditing = editing !== null
  const editName = editing?.name ?? meal.name ?? ''
  const editTime = editing?.time ?? format(meal.time, "yyyy-MM-dd'T'HH:mm")
  const editNotes = editing?.notes ?? meal.notes ?? ''

  const handleSave = () => {
    if (!editing) return
    const body: Record<string, unknown> = {}
    if (editing.name !== undefined) body.name = editing.name || null
    if (editing.time !== undefined) body.time = new Date(editing.time).toISOString()
    if (editing.notes !== undefined) body.notes = editing.notes || null
    updateMutation.mutate(body)
  }

  return (
    <div class="meal-detail-page">
      <div class="detail-header">
        <a href={`/meals?date=${format(meal.time, 'yyyy-MM-dd')}`} class="back-link">
          &larr; Back
        </a>
        <div class="detail-actions">
          {isEditing ? (
            <>
              <button
                type="button"
                class="btn-primary"
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button type="button" class="btn-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" class="btn-secondary" onClick={() => setEditing({})}>
              Edit
            </button>
          )}
          <ConfirmButton
            label="Delete"
            confirmMessage="Delete this meal?"
            onConfirm={() => deleteMutation.mutate()}
            isPending={deleteMutation.isPending}
          />
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-row">
          <label>Type</label>
          <span class="detail-value">{meal.meal_type ?? '—'}</span>
        </div>

        <EditableField
          label="Time"
          value={format(meal.time, 'yyyy-MM-dd HH:mm')}
          editing={isEditing}
          editValue={editTime}
          onEdit={(v) => setEditing({ ...editing, time: v })}
          type="datetime-local"
        />

        <EditableField
          label="Name"
          value={meal.name ?? ''}
          editing={isEditing}
          editValue={editName}
          onEdit={(v) => setEditing({ ...editing, name: v })}
          placeholder="Meal name/description"
        />

        <div class="detail-row">
          <label>Notes</label>
          {isEditing ? (
            <textarea
              value={editNotes}
              placeholder="Notes..."
              rows={3}
              onInput={(e) => setEditing({ ...editing, notes: (e.target as HTMLTextAreaElement).value })}
            />
          ) : (
            <span class="detail-value">{meal.notes || '—'}</span>
          )}
        </div>

        <MealInfoRows meal={meal} />
      </div>
    </div>
  )
}
