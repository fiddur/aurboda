/**
 * Productivity record detail view.
 */
import type { ProductivityRecord } from '../../state/api'

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

export const ProductivityDetail = ({ record }: { record: ProductivityRecord }) => (
  <div class="entity-info">
    <div class="entity-meta">
      <span class="entity-type-badge">screen time</span>
      {record.is_mobile && <span class="entity-source">Mobile</span>}
    </div>

    <h2>{record.activity}</h2>
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
          <span class="field-value">{record.resolved_category.join(' > ')}</span>
        </div>
      )}
      {record.category && !(record.resolved_category && record.resolved_category.length > 0) && (
        <div class="field-row">
          <span class="field-label">Category</span>
          <span class="field-value">{record.category}</span>
        </div>
      )}
      <div class="field-row">
        <span class="field-label">Productivity</span>
        <span class="field-value">{productivityScoreLabel(record.productivity)}</span>
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
