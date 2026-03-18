/**
 * Category detail/info page.
 * Shows category details, icon editing, matched apps (with remove),
 * child categories, and uncategorized apps (with add-to-category).
 */
import type { ScreentimeCategory } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'

import {
  type DistinctApp,
  type FetchTrendParams,
  fetchDistinctApps,
  fetchScreentimeCategories,
  fetchScreentimeCategoryById,
  fetchTrend,
  fetchUserSettings,
  recategorizeScreentime,
  updateScreentimeCategory,
  updateUserSettings,
} from '../../state/api'
import { auth } from '../../state/auth'
import { isEmoji, isUrl, suggestEmoji } from '../../utils/emojiLookup'
import { MiniTrendChart } from '../TagMeta/MiniTrendChart'
import './style.css'

// ============================================================================
// Helpers
// ============================================================================

const productivityScoreLabel = (score: number | undefined): string => {
  if (score === undefined) return 'Inherited from parent'
  const labels: Record<number, string> = {
    [-2]: 'Very Distracting',
    [-1]: 'Distracting',
    0: 'Neutral',
    1: 'Productive',
    2: 'Very Productive',
  }
  return labels[score] ?? `${score}`
}

const formatDuration = (totalSec: number): string => {
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** Build the item_icons key for a category. */
const categoryIconKey = (name: string[]): string => `category:${name.join(' > ')}`

/**
 * Parse a pipe-separated regex into individual terms.
 * E.g. "GitHub|Stack Overflow|vscode" -> ["GitHub", "Stack Overflow", "vscode"]
 */
const parseRegexTerms = (regex: string): string[] =>
  regex
    .split('|')
    .map((t) => t.trim())
    .filter(Boolean)

/**
 * Build a pipe-separated regex from terms.
 * Escapes regex special chars in each term so they match literally.
 */
const escapeRegexChars = (s: string): string => s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildRegex = (terms: string[]): string => terms.map(escapeRegexChars).join('|')

/** Find child categories of the given category. */
const getChildren = (categories: ScreentimeCategory[], parent: ScreentimeCategory): ScreentimeCategory[] =>
  categories.filter(
    (c) =>
      c.name.length === parent.name.length + 1 &&
      c.name.slice(0, parent.name.length).join(' > ') === parent.name.join(' > '),
  )

/** Check if a resolved_category path matches or is a child of this category. */
const matchesCategory = (resolved: string[] | undefined, categoryName: string[]): boolean => {
  if (!resolved || resolved.length < categoryName.length) return false
  return categoryName.every((seg, i) => resolved[i] === seg)
}

/** Get apps that match this specific category (not child categories). */
const getMatchedApps = (apps: DistinctApp[], categoryName: string[]): DistinctApp[] =>
  apps.filter(
    (app) =>
      app.resolved_category &&
      app.resolved_category.length === categoryName.length &&
      matchesCategory(app.resolved_category, categoryName),
  )

/** Get apps that match this category or any of its children. */
const getAllMatchedApps = (apps: DistinctApp[], categoryName: string[]): DistinctApp[] =>
  apps.filter((app) => matchesCategory(app.resolved_category, categoryName))

/** Get uncategorized apps (no resolved_category). */
const getUncategorizedApps = (apps: DistinctApp[]): DistinctApp[] =>
  apps.filter((app) => !app.resolved_category)

// ============================================================================
// Sub-components
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

function IconPreview({ icon }: { icon: string }) {
  if (!icon) return null
  if (isEmoji(icon)) return <span class="category-icon-preview">{icon}</span>
  if (isUrl(icon)) {
    return (
      <span class="category-icon-preview">
        <img src={icon} alt="icon" width="24" height="24" />
      </span>
    )
  }
  return null
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

  // Suggest emoji based on the leaf category name
  const leafName = categoryName[categoryName.length - 1] ?? ''
  const suggested = !shownIcon ? suggestEmoji(leafName) : undefined

  const saveMutation = useMutation({
    mutationFn: async (icon: string) => {
      // Read current settings, merge our icon, save back
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
    onSuccess: () => {
      onSaved()
    },
  })

  const handleBlur = () => {
    if (iconValue === undefined) return
    if (iconValue === currentIcon) return
    saveMutation.mutate(iconValue)
  }

  return (
    <div class="field-row">
      <span class="field-label">Icon</span>
      <span class="field-value">
        <div class="category-icon-edit-row">
          <input
            type="text"
            value={shownIcon}
            onInput={(e) => setIconValue((e.target as HTMLInputElement).value)}
            onBlur={handleBlur}
            placeholder="Emoji or image URL..."
            class="category-icon-input"
          />
          <IconPreview icon={shownIcon} />
          {suggested && !shownIcon && (
            <button
              type="button"
              class="category-icon-suggestion"
              onClick={() => {
                setIconValue(suggested)
                saveMutation.mutate(suggested)
              }}
              title={`Suggested: ${suggested}`}
            >
              {suggested}?
            </button>
          )}
          {saveMutation.isPending && <span class="category-save-status">Saving...</span>}
        </div>
      </span>
    </div>
  )
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

  const removeMutation = useMutation({
    mutationFn: async (appName: string) => {
      setRemovingApp(appName)
      const currentTerms = parseRegexTerms(category.rule_regex ?? '')
      // Remove terms that match this app name (case-insensitive comparison)
      const newTerms = currentTerms.filter((t) => t.toLowerCase() !== appName.toLowerCase())
      const newRegex = newTerms.length > 0 ? buildRegex(newTerms) : undefined
      await updateScreentimeCategory(category.id, {
        rule_regex: newRegex,
        rule_type: newRegex ? 'regex' : 'none',
      })
      // Wait for recategorization so the lists reflect the change immediately
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

  if (apps.length === 0) {
    return (
      <div class="category-section">
        <h3>Matched apps</h3>
        <p class="sc-empty">No apps match this category directly.</p>
      </div>
    )
  }

  return (
    <div class="category-section">
      <h3>
        Matched apps <span class="count-badge">{apps.length}</span>
      </h3>
      <div class="app-list">
        {apps.map((app) => (
          <div key={`${app.activity}\x00${app.title ?? ''}`} class="app-row">
            <div class="app-name-col">
              <span class="app-name">{app.activity}</span>
              {app.title && <span class="app-title">{app.title}</span>}
            </div>
            <div class="app-row-right">
              <span class="app-stats">
                {formatDuration(app.total_duration_sec)} &middot; {app.record_count} records
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

/**
 * Extract a short keyword from a window title for use as a matching term.
 * E.g. "Threads - NaturalCycles - Slack — Mozilla Firefox" → "Slack"
 * Splits on common separators and picks the shortest meaningful segment.
 */
const suggestTitleKeyword = (title: string): string | undefined => {
  const parts = title
    .split(/\s[—–\-|]\s|:\s/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 40)
  if (parts.length === 0) return undefined
  // Prefer shorter segments (more likely to be an app/site name), but not the browser name
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

/** Confirmation dialog for adding an app/title to a category. */
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

function UncategorizedAppList({
  apps,
  category,
  total,
  onAppAdded,
}: {
  apps: DistinctApp[]
  category: ScreentimeCategory
  total: number
  onAppAdded: () => void
}) {
  const queryClient = useQueryClient()
  const [confirmingApp, setConfirmingApp] = useState<DistinctApp | null>(null)

  const addMutation = useMutation({
    mutationFn: async (term: string) => {
      const currentTerms = parseRegexTerms(category.rule_regex ?? '')
      const newTerms = [...currentTerms, term]
      const newRegex = buildRegex(newTerms)
      await updateScreentimeCategory(category.id, {
        rule_regex: newRegex,
        rule_type: 'regex',
      })
      // Wait for recategorization so lists reflect the change immediately
      await recategorizeScreentime()
    },
    onSuccess: () => {
      setConfirmingApp(null)
      onAppAdded()
      queryClient.invalidateQueries({ queryKey: ['screentime-categories'] })
      queryClient.invalidateQueries({ queryKey: ['productivity-apps'] })
    },
  })

  const headerTitle =
    total > apps.length ? `Uncategorized apps (showing ${apps.length} of ${total})` : 'Uncategorized apps'

  if (total === 0) {
    return (
      <div class="category-section">
        <h3>Uncategorized apps</h3>
        <p class="sc-empty">All apps are categorized!</p>
      </div>
    )
  }

  return (
    <div class="category-section">
      <h3>
        {headerTitle} <span class="count-badge">{total}</span>
      </h3>
      <div class="app-list">
        {apps.map((app) => (
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
// Category info fields
// ============================================================================

function CategoryFields({
  category,
  currentIcon,
  totalTime,
  onIconSaved,
}: {
  category: ScreentimeCategory
  currentIcon: string
  totalTime: number
  onIconSaved: () => void
}) {
  return (
    <div class="category-details">
      <div class="entity-fields">
        <CategoryIconEditor categoryName={category.name} currentIcon={currentIcon} onSaved={onIconSaved} />
        {category.rule_regex && (
          <div class="field-row">
            <span class="field-label">Matching rule</span>
            <span class="field-value">
              <code>{category.rule_regex}</code>
            </span>
          </div>
        )}
        {!category.rule_regex && category.rule_type === 'none' && (
          <div class="field-row">
            <span class="field-label">Matching rule</span>
            <span class="field-value muted">Grouping only (no direct matching)</span>
          </div>
        )}
        <div class="field-row">
          <span class="field-label">Productivity</span>
          <span class="field-value">{productivityScoreLabel(category.score)}</span>
        </div>
        <div class="field-row">
          <span class="field-label">Total tracked time</span>
          <span class="field-value">{formatDuration(totalTime)}</span>
        </div>
      </div>
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
    enabled: !!isLoggedIn,
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

  if (!category) {
    return (
      <div class="data-sources-page">
        <p class="error">Category not found.</p>
        <a href="/screentime-categories">Back to categories</a>
      </div>
    )
  }

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

      <CategoryFields
        category={category}
        currentIcon={currentIcon}
        totalTime={totalTime}
        onIconSaved={invalidateIcons}
      />
      <CategoryTrendSection categoryPath={category.name.join(' > ')} color={category.color ?? '#673ab8'} />
      <ChildCategoriesList children={children} distinctApps={distinctApps} icons={icons} />
      <MatchedAppList apps={matchedApps} category={category} onAppRemoved={invalidateAll} />
      <UncategorizedAppList
        apps={uncategorized.slice(0, 30)}
        category={category}
        total={uncategorized.length}
        onAppAdded={invalidateAll}
      />

      <div class="category-footer">
        <a href="/screentime-categories" class="manage-link">
          Manage all categories
        </a>
      </div>
    </div>
  )
}
