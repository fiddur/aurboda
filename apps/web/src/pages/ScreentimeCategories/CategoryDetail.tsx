/**
 * Category detail/edit page.
 *
 * Serves as both the view and edit page for a screentime category.
 * All fields auto-save on blur. Also handles creation of new categories
 * when navigating to a UUID that doesn't exist yet.
 */
import type { ScreentimeCategory } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useCallback, useEffect, useState } from 'preact/hooks'

import { IconInput } from '../../components/IconInput'
import { MiniTrendChart } from '../../components/MiniTrendChart'
import {
  type DistinctApp,
  type FetchTrendParams,
  fetchDistinctApps,
  fetchScreentimeCategories,
  fetchScreentimeCategoryById,
  fetchTrend,
  fetchUserSettings,
  moveScreentimeCategory,
  recategorizeScreentime,
  updateScreentimeCategory,
  updateUserSettings,
  upsertScreentimeCategory,
} from '../../state/api'
import { auth } from '../../state/auth'
import { isEmoji, suggestEmoji } from '../../utils/emojiLookup'
import './style.css'

// ============================================================================
// Helpers
// ============================================================================

const formatDuration = (totalSec: number): string => {
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const categoryIconKey = (name: string[]): string => `category:${name.join(' > ')}`

const parseRegexTerms = (regex: string): string[] =>
  regex
    .split('|')
    .map((t) => t.trim())
    .filter(Boolean)

const escapeRegexChars = (s: string): string => s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
const buildRegex = (terms: string[]): string => terms.map(escapeRegexChars).join('|')

const getChildren = (categories: ScreentimeCategory[], parent: ScreentimeCategory): ScreentimeCategory[] =>
  categories.filter(
    (c) =>
      c.name.length === parent.name.length + 1 &&
      c.name.slice(0, parent.name.length).join(' > ') === parent.name.join(' > '),
  )

const matchesCategory = (resolved: string[] | undefined, categoryName: string[]): boolean => {
  if (!resolved || resolved.length < categoryName.length) return false
  return categoryName.every((seg, i) => resolved[i] === seg)
}

const getMatchedApps = (apps: DistinctApp[], categoryName: string[]): DistinctApp[] =>
  apps.filter(
    (app) =>
      app.resolved_category &&
      app.resolved_category.length === categoryName.length &&
      matchesCategory(app.resolved_category, categoryName),
  )

const getAllMatchedApps = (apps: DistinctApp[], categoryName: string[]): DistinctApp[] =>
  apps.filter((app) => matchesCategory(app.resolved_category, categoryName))

const getUncategorizedApps = (apps: DistinctApp[]): DistinctApp[] =>
  apps.filter((app) => !app.resolved_category)

// ============================================================================
// Auto-save field component
// ============================================================================

function AutoSaveText({
  label,
  value,
  onSave,
  placeholder,
  mono,
}: {
  label: string
  value: string
  onSave: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  const [local, setLocal] = useState(value)
  const handleBlur = () => {
    if (local !== value) onSave(local)
  }

  return (
    <div class="field-row">
      <span class="field-label">{label}</span>
      <span class="field-value">
        <input
          type="text"
          value={local}
          onInput={(e) => setLocal((e.target as HTMLInputElement).value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          class={`auto-save-input${mono ? ' mono' : ''}`}
        />
      </span>
    </div>
  )
}

function AutoSaveSelect({
  label,
  value,
  onSave,
  options,
}: {
  label: string
  value: string
  onSave: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div class="field-row">
      <span class="field-label">{label}</span>
      <span class="field-value">
        <select
          value={value}
          onChange={(e) => onSave((e.target as HTMLSelectElement).value)}
          class="auto-save-select"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  )
}

function AutoSaveCheckbox({
  label,
  checked,
  onSave,
}: {
  label: string
  checked: boolean
  onSave: (v: boolean) => void
}) {
  return (
    <div class="field-row">
      <span class="field-label">{label}</span>
      <span class="field-value">
        <label class="auto-save-checkbox">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onSave((e.target as HTMLInputElement).checked)}
          />
        </label>
      </span>
    </div>
  )
}

function AutoSaveColor({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (v: string) => void
}) {
  return (
    <div class="field-row">
      <span class="field-label">{label}</span>
      <span class="field-value">
        <div class="auto-save-color-row">
          <input
            type="color"
            value={value || '#888888'}
            onInput={(e) => onSave((e.target as HTMLInputElement).value)}
            class="auto-save-color-input"
          />
          {value && (
            <button type="button" class="sc-clear-btn" onClick={() => onSave('')} title="Clear (inherit)">
              x
            </button>
          )}
          {!value && <span class="muted">Inherited from parent</span>}
        </div>
      </span>
    </div>
  )
}

function CategoryIconEditor({
  categoryName,
  currentIcon,
  onSaved,
}: {
  categoryName: string[]
  currentIcon: string
  onSaved: () => void
}) {
  const [iconValue, setIconValue] = useState<string | undefined>(undefined)
  const shownIcon = iconValue ?? currentIcon
  const leafName = categoryName[categoryName.length - 1] ?? ''
  const suggested = !shownIcon ? suggestEmoji(leafName) : undefined

  const saveMutation = useMutation({
    mutationFn: async (icon: string) => {
      const settings = await fetchUserSettings()
      const currentIcons = settings.item_icons ?? {}
      const key = categoryIconKey(categoryName)
      const newIcons = { ...currentIcons }
      if (icon) {
        newIcons[key] = icon
      } else {
        delete newIcons[key]
      }
      await updateUserSettings({ item_icons: newIcons })
    },
    onSuccess: onSaved,
  })

  const handleBlur = () => {
    if (iconValue === undefined || iconValue === currentIcon) return
    saveMutation.mutate(iconValue)
  }

  return (
    <div class="field-row">
      <span class="field-label">Icon</span>
      <span class="field-value">
        <div class="category-icon-edit-row">
          <IconInput
            value={shownIcon}
            onChange={setIconValue}
            onBlur={handleBlur}
            inputClass="category-icon-input"
            previewClass="category-icon-preview"
            suggestedEmoji={suggested}
            onAcceptSuggestion={(emoji) => saveMutation.mutate(emoji)}
          />
        </div>
      </span>
    </div>
  )
}

// ============================================================================
// Parent selector (for reparenting)
// ============================================================================

function ParentSelector({
  category,
  allCategories,
  onMoved,
}: {
  category: ScreentimeCategory
  allCategories: ScreentimeCategory[]
  onMoved: () => void
}) {
  const queryClient = useQueryClient()
  const currentParentPath = category.name.slice(0, -1)
  const currentParentKey = currentParentPath.join(' > ') || '__top__'

  // Exclude self and descendants
  const isDescendant = (cat: ScreentimeCategory): boolean =>
    cat.name.length >= category.name.length && category.name.every((s, i) => s === cat.name[i])

  const availableParents = allCategories.filter((c) => !isDescendant(c))

  const moveMutation = useMutation({
    mutationFn: async (newParentId: string | null) => {
      await moveScreentimeCategory(category.id, newParentId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screentime-categories'] })
      queryClient.invalidateQueries({ queryKey: ['screentime-category', category.id] })
      onMoved()
    },
  })

  const handleChange = (value: string) => {
    if (value === currentParentKey) return
    const newParentId = value === '__top__' ? null : value
    moveMutation.mutate(newParentId)
  }

  return (
    <AutoSaveSelect
      label="Parent"
      value={currentParentKey}
      onSave={handleChange}
      options={[
        { label: 'Top level', value: '__top__' },
        ...availableParents.map((c) => ({
          label: c.name.join(' > '),
          value: c.id,
        })),
      ]}
    />
  )
}

// ============================================================================
// Editable fields section
// ============================================================================

function EditableFields({
  category,
  allCategories,
  currentIcon,
  totalTime,
  onFieldSaved,
  onIconSaved,
  onMoved,
}: {
  category: ScreentimeCategory
  allCategories: ScreentimeCategory[]
  currentIcon: string
  totalTime: number
  onFieldSaved: () => void
  onIconSaved: () => void
  onMoved: () => void
}) {
  const saveField = (field: string, value: unknown) => {
    const body: Record<string, unknown> = { [field]: value }
    // If changing regex, also update rule_type
    if (field === 'rule_regex') {
      body.rule_type = value ? 'regex' : 'none'
    }
    updateScreentimeCategory(category.id, body).then(onFieldSaved)
  }

  const saveName = (leafName: string) => {
    if (!leafName.trim()) return
    const newName = [...category.name.slice(0, -1), leafName.trim()]
    updateScreentimeCategory(category.id, { name: newName }).then(onFieldSaved)
  }

  return (
    <div class="category-details">
      <div class="entity-fields">
        <CategoryIconEditor categoryName={category.name} currentIcon={currentIcon} onSaved={onIconSaved} />
        <AutoSaveText
          label="Name"
          value={category.name[category.name.length - 1]}
          onSave={saveName}
          placeholder="Category name"
        />
        <ParentSelector category={category} allCategories={allCategories} onMoved={onMoved} />
        <AutoSaveText
          label="Matching rule"
          value={category.rule_regex ?? ''}
          onSave={(v) => saveField('rule_regex', v || undefined)}
          placeholder="Regex pattern (e.g. Slack|Discord)"
          mono
        />
        <AutoSaveColor
          label="Color"
          value={category.color ?? ''}
          onSave={(v) => saveField('color', v || undefined)}
        />
        <AutoSaveSelect
          label="Productivity"
          value={category.score !== undefined ? String(category.score) : ''}
          onSave={(v) => saveField('score', v !== '' ? parseInt(v, 10) : undefined)}
          options={[
            { label: 'Inherit from parent', value: '' },
            { label: 'Very Productive (2)', value: '2' },
            { label: 'Productive (1)', value: '1' },
            { label: 'Neutral (0)', value: '0' },
            { label: 'Distracting (-1)', value: '-1' },
            { label: 'Very Distracting (-2)', value: '-2' },
          ]}
        />
        <AutoSaveCheckbox
          label="Ignore case"
          checked={category.ignore_case}
          onSave={(v) => saveField('ignore_case', v)}
        />
        <AutoSaveCheckbox
          label="Exclude from screen time"
          checked={category.exclude_from_screentime ?? false}
          onSave={(v) => saveField('exclude_from_screentime', v)}
        />
        <div class="field-row">
          <span class="field-label">Total tracked time</span>
          <span class="field-value">{formatDuration(totalTime)}</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Matched / Uncategorized app lists (kept from previous implementation)
// ============================================================================

interface AggregatedApp {
  activity: string
  total_duration_sec: number
  record_count: number
  title_count: number
}

const aggregateByAppName = (apps: DistinctApp[]): AggregatedApp[] => {
  const map = new Map<string, AggregatedApp>()
  for (const app of apps) {
    const existing = map.get(app.activity)
    if (existing) {
      existing.total_duration_sec += app.total_duration_sec
      existing.record_count += app.record_count
      existing.title_count += 1
    } else {
      map.set(app.activity, {
        activity: app.activity,
        record_count: app.record_count,
        title_count: 1,
        total_duration_sec: app.total_duration_sec,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.total_duration_sec - a.total_duration_sec)
}

function MatchedAppList({
  apps,
  category,
  onAppRemoved,
}: {
  apps: DistinctApp[]
  category: ScreentimeCategory
  onAppRemoved: () => void
}) {
  const queryClient = useQueryClient()
  const [removingApp, setRemovingApp] = useState<string | null>(null)
  const aggregated = aggregateByAppName(apps)

  const removeMutation = useMutation({
    mutationFn: async (appName: string) => {
      setRemovingApp(appName)
      const currentTerms = parseRegexTerms(category.rule_regex ?? '')
      const newTerms = currentTerms.filter((t) => t.toLowerCase() !== appName.toLowerCase())
      const newRegex = newTerms.length > 0 ? buildRegex(newTerms) : undefined
      await updateScreentimeCategory(category.id, {
        rule_regex: newRegex,
        rule_type: newRegex ? 'regex' : 'none',
      })
      await recategorizeScreentime()
    },
    onSuccess: () => {
      setRemovingApp(null)
      onAppRemoved()
      queryClient.invalidateQueries({ queryKey: ['screentime-categories'] })
      queryClient.invalidateQueries({ queryKey: ['productivity-apps'] })
    },
    onError: () => setRemovingApp(null),
  })

  if (aggregated.length === 0) return null

  return (
    <div class="category-section">
      <h3>
        Matched apps <span class="count-badge">{aggregated.length}</span>
      </h3>
      <div class="app-list">
        {aggregated.map((app) => (
          <div key={app.activity} class="app-row">
            <span class="app-name">{app.activity}</span>
            <div class="app-row-right">
              <span class="app-stats">
                {formatDuration(app.total_duration_sec)} &middot; {app.record_count} records
                {app.title_count > 1 && ` · ${app.title_count} titles`}
              </span>
              {category.rule_regex && (
                <button
                  type="button"
                  class="app-action-btn danger"
                  onClick={() => removeMutation.mutate(app.activity)}
                  disabled={removingApp === app.activity}
                  title={`Remove "${app.activity}" from this category`}
                >
                  {removingApp === app.activity ? '...' : 'Remove'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Simplified uncategorized list (the AddConfirmDialog is imported from the previous version)
const MAX_UNCATEGORIZED_SHOWN = 30

function UncategorizedAppList({
  apps,
  category,
  onAppAdded,
}: {
  apps: DistinctApp[]
  category: ScreentimeCategory
  onAppAdded: () => void
}) {
  const queryClient = useQueryClient()
  const [confirmingApp, setConfirmingApp] = useState<DistinctApp | null>(null)
  const [search, setSearch] = useState('')

  const addMutation = useMutation({
    mutationFn: async (term: string) => {
      const currentTerms = parseRegexTerms(category.rule_regex ?? '')
      const newTerms = [...currentTerms, term]
      const newRegex = buildRegex(newTerms)
      await updateScreentimeCategory(category.id, { rule_regex: newRegex, rule_type: 'regex' })
      await recategorizeScreentime()
    },
    onSuccess: () => {
      setConfirmingApp(null)
      onAppAdded()
      queryClient.invalidateQueries({ queryKey: ['screentime-categories'] })
      queryClient.invalidateQueries({ queryKey: ['productivity-apps'] })
    },
  })

  if (apps.length === 0) return null

  // Filter by search term (case-insensitive match on activity + title)
  const lowerSearch = search.toLowerCase()
  const filtered = search
    ? apps.filter(
        (app) =>
          app.activity.toLowerCase().includes(lowerSearch) ||
          (app.title && app.title.toLowerCase().includes(lowerSearch)),
      )
    : apps

  const shown = filtered.slice(0, MAX_UNCATEGORIZED_SHOWN)
  const hiddenCount = filtered.length - shown.length

  return (
    <div class="category-section">
      <h3>
        Uncategorized apps <span class="count-badge">{apps.length}</span>
      </h3>
      <div class="uncategorized-search">
        <input
          type="text"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder="Search apps..."
          class="auto-save-input"
        />
        {search && filtered.length !== apps.length && (
          <span class="uncategorized-filter-count">
            {filtered.length} match{filtered.length !== 1 ? 'es' : ''}
          </span>
        )}
      </div>
      <div class="app-list">
        {shown.map((app) => (
          <div key={`${app.activity}\x00${app.title ?? ''}`} class="app-row">
            <div class="app-name-col">
              <span class="app-name">{app.activity}</span>
              {app.title && <span class="app-title">{app.title}</span>}
            </div>
            <div class="app-row-right">
              <span class="app-stats">
                {formatDuration(app.total_duration_sec)} &middot; {app.record_count} records
              </span>
              <button
                type="button"
                class="app-action-btn add"
                onClick={() => setConfirmingApp(app)}
                title={`Add to ${category.name.join(' > ')}`}
              >
                Add here
              </button>
            </div>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && (
        <p class="uncategorized-more">{hiddenCount} more — refine your search to see them</p>
      )}
      {confirmingApp && (
        <AddConfirmDialog
          app={confirmingApp}
          category={category}
          onConfirm={(term) => addMutation.mutate(term)}
          onCancel={() => setConfirmingApp(null)}
          isPending={addMutation.isPending}
        />
      )}
    </div>
  )
}

// ============================================================================
// Add confirm dialog (kept from previous version)
// ============================================================================

const suggestTitleKeyword = (title: string): string | undefined => {
  const parts = title
    .split(/\s[—–\-|]\s|:\s/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 40)
  if (parts.length === 0) return undefined
  const browserNames = [
    'mozilla firefox',
    'google chrome',
    'chromium',
    'gnu emacs',
    'safari',
    'microsoft edge',
  ]
  const filtered = parts.filter((p) => !browserNames.includes(p.toLowerCase()))
  if (filtered.length === 0) return parts[0]
  return filtered.reduce((a, b) => (a.length <= b.length ? a : b))
}

function AddConfirmDialog({
  app,
  category,
  onConfirm,
  onCancel,
  isPending,
}: {
  app: DistinctApp
  category: ScreentimeCategory
  onConfirm: (term: string) => void
  onCancel: () => void
  isPending: boolean
}) {
  const titleKeyword = app.title ? suggestTitleKeyword(app.title) : undefined
  const [customTerm, setCustomTerm] = useState('')
  const [selectedOption, setSelectedOption] = useState<'app' | 'title' | 'custom'>(
    titleKeyword ? 'title' : 'app',
  )

  const getSelectedTerm = (): string => {
    switch (selectedOption) {
      case 'app':
        return app.activity
      case 'title':
        return titleKeyword ?? app.activity
      case 'custom':
        return customTerm.trim()
    }
  }

  const selectedTerm = getSelectedTerm()

  return (
    <div class="add-confirm-backdrop" onClick={onCancel}>
      <div class="add-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h4>Add to {category.name.join(' > ')}</h4>
        <p class="add-confirm-desc">
          Choose what to match. The term will be added to the category's matching rule.
        </p>
        <div class="add-confirm-options">
          <label class="add-confirm-option">
            <input
              type="radio"
              name="match-type"
              checked={selectedOption === 'app'}
              onChange={() => setSelectedOption('app')}
            />
            <div>
              <strong>App name</strong> — matches all <em>{app.activity}</em> usage
              <div class="add-confirm-preview">
                <code>{escapeRegexChars(app.activity)}</code>
              </div>
            </div>
          </label>
          {titleKeyword && (
            <label class="add-confirm-option">
              <input
                type="radio"
                name="match-type"
                checked={selectedOption === 'title'}
                onChange={() => setSelectedOption('title')}
              />
              <div>
                <strong>Title keyword</strong> — matches windows containing <em>{titleKeyword}</em>
                <div class="add-confirm-preview">
                  <code>{escapeRegexChars(titleKeyword)}</code>
                </div>
              </div>
            </label>
          )}
          <label class="add-confirm-option">
            <input
              type="radio"
              name="match-type"
              checked={selectedOption === 'custom'}
              onChange={() => setSelectedOption('custom')}
            />
            <div>
              <strong>Custom term</strong>
              {selectedOption === 'custom' && (
                <div class="add-confirm-custom-input">
                  <input
                    type="text"
                    value={customTerm}
                    onInput={(e) => setCustomTerm((e.target as HTMLInputElement).value)}
                    placeholder="Type a matching term..."
                    autoFocus
                  />
                </div>
              )}
            </div>
          </label>
        </div>
        <div class="add-confirm-actions">
          <button
            type="button"
            class="app-action-btn add"
            onClick={() => onConfirm(selectedTerm)}
            disabled={isPending || !selectedTerm}
          >
            {isPending ? 'Adding...' : `Add "${selectedTerm}"`}
          </button>
          <button type="button" class="app-action-btn" onClick={onCancel} disabled={isPending}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Trend section
// ============================================================================

function CategoryTrendSection({ categoryPath, color }: { categoryPath: string; color: string }) {
  const [lookback, setLookback] = useState(90)

  const trendParams: FetchTrendParams = {
    display_period: 'daily',
    half_life_days: 15,
    lookback_days: lookback,
    pattern: categoryPath,
    source_type: 'productivity_category',
  }

  const trendQuery = useQuery({
    queryFn: () => fetchTrend(trendParams),
    queryKey: ['trend', trendParams],
    staleTime: 5 * 60 * 1000,
  })

  return (
    <div class="category-section">
      <div class="category-trend-header">
        <h3>Time trend</h3>
        <select
          class="category-trend-lookback"
          value={lookback}
          onChange={(e) => setLookback(Number((e.target as HTMLSelectElement).value))}
        >
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="180">6 months</option>
          <option value="365">1 year</option>
        </select>
      </div>
      {trendQuery.isLoading && <p class="loading">Loading trend...</p>}
      {trendQuery.error && <p class="sc-empty">No trend data available</p>}
      {trendQuery.data && (
        <>
          <div class="category-trend-value">
            <span class="category-trend-number">{trendQuery.data.current_value.toFixed(1)}</span>
            <span class="category-trend-unit">{trendQuery.data.display_unit}</span>
          </div>
          <MiniTrendChart data={trendQuery.data.history} color={color} />
        </>
      )}
    </div>
  )
}

// ============================================================================
// Children list
// ============================================================================

function ChildCategoriesList({
  children,
  distinctApps,
  icons,
}: {
  children: ScreentimeCategory[]
  distinctApps: DistinctApp[]
  icons: Record<string, string>
}) {
  if (children.length === 0) return null

  return (
    <div class="category-section">
      <h3>
        Sub-categories <span class="count-badge">{children.length}</span>
      </h3>
      <div class="children-list">
        {children.map((child) => {
          const childIcon = icons[categoryIconKey(child.name)] ?? ''
          const childTime = getAllMatchedApps(distinctApps, child.name).reduce(
            (sum, a) => sum + a.total_duration_sec,
            0,
          )
          return (
            <a key={child.id} href={`/screentime-categories/${child.id}`} class="child-category-card">
              {childIcon && isEmoji(childIcon) ? (
                <span class="child-icon">{childIcon}</span>
              ) : (
                child.color && <span class="sc-color-dot" style={{ background: child.color }} />
              )}
              <span class="child-name">{child.name[child.name.length - 1]}</span>
              {childTime > 0 && <span class="child-stats">{formatDuration(childTime)}</span>}
            </a>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// Breadcrumb
// ============================================================================

function CategoryBreadcrumb({
  categories,
  category,
}: {
  categories: ScreentimeCategory[]
  category: ScreentimeCategory
}) {
  const segments = category.name

  return (
    <nav class="category-breadcrumb">
      <a href="/screentime-categories">Categories</a>
      {segments.map((segment, i) => {
        const path = segments.slice(0, i + 1)
        const parentCat = categories.find((c) => c.name.join(' > ') === path.join(' > '))
        const isLast = i === segments.length - 1

        return (
          <span key={i}>
            <span class="breadcrumb-separator">&gt;</span>
            {isLast ? (
              <span class="breadcrumb-current">{segment}</span>
            ) : parentCat ? (
              <a href={`/screentime-categories/${parentCat.id}`}>{segment}</a>
            ) : (
              <span>{segment}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

// ============================================================================
// New category creation mode
// ============================================================================

function NewCategoryPage({ categoryId }: { categoryId: string }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [created, setCreated] = useState(false)

  // Parse parent from URL query string
  const urlParams = new URLSearchParams(window.location.search)
  const parentId = urlParams.get('parent')

  const { data: allCategories = [] } = useQuery({
    queryFn: fetchScreentimeCategories,
    queryKey: ['screentime-categories'],
    staleTime: 5 * 60 * 1000,
  })

  const parent = parentId ? allCategories.find((c) => c.id === parentId) : undefined

  const createMutation = useMutation({
    mutationFn: async (leafName: string) => {
      const parentPath = parent ? parent.name : []
      await upsertScreentimeCategory(categoryId, {
        name: [...parentPath, leafName],
      })
    },
    onSuccess: () => {
      setCreated(true)
      queryClient.invalidateQueries({ queryKey: ['screentime-categories'] })
      queryClient.invalidateQueries({ queryKey: ['screentime-category', categoryId] })
    },
  })

  if (created) {
    // Category was created — re-render will load the real detail page
    return (
      <div class="data-sources-page">
        <p class="loading">Loading...</p>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
      <nav class="category-breadcrumb">
        <a href="/screentime-categories">Categories</a>
        <span class="breadcrumb-separator">&gt;</span>
        <span class="breadcrumb-current">New category</span>
      </nav>

      <h1>New Category</h1>

      <div class="category-details">
        <div class="entity-fields">
          {parent && (
            <div class="field-row">
              <span class="field-label">Parent</span>
              <span class="field-value">{parent.name.join(' > ')}</span>
            </div>
          )}
          <div class="field-row">
            <span class="field-label">Name</span>
            <span class="field-value">
              <input
                type="text"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) createMutation.mutate(name.trim())
                }}
                placeholder="Category name"
                class="auto-save-input"
                autoFocus
              />
            </span>
          </div>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <button
            type="button"
            class="note-action-btn"
            onClick={() => createMutation.mutate(name.trim())}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main component
// ============================================================================

export function CategoryDetail() {
  const { params } = useRoute()
  const categoryId = params.id
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: category, isLoading: categoryLoading } = useQuery({
    enabled: !!isLoggedIn && !!categoryId,
    queryFn: () => fetchScreentimeCategoryById(categoryId),
    queryKey: ['screentime-category', categoryId],
  })

  const { data: allCategories = [] } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchScreentimeCategories,
    queryKey: ['screentime-categories'],
    staleTime: 5 * 60 * 1000,
  })

  const { data: distinctApps = [] } = useQuery({
    enabled: !!isLoggedIn && !!category,
    queryFn: fetchDistinctApps,
    queryKey: ['productivity-apps'],
    staleTime: 5 * 60 * 1000,
  })

  const { data: userSettings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
    staleTime: 5 * 60 * 1000,
  })

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['screentime-category', categoryId] })
    queryClient.invalidateQueries({ queryKey: ['screentime-categories'] })
    queryClient.invalidateQueries({ queryKey: ['productivity-apps'] })
  }, [queryClient, categoryId])

  // Invalidate parent list when leaving so it shows fresh data
  useEffect(() => () => void invalidateAll(), [invalidateAll])

  const invalidateIcons = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['userSettings'] })
  }, [queryClient])

  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <p>Please log in to view category details.</p>
      </div>
    )
  }

  if (categoryLoading) {
    return (
      <div class="data-sources-page">
        <p class="loading">Loading...</p>
      </div>
    )
  }

  // If category not found, show creation mode (client-generated UUID)
  if (!category) {
    return <NewCategoryPage categoryId={categoryId} />
  }

  return (
    <ExistingCategoryPage
      category={category}
      allCategories={allCategories}
      distinctApps={distinctApps}
      userSettings={userSettings}
      onFieldSaved={invalidateAll}
      onIconSaved={invalidateIcons}
    />
  )
}

/** Render an existing category's detail/edit page. */
function ExistingCategoryPage({
  category,
  allCategories,
  distinctApps,
  userSettings,
  onFieldSaved,
  onIconSaved,
}: {
  category: ScreentimeCategory
  allCategories: ScreentimeCategory[]
  distinctApps: DistinctApp[]
  userSettings?: { item_icons?: Record<string, string> }
  onFieldSaved: () => void
  onIconSaved: () => void
}) {
  const children = getChildren(allCategories, category)
  const matchedApps = getMatchedApps(distinctApps, category.name)
  const allMatched = getAllMatchedApps(distinctApps, category.name)
  const uncategorized = getUncategorizedApps(distinctApps)
  const totalTime = allMatched.reduce((sum, a) => sum + a.total_duration_sec, 0)
  const icons = userSettings?.item_icons ?? {}
  const currentIcon = icons[categoryIconKey(category.name)] ?? ''

  return (
    <div class="data-sources-page">
      <CategoryBreadcrumb categories={allCategories} category={category} />

      <div class="category-header">
        {currentIcon && isEmoji(currentIcon) && <span class="category-header-icon">{currentIcon}</span>}
        {category.color && !currentIcon && (
          <span class="category-color-swatch" style={{ background: category.color }} />
        )}
        <h1>{category.name[category.name.length - 1]}</h1>
      </div>

      <EditableFields
        category={category}
        allCategories={allCategories}
        currentIcon={currentIcon}
        totalTime={totalTime}
        onFieldSaved={onFieldSaved}
        onIconSaved={onIconSaved}
        onMoved={onFieldSaved}
      />
      <CategoryTrendSection categoryPath={category.name.join(' > ')} color={category.color ?? '#673ab8'} />
      <ChildCategoriesList children={children} distinctApps={distinctApps} icons={icons} />
      <MatchedAppList apps={matchedApps} category={category} onAppRemoved={onFieldSaved} />
      <UncategorizedAppList apps={uncategorized} category={category} onAppAdded={onFieldSaved} />

      <div class="category-footer">
        <a href="/screentime-categories" class="manage-link">
          Back to all categories
        </a>
      </div>
    </div>
  )
}
