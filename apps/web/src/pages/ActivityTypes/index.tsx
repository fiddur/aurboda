/**
 * Activity Types page — shows all activity type definitions grouped by display_category,
 * with show_on_timeline toggle switches and a search filter.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import type { ActivityTypeDefinition } from '../../state/api'

import { fetchActivityTypeDefinitions, updateActivityTypeDefinition } from '../../state/api'
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
    <div class="at-row">
      <div class="at-info">
        <span class="at-color-dot" style={{ background: def.color }} />
        <span class="at-display-name">{def.display_name}</span>
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

      <div class="at-search">
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          class="at-search-input"
        />
      </div>

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
