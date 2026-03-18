/**
 * Category detail/info page.
 * Shows category details, matched apps, child categories, and links back to management.
 */
import type { ScreentimeCategory } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

import {
  type DistinctApp,
  fetchDistinctApps,
  fetchScreentimeCategories,
  fetchScreentimeCategoryById,
} from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

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

function AppList({ apps, title, emptyText }: { apps: DistinctApp[]; title: string; emptyText: string }) {
  if (apps.length === 0) {
    return (
      <div class="category-section">
        <h3>{title}</h3>
        <p class="sc-empty">{emptyText}</p>
      </div>
    )
  }

  return (
    <div class="category-section">
      <h3>
        {title} <span class="count-badge">{apps.length}</span>
      </h3>
      <div class="app-list">
        {apps.map((app) => (
          <div key={app.activity} class="app-row">
            <span class="app-name">{app.activity}</span>
            <span class="app-stats">
              {formatDuration(app.total_duration_sec)} &middot; {app.record_count} records
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CategoryDetail() {
  const { params } = useRoute()
  const categoryId = params.id
  const isLoggedIn = auth.value.token

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

  return (
    <div class="data-sources-page">
      <CategoryBreadcrumb categories={allCategories} category={category} />

      <div class="category-header">
        {category.color && <span class="category-color-swatch" style={{ background: category.color }} />}
        <h1>{category.name.join(' > ')}</h1>
      </div>

      {/* Category details */}
      <div class="category-details">
        <div class="entity-fields">
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
            <span class="field-label">Case insensitive</span>
            <span class="field-value">{category.ignore_case ? 'Yes' : 'No'}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Total tracked time</span>
            <span class="field-value">{formatDuration(totalTime)}</span>
          </div>
        </div>
      </div>

      {/* Child categories */}
      {children.length > 0 && (
        <div class="category-section">
          <h3>
            Sub-categories <span class="count-badge">{children.length}</span>
          </h3>
          <div class="children-list">
            {children.map((child) => {
              const childTime = getAllMatchedApps(distinctApps, child.name).reduce(
                (sum, a) => sum + a.total_duration_sec,
                0,
              )
              return (
                <a key={child.id} href={`/screentime-categories/${child.id}`} class="child-category-card">
                  {child.color && <span class="sc-color-dot" style={{ background: child.color }} />}
                  <span class="child-name">{child.name[child.name.length - 1]}</span>
                  {childTime > 0 && <span class="child-stats">{formatDuration(childTime)}</span>}
                </a>
              )
            })}
          </div>
        </div>
      )}

      {/* Matched apps */}
      <AppList apps={matchedApps} title="Matched apps" emptyText="No apps match this category directly." />

      {/* Uncategorized apps (helpful for assigning) */}
      <AppList
        apps={uncategorized.slice(0, 20)}
        title={`Uncategorized apps${uncategorized.length > 20 ? ` (showing 20 of ${uncategorized.length})` : ''}`}
        emptyText="All apps are categorized!"
      />

      <div class="category-footer">
        <a href="/screentime-categories" class="manage-link">
          Manage all categories
        </a>
      </div>
    </div>
  )
}
