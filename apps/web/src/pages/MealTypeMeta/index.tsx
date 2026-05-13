/**
 * Meal type meta page — overview and icon configuration for a meal type.
 * Icons are stored in user settings item_icons with "meal:" prefix.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { IconInput } from '../../components/IconInput'
import { IconPreview } from '../../components/IconPreview'
import { SaveCancelRow } from '../../components/SaveCancelRow'
import { useSaveStatus } from '../../components/SaveStatusIndicator'
import { fetchItemIcons, fetchMeals, type Meal, updateUserSettings } from '../../state/api'
import { resolveItemIcon, suggestEmoji } from '../../utils/emojiLookup'
import '../ActivityTypeMeta/style.css'

const toDisplayName = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1)

function IconSection({
  mealType,
  currentIcon,
  itemIcons,
}: {
  mealType: string
  currentIcon: string | undefined
  itemIcons: Record<string, string>
}) {
  const queryClient = useQueryClient()
  const [iconValue, setIconValue] = useState<string | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const key = `meal:${mealType}`
      const newIcons = { ...itemIcons, [key]: iconValue ?? '' }
      if (!iconValue) delete newIcons[key]
      await updateUserSettings({ item_icons: newIcons })
    },
    onError: () => setSaveStatus({ status: 'error' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      queryClient.invalidateQueries({ queryKey: ['item-icons'] })
      setIconValue(undefined)
    },
  })

  const suggested = suggestEmoji(mealType)
  const shownIcon = iconValue ?? currentIcon ?? ''
  const hasChanges = iconValue !== undefined && iconValue !== (currentIcon ?? '')

  return (
    <section class="activity-type-meta-section">
      <h2>Icon</h2>
      <div class="activity-type-meta-settings-grid">
        <label>
          <span class="activity-type-meta-field-label">Emoji or image URL</span>
          <div class="activity-type-meta-icon-row">
            <IconInput
              value={shownIcon}
              onChange={setIconValue}
              suggestedEmoji={suggested}
              previewClass="activity-type-meta-icon-preview"
            />
          </div>
        </label>
      </div>
      {hasChanges && (
        <SaveCancelRow
          onSave={() => {
            setSaveStatus({ status: 'saving' })
            saveMutation.mutate()
          }}
          onCancel={() => setIconValue(undefined)}
          isPending={saveMutation.isPending}
          saveStatus={saveStatus}
          saveStatusVariant="compact"
        />
      )}
    </section>
  )
}

function RecentMeals({ mealType }: { mealType: string }) {
  const now = new Date()
  const start = subDays(now, 30)

  const { data, isLoading } = useQuery({
    queryFn: () => fetchMeals({ meal_type: mealType, start: start.toISOString(), end: now.toISOString() }),
    queryKey: ['meals', 'type', mealType],
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) return <p class="loading">Loading...</p>

  const meals: Meal[] = data?.meals ?? []
  if (meals.length === 0) {
    return <p class="activity-type-meta-empty">No meals in the last 30 days</p>
  }

  const recent = meals.slice(0, 10)

  return (
    <div class="activity-type-meta-recent-list">
      {recent.map((meal) => (
        <a key={meal.id} href={`/meals/${meal.id}`} class="activity-type-meta-recent-item">
          <span class="activity-type-meta-recent-time">{format(meal.time, 'yyyy-MM-dd HH:mm')}</span>
          {meal.name && <span class="activity-type-meta-recent-title">{meal.name}</span>}
          {meal.calories !== undefined && (
            <span class="activity-type-meta-recent-duration">{meal.calories} kcal</span>
          )}
        </a>
      ))}
      {meals.length > 10 && <p class="activity-type-meta-empty">+{meals.length - 10} more in last 30 days</p>}
    </div>
  )
}

export function MealTypeMeta() {
  const { params } = useRoute()
  const mealType = decodeURIComponent(params.name as string)

  const { data: itemIcons = {} } = useQuery({
    queryFn: fetchItemIcons,
    queryKey: ['item-icons'],
    staleTime: 5 * 60 * 1000,
  })

  const icon = resolveItemIcon(`meal:${mealType}`, itemIcons)
  const displayName = toDisplayName(mealType)

  return (
    <div class="activity-type-meta-page">
      <div class="activity-type-meta-header">
        <div class="activity-type-meta-title-row">
          {icon ? (
            <IconPreview icon={icon} size={32} />
          ) : (
            <span class="activity-type-meta-icon-placeholder">?</span>
          )}
          <h1>{displayName}</h1>
        </div>
      </div>

      <IconSection mealType={mealType} currentIcon={icon} itemIcons={itemIcons} />

      <section class="activity-type-meta-section">
        <h2>Recent Meals</h2>
        <RecentMeals mealType={mealType} />
      </section>

      <section class="activity-type-meta-section">
        <h2>Related</h2>
        <div class="activity-type-meta-links">
          <a href={`/meals`} class="activity-type-meta-link">
            All Meals
          </a>
          <a href="/timeline" class="activity-type-meta-link">
            Timeline
          </a>
        </div>
      </section>
    </div>
  )
}
