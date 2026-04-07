/**
 * Activity Types page — shows all activity type definitions grouped by display_category,
 * with show_on_timeline toggle switches and a search filter.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import type { ActivityTypeDefinition } from '../../state/api'

import {
  addActivityTypeDefinition,
  fetchActivityTypeDefinitions,
  updateActivityTypeDefinition,
} from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

// ============================================================================
// Constants
// ============================================================================

const CATEGORY_LABELS: Record<string, string> = {
  exercise: 'Exercise',
  meditation: 'Meditation',
  other: 'Other',
  productivity: 'Productivity',
  sleep_rest: 'Sleep & Rest',
  travel: 'Travel',
  wellness: 'Wellness',
}

const CATEGORY_ORDER = ['sleep_rest', 'exercise', 'meditation', 'wellness', 'productivity', 'travel', 'other']

const toSnakeName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '')

// ============================================================================
// Add activity type form
// ============================================================================

function AddActivityTypeForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [snakeName, setSnakeName] = useState('')
  const [snakeEdited, setSnakeEdited] = useState(false)
  const [category, setCategory] = useState('other')
  const [error, setError] = useState('')

  const addMutation = useMutation({
    mutationFn: () =>
      addActivityTypeDefinition({
        display_category: category,
        display_name: displayName.trim(),
        name: snakeName,
      }),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Failed to add activity type')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
      onDone()
    },
  })

  const derivedSnake = toSnakeName(displayName)
  const effectiveSnake = snakeEdited ? snakeName : derivedSnake
  const valid = effectiveSnake.length > 0 && displayName.trim().length > 0

  return (
    <div class="at-add-form">
      <div class="at-add-fields">
        <label>
          <span class="at-add-label">Display Name</span>
          <input
            type="text"
            value={displayName}
            onInput={(e) => {
              setDisplayName((e.target as HTMLInputElement).value)
              if (!snakeEdited) setSnakeName(toSnakeName((e.target as HTMLInputElement).value))
            }}
            placeholder="e.g. Sauna"
            class="at-add-input"
            autoFocus
          />
        </label>
        <label>
          <span class="at-add-label">Identifier (snake_case)</span>
          <input
            type="text"
            value={snakeEdited ? snakeName : derivedSnake}
            onInput={(e) => {
              setSnakeEdited(true)
              setSnakeName((e.target as HTMLInputElement).value)
            }}
            placeholder="e.g. sauna"
            class="at-add-input"
          />
        </label>
        <label>
          <span class="at-add-label">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}
            class="at-add-input"
          >
            {CATEGORY_ORDER.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p class="at-add-error">{error}</p>}
      <div class="at-add-actions">
        <button
          type="button"
          class="at-add-save"
          disabled={!valid || addMutation.isPending}
          onClick={() => {
            setError('')
            if (!snakeEdited) setSnakeName(derivedSnake)
            addMutation.mutate()
          }}
        >
          {addMutation.isPending ? 'Adding...' : 'Add'}
        </button>
        <button type="button" class="at-add-cancel" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Toggle row
// ============================================================================

function TypeRow({ def }: { def: ActivityTypeDefinition }) {
  const queryClient = useQueryClient()

  const toggleMutation = useMutation({
    mutationFn: () => updateActivityTypeDefinition(def.name, { show_on_timeline: !def.show_on_timeline }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['activityTypeDefinitions'] })
      const previous = queryClient.getQueryData<ActivityTypeDefinition[]>(['activityTypeDefinitions'])
      queryClient.setQueryData<ActivityTypeDefinition[]>(['activityTypeDefinitions'], (old) =>
        old?.map((t) => (t.name === def.name ? { ...t, show_on_timeline: !t.show_on_timeline } : t)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['activityTypeDefinitions'], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
    },
  })

  return (
    <div class="at-row" id={def.name}>
      <div class="at-info">
        <span class="at-color-dot" style={{ background: def.color }} />
        <a href={`/activity-type/${def.name}`} class="at-display-name">
          {def.display_name}
        </a>
        <span class="at-name-muted">{def.name}</span>
      </div>
      <div class="at-actions">
        <label class="at-toggle">
          <input
            type="checkbox"
            checked={def.show_on_timeline}
            onChange={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
          />
          <span class="at-toggle-label">Timeline</span>
        </label>
      </div>
    </div>
  )
}

// ============================================================================
// Collapsible group
// ============================================================================

function CategoryGroup({ category, types }: { category: string; types: ActivityTypeDefinition[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const label = CATEGORY_LABELS[category] ?? category

  return (
    <div class="at-group">
      <button type="button" class="at-group-header" onClick={() => setCollapsed(!collapsed)}>
        <span class={`at-group-chevron ${collapsed ? 'collapsed' : ''}`}>&#9660;</span>
        <span class="at-group-label">{label}</span>
        <span class="at-group-count">{types.length}</span>
      </button>
      {!collapsed && (
        <div class="at-group-list">
          {types.map((def) => (
            <TypeRow key={def.name} def={def} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main page
// ============================================================================

export function ActivityTypes() {
  const isLoggedIn = auth.value.token
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const { data: definitions = [], isLoading } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
  })

  const filtered = useMemo(() => {
    if (!search) return definitions
    const q = search.toLowerCase()
    return definitions.filter(
      (d) => d.name.toLowerCase().includes(q) || d.display_name.toLowerCase().includes(q),
    )
  }, [definitions, search])

  const grouped = useMemo(() => {
    const groups = new Map<string, ActivityTypeDefinition[]>()
    for (const def of filtered) {
      const cat = def.display_category || 'other'
      const list = groups.get(cat) ?? []
      list.push(def)
      groups.set(cat, list)
    }
    return CATEGORY_ORDER.filter((cat) => groups.has(cat)).map((cat) => ({
      category: cat,
      types: groups.get(cat)!,
    }))
  }, [filtered])

  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <p>Please log in to manage activity types.</p>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Activity Types</h1>
        <p class="page-subtitle">
          Manage activity type definitions. Toggle which types appear on the timeline.
        </p>
      </div>

      <div class="at-toolbar">
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          class="at-search-input"
        />
        {!showAdd && (
          <button type="button" class="at-add-btn" onClick={() => setShowAdd(true)}>
            + Add Type
          </button>
        )}
      </div>

      {showAdd && <AddActivityTypeForm onDone={() => setShowAdd(false)} />}

      {isLoading ? (
        <p class="loading">Loading activity types...</p>
      ) : grouped.length === 0 ? (
        <p class="at-empty">{search ? 'No matching activity types.' : 'No activity types defined yet.'}</p>
      ) : (
        <div class="at-container">
          {grouped.map(({ category, types }) => (
            <CategoryGroup key={category} category={category} types={types} />
          ))}
        </div>
      )}
    </div>
  )
}
