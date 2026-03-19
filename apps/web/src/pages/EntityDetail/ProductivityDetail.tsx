/**
 * Productivity record detail view.
 */
import type { ScreentimeCategory } from '@aurboda/api-spec'

import type { ProductivityRecord } from '../../state/api'

import { IconPreview } from '../../components/IconPreview'
import { resolveItemIcon } from '../../utils/emojiLookup'
import { formatDuration, formatTime } from './format-utils'

const productivityScoreLabel = (score: number | undefined | null): string => {
  switch (score) {
    case 2:
      return 'Very Productive'
    case 1:
      return 'Productive'
    case 0:
      return 'Neutral'
    case -1:
      return 'Distracting'
    case -2:
      return 'Very Distracting'
    default:
      return 'Uncategorized'
  }
}

/** Find the category whose name path matches the given path. */
const findCategoryByPath = (
  categories: ScreentimeCategory[],
  path: string[],
): ScreentimeCategory | undefined =>
  categories.find((c) => c.name.length === path.length && c.name.every((seg, i) => seg === path[i]))

/** Get the link target for the app title. */
const getTitleHref = (record: ProductivityRecord, categories: ScreentimeCategory[]): string => {
  if (record.resolved_category && record.resolved_category.length > 0) {
    const cat = findCategoryByPath(categories, record.resolved_category)
    if (cat) return `/screentime-categories/${cat.id}`
  }
  return '/screentime-categories'
}

/**
 * Resolve the effective productivity score for a record.
 * Walks the resolved_category path from deepest to shallowest, returning the
 * first category score found. Falls back to the record's own productivity field.
 */
const resolveProductivityScore = (
  record: ProductivityRecord,
  categories: ScreentimeCategory[],
): number | undefined | null => {
  if (record.resolved_category && record.resolved_category.length > 0 && categories.length > 0) {
    for (let depth = record.resolved_category.length; depth > 0; depth--) {
      const path = record.resolved_category.slice(0, depth)
      const cat = findCategoryByPath(categories, path)
      if (cat?.score !== undefined) return cat.score
    }
  }
  return record.productivity
}

/** Resolve icon for a productivity record by walking its category path. */
const resolveCategoryIcon = (
  record: ProductivityRecord,
  categories: ScreentimeCategory[],
  itemIcons: Record<string, string>,
): string | undefined => {
  if (!record.resolved_category || record.resolved_category.length === 0) return undefined
  for (let depth = record.resolved_category.length; depth > 0; depth--) {
    const path = record.resolved_category.slice(0, depth).join(' > ')
    const icon = resolveItemIcon(`category:${path}`, itemIcons)
    if (icon) return icon
  }
  return undefined
}

export const ProductivityDetail = ({
  record,
  categories = [],
  itemIcons = {},
}: {
  record: ProductivityRecord
  categories?: ScreentimeCategory[]
  itemIcons?: Record<string, string>
}) => {
  const titleHref = getTitleHref(record, categories)
  const icon = resolveCategoryIcon(record, categories, itemIcons)

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <span class="entity-type-badge">screen time</span>
        {record.is_mobile && <span class="entity-source">Mobile</span>}
      </div>

      <h2 class="entity-title-with-icon">
        {icon && <IconPreview icon={icon} size={28} />}
        <a href={titleHref} class="entity-title-link">
          {record.activity}
        </a>
      </h2>
      {record.title && <p class="entity-subtitle">{record.title}</p>}

      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Time</span>
          <span class="field-value">
            {formatTime(record.start_time)} – {formatTime(record.end_time)}
          </span>
        </div>
        <div class="field-row">
          <span class="field-label">Duration</span>
          <span class="field-value">{formatDuration(record.start_time, record.end_time)}</span>
        </div>
        {record.resolved_category && record.resolved_category.length > 0 && (
          <div class="field-row">
            <span class="field-label">Category</span>
            <span class="field-value">
              {record.resolved_category.map((segment, i) => {
                const path = record.resolved_category!.slice(0, i + 1)
                const cat = findCategoryByPath(categories, path)
                return (
                  <span key={i}>
                    {i > 0 && ' > '}
                    {cat ? (
                      <a href={`/screentime-categories/${cat.id}`} class="category-link">
                        {segment}
                      </a>
                    ) : (
                      segment
                    )}
                  </span>
                )
              })}
            </span>
          </div>
        )}
        {record.category && !(record.resolved_category && record.resolved_category.length > 0) && (
          <div class="field-row">
            <span class="field-label">Category</span>
            <span class="field-value">
              <a href="/screentime-categories" class="category-link">
                {record.category}
              </a>
            </span>
          </div>
        )}
        <div class="field-row">
          <span class="field-label">Productivity</span>
          <span class="field-value">
            {productivityScoreLabel(resolveProductivityScore(record, categories))}
          </span>
        </div>
        {record.source_ids && record.source_ids.length > 1 && (
          <div class="field-row">
            <span class="field-label">Merged spans</span>
            <span class="field-value">{record.source_ids.length}</span>
          </div>
        )}
      </div>
    </div>
  )
}
