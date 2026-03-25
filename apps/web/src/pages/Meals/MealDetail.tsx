import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { deleteMealApi, fetchMeal, type Meal, updateMealApi } from '../../state/api'
import './MealDetail.css'

export function MealDetail() {
  const { params } = useRoute()
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const id = params.id

  const { data: meal, isLoading } = useQuery({
    queryFn: () => fetchMeal(id),
    queryKey: ['meal', id],
  })

  const [editing, setEditing] = useState<Partial<Meal> | null>(null)

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

  if (isLoading)
    {return (
      <div class="meal-detail-page">
        <p class="loading">Loading...</p>
      </div>
    )}
  if (!meal)
    {return (
      <div class="meal-detail-page">
        <p>Meal not found.</p>
      </div>
    )}

  const isEditing = editing !== null
  const current = isEditing ? { ...meal, ...editing } : meal

  const handleSave = () => {
    if (!editing) return
    const body: Record<string, unknown> = {}
    if (editing.name !== undefined) body.name = editing.name || null
    if (editing.time !== undefined)
      {body.time = editing.time instanceof Date ? editing.time.toISOString() : editing.time}
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

        <div class="detail-row">
          <label>Time</label>
          {isEditing ? (
            <input
              type="datetime-local"
              value={format(
                current.time instanceof Date ? current.time : new Date(current.time as string),
                "yyyy-MM-dd'T'HH:mm",
              )}
              onInput={(e) => setEditing({ ...editing, time: (e.target as HTMLInputElement).value })}
            />
          ) : (
            <span class="detail-value">{format(meal.time, 'yyyy-MM-dd HH:mm')}</span>
          )}
        </div>

        <div class="detail-row">
          <label>Name</label>
          {isEditing ? (
            <input
              type="text"
              value={current.name ?? ''}
              placeholder="Meal name/description"
              onInput={(e) => setEditing({ ...editing, name: (e.target as HTMLInputElement).value })}
            />
          ) : (
            <span class="detail-value">{meal.name || '—'}</span>
          )}
        </div>

        <div class="detail-row">
          <label>Notes</label>
          {isEditing ? (
            <textarea
              value={current.notes ?? ''}
              placeholder="Notes..."
              rows={3}
              onInput={(e) => setEditing({ ...editing, notes: (e.target as HTMLTextAreaElement).value })}
            />
          ) : (
            <span class="detail-value">{meal.notes || '—'}</span>
          )}
        </div>

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
            <label>Sensitivities</label>
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
      </div>
    </div>
  )
}
