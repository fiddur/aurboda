import type { ActivityTypeCatalogEntry, ActivityTypeCatalogResult } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import type { ActivityTypeDefinition } from '../../state/api'

import {
  catalogFieldSummary,
  catalogSuggestions,
  groupCatalogEntries,
} from '../../components/activityTypeCatalog'
import { IconPreview } from '../../components/IconPreview'
import {
  addActivityTypeDefinition,
  fetchActivityTypeCatalog,
  fetchActivityTypeDefinitions,
  updateActivityTypeDefinition,
} from '../../state/api'
import { auth } from '../../state/auth'
import {
  DISPLAY_CATEGORY_LABELS,
  DISPLAY_CATEGORY_ORDER,
  displayCategoryOptions,
} from '../../utils/displayCategories'
import './style.css'

const catalogQuery = {
  queryFn: fetchActivityTypeCatalog,
  queryKey: ['activityTypeCatalog'],
  staleTime: 30 * 60 * 1000,
}

const serverError = (err: unknown): string | undefined =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error

function CatalogEntryRow({
  entry,
  meta,
  buttonLabel,
  onAdded,
  onError,
}: {
  entry: ActivityTypeCatalogEntry
  meta: string
  buttonLabel: string
  onAdded?: () => void
  onError?: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const fields = catalogFieldSummary(entry)

  const addMutation = useMutation({
    mutationFn: () => addActivityTypeDefinition({ name: entry.name }),
    onError: (err: unknown) => {
      const message = serverError(err) ?? 'Failed to add activity type'
      if (onError) onError(message)
      else setError(message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeCatalog'] })
      onAdded?.()
    },
  })

  return (
    <div class="at-row at-catalog-row">
      <div class="at-catalog-info">
        <span class="at-catalog-title">
          <IconPreview icon={entry.icon} size={20} />
          <span class="at-display-name">{entry.display_name}</span>
          <span class="at-name-muted">{meta}</span>
        </span>
        {fields && <span class="at-catalog-fields">Fields: {fields}</span>}
        {error && <span class="at-add-error">{error}</span>}
      </div>
      <div class="at-actions">
        <button
          type="button"
          class="at-add-save"
          disabled={addMutation.isPending}
          onClick={() => {
            setError('')
            addMutation.mutate()
          }}
        >
          {addMutation.isPending ? 'Adding...' : buttonLabel}
        </button>
      </div>
    </div>
  )
}

const toSnakeName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '')

function AddActivityTypeForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [snakeName, setSnakeName] = useState('')
  const [snakeEdited, setSnakeEdited] = useState(false)
  const [category, setCategory] = useState('other')
  const [error, setError] = useState('')
  const { data: catalog } = useQuery(catalogQuery)
  const suggestions = catalogSuggestions(catalog?.entries ?? [], displayName)

  const addMutation = useMutation({
    mutationFn: () =>
      addActivityTypeDefinition({
        display_category: category,
        display_name: displayName.trim(),
        name: snakeName,
      }),
    onError: (err: unknown) => {
      setError(serverError(err) ?? 'Failed to add activity type')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeCatalog'] })
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
            {displayCategoryOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {suggestions.length > 0 && (
        <div class="at-suggestions">
          <h3 class="at-suggestions-heading">Built-in types that match</h3>
          {suggestions.map((entry) => (
            <CatalogEntryRow
              key={entry.name}
              entry={entry}
              meta={DISPLAY_CATEGORY_LABELS[entry.display_category] ?? entry.display_category}
              buttonLabel="Add built-in"
              onAdded={onDone}
              onError={setError}
            />
          ))}
        </div>
      )}
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

function CategoryGroup({ category, types }: { category: string; types: ActivityTypeDefinition[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const label = DISPLAY_CATEGORY_LABELS[category] ?? category

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

function CatalogGroup({
  name,
  entries,
  startCollapsed,
}: {
  name: string
  entries: ActivityTypeCatalogEntry[]
  startCollapsed: boolean
}) {
  const [collapsed, setCollapsed] = useState(startCollapsed)

  return (
    <div class="at-group">
      <button type="button" class="at-group-header" onClick={() => setCollapsed(!collapsed)}>
        <span class={`at-group-chevron ${collapsed ? 'collapsed' : ''}`}>&#9660;</span>
        <span class="at-group-label">{name}</span>
        <span class="at-group-count">{entries.length}</span>
      </button>
      {!collapsed && (
        <div class="at-group-list">
          {entries.map((entry) => (
            <CatalogEntryRow key={entry.name} entry={entry} meta={entry.name} buttonLabel="Add" />
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogSection({ catalog, search }: { catalog: ActivityTypeCatalogResult; search: string }) {
  const groups = useMemo(
    () => groupCatalogEntries({ ...catalog, entries: catalog.entries.filter((e) => !e.in_use) }, search),
    [catalog, search],
  )
  if (groups.length === 0) return null

  return (
    <section class="at-catalog">
      <h2 class="at-catalog-heading">Built-in types</h2>
      <p class="at-catalog-intro">
        Types Aurboda knows, with fields ready. One is added to your types the first time you use it, or here.
      </p>
      <div class="at-container">
        {groups.map((group) => (
          <CatalogGroup
            key={group.key}
            name={group.name}
            entries={group.entries}
            startCollapsed={group.key === 'symptoms'}
          />
        ))}
      </div>
    </section>
  )
}

export function ActivityTypes() {
  const isLoggedIn = auth.value.token
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const { data: definitions = [], isLoading } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
  })
  const { data: catalog } = useQuery(catalogQuery)

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
    return DISPLAY_CATEGORY_ORDER.filter((cat) => groups.has(cat)).map((cat) => ({
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

      {catalog && <CatalogSection catalog={catalog} search={search} />}
    </div>
  )
}
